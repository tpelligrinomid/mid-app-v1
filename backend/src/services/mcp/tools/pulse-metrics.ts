import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, isAdminOrHigher, jsonResult, errorResult } from "../supabase.js";
import { fetchResolvedTech } from "../tech.js";

export default defineTool({
  name: "get_pulse_metrics",
  title: "Pulse business metrics",
  description:
    "Agency-level Pulse metrics (Owner/Admin only). mrr_trend: MRR by month with net churn components. points_summary: portfolio points. tech_spend: one row per contract with totals plus contract_name, contract_status and contract_amount. tech_breakdown: one row per contract per tool with resolved cost, price, margin, cadence, dates and paid_with — use this for portfolio tech audits in one call (set include_inactive=true to find tools left active or check offboarding). Internal cost includes agency-plan allocations.",
  inputSchema: {
    metric: z.enum(["mrr_trend", "points_summary", "tech_spend", "tech_breakdown"]).describe("Which metric set to return"),
    months: z.number().int().min(1).max(36).default(12).describe("How many recent months for mrr_trend"),
    include_inactive: z.boolean().default(false).describe("tech_breakdown only: include canceled tech rows"),
    limit: z.number().int().min(1).max(5000).default(50).describe("Row cap (tech_breakdown allows up to 5000)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ metric, months, include_inactive, limit }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    if (!isAdminOrHigher(auth.role)) {
      return errorResult("Agency-wide Pulse metrics are restricted to Owner and Admin accounts.");
    }
    const { supabase } = auth;
    const stamp = new Date().toISOString();

    if (metric === "mrr_trend") {
      const { data, error } = await supabase
        .from("mrr_monthly_rollup")
        .select("month, beginning_mrr, new_mrr, expansion_mrr, contraction_mrr, churn_mrr, manual_mrr, net_change_mrr, net_change_rate_pct, ending_mrr")
        .order("month", { ascending: false })
        .limit(months);
      if (error) return errorResult(error.message);
      return jsonResult({ metric, months: (data ?? []).reverse(), last_refreshed_at: stamp });
    }

    if (metric === "points_summary") {
      const { data, error } = await supabase.rpc("get_contract_points_summary", { p_contract_id: null });
      if (error) return errorResult(error.message);
      const rows = ((data as Record<string, unknown>[] | null) ?? []).slice(0, limit);
      return jsonResult({ metric, count: rows.length, contracts: rows, last_refreshed_at: stamp });
    }

    const { data: contracts, error: cErr } = await supabase
      .from("contracts")
      .select("contract_id, external_id, contract_name, contract_status, amount");
    if (cErr) return errorResult(cErr.message);
    const byId = new Map((contracts ?? []).map((c) => [c.contract_id, c]));
    const named = (id: string) => {
      const c = byId.get(id);
      return {
        contract_name: c?.contract_name ?? null,
        external_id: c?.external_id ?? null,
        contract_status: c?.contract_status ?? null,
        contract_amount: c?.amount ?? null,
      };
    };

    if (metric === "tech_breakdown") {
      const res = await fetchResolvedTech(supabase, { includeInactive: include_inactive, includeCost: true });
      if ("error" in res) return errorResult(res.error as string);
      const rows = res.rows.slice(0, limit).map((r) => ({ ...named(r.contract_id), ...r }));
      return jsonResult({
        metric,
        count: rows.length,
        total_available: res.rows.length,
        truncated: res.rows.length > rows.length,
        rows,
        last_refreshed_at: stamp,
      });
    }

    // tech_spend: per-contract totals, recomputed from resolved rows so agency-plan allocation is included.
    const res = await fetchResolvedTech(supabase, { includeInactive: true, includeCost: true });
    if ("error" in res) return errorResult(res.error as string);
    const agg = new Map<string, { active: number; total: number; cost: number; price: number }>();
    for (const r of res.rows as Array<Record<string, any>>) {
      const a = agg.get(r.contract_id) ?? { active: 0, total: 0, cost: 0, price: 0 };
      a.total++;
      if (r.status === "active") {
        a.active++;
        a.cost += Number(r.monthly_internal_cost || 0);
        a.price += Number(r.monthly_client_price || 0);
      }
      agg.set(r.contract_id, a);
    }
    const rows = [...agg.entries()]
      .map(([id, a]) => ({
        contract_id: id,
        ...named(id),
        active_tech_count: a.active,
        total_tech_count: a.total,
        active_monthly_internal_cost: Math.round(a.cost * 100) / 100,
        active_monthly_client_price: Math.round(a.price * 100) / 100,
        active_monthly_margin: Math.round((a.price - a.cost) * 100) / 100,
      }))
      .sort((x, y) => y.active_monthly_client_price - x.active_monthly_client_price)
      .slice(0, limit);
    return jsonResult({ metric, count: rows.length, rows, last_refreshed_at: stamp });
  },
});