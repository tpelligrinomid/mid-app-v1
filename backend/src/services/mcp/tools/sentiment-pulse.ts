import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";
import { buildTrend, extractQuotes, QUOTE_RESPONSE_CAP, type SentimentJson } from "../sentiment.js";

export default defineTool({
  name: "get_sentiment_pulse",
  title: "Meeting sentiment pulse",
  description:
    "Scan meeting sentiment across ALL contracts the signed-in user can see (or a single contract) over a date window. Use this to answer questions like 'which clients had negative sentiment in the last 4 weeks?'. Returns per-contract sentiment counts plus the matching meetings with labels, confidence and topics. Set include_quotes=true for citable evidence and trend=true for month-over-month direction. Internal staff only; client accounts are denied.",
  inputSchema: {
    days: z.number().int().min(1).max(365).default(28).describe("Look-back window in days (ignored if since is set)"),
    since: z.string().optional().describe("ISO date (YYYY-MM-DD) start of window"),
    until: z.string().optional().describe("ISO date (YYYY-MM-DD) end of window"),
    labels: z
      .array(z.string())
      .optional()
      .describe("Only include meetings with these sentiment labels, e.g. ['negative','mixed']"),
    contract_id: z.string().uuid().optional().describe("Limit to one contract"),
    include_quotes: z.boolean().default(false).describe("Attach up to 3 supporting quotes per meeting (40 per response max)"),
    trend: z.boolean().default(false).describe("Include per-contract monthly sentiment buckets and direction"),
    limit: z.number().int().min(1).max(200).default(200).describe("Max meetings scanned (hard cap 200)"),
    cursor: z.string().optional().describe("Opaque cursor from a previous call's next_cursor"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days, since, until, labels, contract_id, include_quotes, trend, limit, cursor }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;

    const end = until ? new Date(`${until}T23:59:59Z`) : new Date();
    const start = since ? new Date(`${since}T00:00:00Z`) : new Date(end.getTime() - days * 86400000);
    const capped = Math.min(limit, 200);
    const offset = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;

    let q = supabase
      .from("compass_meetings")
      .select("meeting_id, contract_id, title, meeting_date, source, sentiment, transcript, contracts(contract_name, external_id)")
      .gte("meeting_date", start.toISOString())
      .lte("meeting_date", end.toISOString())
      .order("meeting_date", { ascending: false })
      .range(offset, offset + capped - 1);
    if (contract_id) q = q.eq("contract_id", contract_id);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const wanted = labels?.map((l) => l.toLowerCase());
    type Bucket = {
      contract_id: string;
      contract_name: string;
      external_id: string | null;
      counts: Record<string, number>;
      meetings: unknown[];
      labelsByMonth: Map<string, string[]>;
    };
    const byContract = new Map<string, Bucket>();
    let quoteBudget = QUOTE_RESPONSE_CAP;

    for (const row of data ?? []) {
      const sentiment = (row as { sentiment: SentimentJson }).sentiment;
      const label = (sentiment?.label ?? "unscored").toLowerCase();
      if (wanted && !wanted.includes(label)) continue;
      const contract = (row as { contracts?: { contract_name?: string; external_id?: string | null } | null }).contracts;
      const key = row.contract_id as string;
      if (!byContract.has(key)) {
        byContract.set(key, {
          contract_id: key,
          contract_name: contract?.contract_name ?? "Unknown",
          external_id: contract?.external_id ?? null,
          counts: {},
          meetings: [],
          labelsByMonth: new Map(),
        });
      }
      const bucket = byContract.get(key)!;
      bucket.counts[label] = (bucket.counts[label] ?? 0) + 1;

      const month = String(row.meeting_date ?? "").slice(0, 7);
      if (month) bucket.labelsByMonth.set(month, [...(bucket.labelsByMonth.get(month) ?? []), label]);

      let quotes: string[] = [];
      if (include_quotes && quoteBudget > 0) {
        quotes = extractQuotes(sentiment, (row as { transcript?: unknown }).transcript, Math.min(3, quoteBudget));
        quoteBudget -= quotes.length;
      }

      bucket.meetings.push({
        meeting_id: row.meeting_id,
        title: row.title,
        meeting_date: row.meeting_date,
        source: row.source,
        sentiment_label: label,
        confidence: sentiment?.confidence ?? null,
        topics: sentiment?.topics?.slice(0, 6) ?? [],
        ...(include_quotes ? { quotes } : {}),
      });
    }

    const contracts = [...byContract.values()]
      .sort((a, b) => (b.counts.negative ?? 0) - (a.counts.negative ?? 0) || b.meetings.length - a.meetings.length)
      .map(({ labelsByMonth, ...rest }) => ({
        ...rest,
        ...(trend ? { trend: buildTrend(labelsByMonth) } : {}),
      }));

    const totals: Record<string, number> = {};
    for (const c of contracts) for (const [label, n] of Object.entries(c.counts)) totals[label] = (totals[label] ?? 0) + n;

    const scanned = data?.length ?? 0;
    return jsonResult({
      window: { start: start.toISOString(), end: end.toISOString() },
      labels_filter: labels ?? null,
      meetings_scanned: scanned,
      truncated: scanned >= capped,
      next_cursor: scanned >= capped ? String(offset + scanned) : null,
      totals_by_label: totals,
      contracts,
    });

  },
});