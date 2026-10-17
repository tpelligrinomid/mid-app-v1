import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { APP_URL } from "../app-url.js";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";


function snippetFrom(body: string | null | undefined, query?: string, radius = 200): string | null {
  if (!body || !query) return null;
  const i = body.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return null;
  return body.slice(Math.max(0, i - radius), Math.min(body.length, i + radius + query.length));
}

export default defineTool({
  name: "search_compass",
  title: "Search Compass context",
  description:
    "Search Compass context — strategy notes, meetings (including transcript text), deliverables (including body content) and content assets — by keyword. Omit contract_id to search across every contract the signed-in user can see; pass contract_id to scope to one client. Set full_text=false to match titles only (faster). Each result includes an app_url deep link and, when available, a matching snippet.",
  inputSchema: {
    contract_id: z.string().uuid().optional().describe("Omit to search all visible contracts"),
    query: z.string().trim().optional().describe("Keyword to match in titles and (by default) body/transcript text"),
    full_text: z.boolean().default(true).describe("Search body/transcript content, not just titles"),
    since: z.string().optional().describe("ISO date (YYYY-MM-DD) lower bound on the record date"),
    until: z.string().optional().describe("ISO date (YYYY-MM-DD) upper bound on the record date"),
    sources: z
      .array(z.enum(["notes", "meetings", "deliverables", "content_assets"]))
      .default(["notes", "meetings", "deliverables"]),
    limit: z.number().int().min(1).max(50).default(15),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contract_id, query, full_text, since, until, sources, limit }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;
    const out: Record<string, unknown> = {};

    const scope = <T extends { eq: (c: string, v: unknown) => T; gte: (c: string, v: unknown) => T; lte: (c: string, v: unknown) => T }>(
      q: T,
      dateColumn: string
    ): T => {
      let next = q;
      if (contract_id) next = next.eq("contract_id", contract_id);
      if (since) next = next.gte(dateColumn, since);
      if (until) next = next.lte(dateColumn, until);
      return next;
    };

    try {
      if (sources.includes("notes")) {
        let q = scope(
          supabase
            .from("compass_notes")
            .select("note_id, contract_id, title, note_type, note_date, status, content_raw, contracts(contract_name, external_id)")
            .order("note_date", { ascending: false })
            .limit(limit),
          "note_date"
        );
        if (query) q = full_text ? q.or(`title.ilike.%${query}%,content_raw.ilike.%${query}%`) : q.ilike("title", `%${query}%`);
        const { data, error } = await q;
        if (error) throw error;
        out.notes = (data ?? []).map((n: Record<string, unknown>) => {
          const { content_raw, ...rest } = n;
          return {
            ...rest,
            snippet: snippetFrom(content_raw as string | null, full_text ? query : undefined),
            app_url: `${APP_URL}/compass/${n.contract_id}/notes`,
          };
        });
      }

      if (sources.includes("meetings")) {
        const { data, error } = await supabase.rpc("mcp_search_meetings", {
          p_query: full_text ? query ?? null : null,
          p_contract_id: contract_id ?? null,
          p_since: since ?? null,
          p_until: until ?? null,
          p_limit: limit,
        });
        if (error) throw error;
        let rows = (data ?? []) as Array<Record<string, unknown>>;
        if (query && !full_text) {
          const needle = query.toLowerCase();
          rows = rows.filter((m) => String(m.title ?? "").toLowerCase().includes(needle));
        }
        out.meetings = rows.map((m) => ({
          ...m,
          app_url: `${APP_URL}/compass/${m.contract_id}/meetings`,
        }));
      }

      if (sources.includes("deliverables")) {
        let q = scope(
          supabase
            .from("compass_deliverables")
            .select(
              "deliverable_id, contract_id, title, deliverable_type, status, due_date, delivered_date, content_raw, contracts(contract_name, external_id)"
            )
            .order("updated_at", { ascending: false })
            .limit(limit),
          "updated_at"
        );
        if (query) q = full_text ? q.or(`title.ilike.%${query}%,content_raw.ilike.%${query}%`) : q.ilike("title", `%${query}%`);
        const { data, error } = await q;
        if (error) throw error;
        out.deliverables = (data ?? []).map((d: Record<string, unknown>) => {
          const { content_raw, ...rest } = d;
          return {
            ...rest,
            snippet: snippetFrom(content_raw as string | null, full_text ? query : undefined),
            app_url: `${APP_URL}/compass/${d.contract_id}/deliverables/${d.deliverable_id}`,
          };
        });
      }

      if (sources.includes("content_assets")) {
        let q = scope(
          supabase
            .from("content_assets")
            .select("asset_id, contract_id, title, asset_type, status, published_date, content_body")
            .order("updated_at", { ascending: false })
            .limit(limit),
          "updated_at"
        );
        if (query)
          q = full_text
            ? q.or(`title.ilike.%${query}%,description.ilike.%${query}%,content_body.ilike.%${query}%`)
            : q.ilike("title", `%${query}%`);
        const { data, error } = await q;
        if (error) throw error;
        out.content_assets = (data ?? []).map((a: Record<string, unknown>) => {
          const { content_body, ...rest } = a;
          return {
            ...rest,
            snippet: snippetFrom(content_body as string | null, full_text ? query : undefined),
            app_url: `${APP_URL}/compass/${a.contract_id}/content-ops/assets`,
          };
        });
      }
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }

    return jsonResult({ scope: contract_id ? "single_contract" : "all_visible_contracts", full_text, ...out });
  },
});
