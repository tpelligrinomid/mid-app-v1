import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, isAdminOrHigher, jsonResult, errorResult } from "../supabase.js";
import { fetchResolvedTech } from "../tech.js";

export default defineTool({
  name: "get_contract",
  title: "Get contract detail",
  description:
    "Full detail for one contract: terms, points balance/burden, tech stack, and recent task counts. Accepts a contract UUID or an external contract ID like MID20253611. Tech stack rows are fully resolved: blank row values inherit catalog defaults, agency-plan cost is allocated across active attachments, and each row has billing_cadence, client_price, monthly_client_price, activated_on and deactivated_on. Owner/Admin also get internal_cost, monthly_margin, cost_source and paid_with (client-billable per-client tools are paid on the client's own card, which Pulse does not track). Set include_inactive=true to also see canceled tech rows (to verify offboarding). Pass from/to to also get points delivered in that window.",
  inputSchema: {
    contract: z.string().trim().min(3).describe("Contract UUID or external contract ID (MID...)"),
    include_inactive: z.boolean().default(false).describe("Also return canceled/inactive tech rows with their deactivated_on date"),
    from: z.string().optional().describe("ISO date (YYYY-MM-DD): start of an optional delivery window"),
    to: z.string().optional().describe("ISO date (YYYY-MM-DD): end of an optional delivery window (inclusive)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contract, include_inactive, from, to }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contract);

    const { data: rows, error } = await supabase
      .from("contracts")
      .select("*")
      .eq(isUuid ? "contract_id" : "external_id", contract)
      .limit(1);
    if (error) return errorResult(error.message);
    const row = rows?.[0];
    if (!row) return errorResult(`No contract found for "${contract}" (or you don't have access to it).`);

    const [points, tech] = await Promise.all([
      supabase.rpc("get_contract_points_summary", { p_contract_id: row.contract_id }),
      fetchResolvedTech(supabase, {
        contractIds: [row.contract_id],
        includeInactive: include_inactive,
        includeCost: isAdminOrHigher(auth.role),
      }),
    ]);
    if ("error" in tech) return errorResult(tech.error as string);

    let delivery_window: unknown = null;
    if (from || to) {
      const { data: delivered, error: deliveryErr } = await supabase.rpc("mcp_points_delivery", {
        p_contract_id: row.contract_id,
        p_from: from ?? null,
        p_to: to ?? null,
        p_limit: 5000,
      });
      if (deliveryErr) return errorResult(deliveryErr.message);
      const list = (delivered ?? []) as Array<{ points: number | null }>;
      const total = list.reduce((s, t) => s + Number(t.points || 0), 0);
      delivery_window = {
        from: from ?? null,
        to: to ?? null,
        points_delivered: Math.round(total * 4) / 4,
        task_count: list.length,
      };
    }

    const techRows = tech.rows;
    return jsonResult({
      contract: row,
      points_summary: (points.data as unknown[] | null)?.[0] ?? null,
      tech_stack: techRows,
      tech_stack_meta: {
        row_count: techRows.length,
        include_inactive,
        empty_reason: techRows.length === 0 ? (include_inactive ? "no_tech_records" : "no_active_tech (retry with include_inactive=true)") : null,
      },
      delivery_window,
      last_refreshed_at: new Date().toISOString(),
    });
  },
});
