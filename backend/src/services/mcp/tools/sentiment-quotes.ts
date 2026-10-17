import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { APP_URL } from "../app-url.js";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";
import { extractQuotes, QUOTE_RESPONSE_CAP, type SentimentJson } from "../sentiment.js";

const APP = APP_URL;

export default defineTool({
  name: "get_sentiment_quotes",
  title: "Meeting sentiment quotes",
  description:
    "Flattened, citable client quotes from meeting sentiment for ONE contract over a date window. Use after get_sentiment_pulse when you need evidence to quote directly. Never returns full transcripts (use get_note_or_meeting for that). Internal staff only; scoped by the signed-in user's contract access.",
  inputSchema: {
    contract_id: z.string().uuid().describe("Contract UUID"),
    days: z.number().int().min(1).max(365).default(90).describe("Look-back window in days (ignored if since is set)"),
    since: z.string().optional().describe("ISO date (YYYY-MM-DD) start of window"),
    until: z.string().optional().describe("ISO date (YYYY-MM-DD) end of window"),
    labels: z.array(z.string()).optional().describe("Only meetings with these sentiment labels"),
    per_meeting: z.number().int().min(1).max(5).default(3).describe("Max quotes per meeting"),
    limit: z.number().int().min(1).max(QUOTE_RESPONSE_CAP).default(QUOTE_RESPONSE_CAP).describe("Max quotes returned (hard cap 40)"),
    cursor: z.string().optional().describe("Opaque cursor from a previous call's next_cursor"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contract_id, days, since, until, labels, per_meeting, limit, cursor }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;

    const end = until ? new Date(`${until}T23:59:59Z`) : new Date();
    const start = since ? new Date(`${since}T00:00:00Z`) : new Date(end.getTime() - days * 86400000);

    const { data, error } = await supabase
      .from("compass_meetings")
      .select("meeting_id, contract_id, title, meeting_date, source, sentiment, transcript, contracts(contract_name, external_id)")
      .eq("contract_id", contract_id)
      .gte("meeting_date", start.toISOString())
      .lte("meeting_date", end.toISOString())
      .order("meeting_date", { ascending: false })
      .limit(100);
    if (error) return errorResult(error.message);

    const wanted = labels?.map((l) => l.toLowerCase());
    const all: Array<Record<string, unknown>> = [];
    for (const row of data ?? []) {
      const sentiment = (row as { sentiment: SentimentJson }).sentiment;
      const label = (sentiment?.label ?? "unscored").toLowerCase();
      if (wanted && !wanted.includes(label)) continue;
      const contract = (row as { contracts?: { contract_name?: string; external_id?: string | null } | null }).contracts;
      for (const quote of extractQuotes(sentiment, (row as { transcript?: unknown }).transcript, per_meeting)) {
        all.push({
          quote,
          sentiment_label: label,
          confidence: sentiment?.confidence ?? null,
          topics: sentiment?.topics?.slice(0, 6) ?? [],
          meeting_id: row.meeting_id,
          meeting_title: row.title,
          meeting_date: row.meeting_date,
          source: row.source,
          contract_id: row.contract_id,
          contract_name: contract?.contract_name ?? null,
          external_id: contract?.external_id ?? null,
          app_url: `${APP}/compass/${row.contract_id}/meetings`,
        });
      }
    }

    const offset = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
    const capped = Math.min(limit, QUOTE_RESPONSE_CAP);
    const page = all.slice(offset, offset + capped);
    const nextOffset = offset + page.length;

    return jsonResult({
      window: { start: start.toISOString(), end: end.toISOString() },
      count: page.length,
      total_available: all.length,
      quotes: page,
      next_cursor: nextOffset < all.length ? String(nextOffset) : null,
    });
  },
});
