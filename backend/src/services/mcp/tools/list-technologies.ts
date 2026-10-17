import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, isAdminOrHigher, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "list_technologies",
  title: "Tech catalog (rate card)",
  description:
    "The Pulse technology catalog — the agency rate card. One row per tool with vendor, category, default client price, billing cadence, client-billable flag, agency-plan flag and active/total contract attachments. Owner/Admin also get default internal cost, agency_total_cost (agency plans are one bill split across active attachments) and paid_with (MiD card; client-billable per-client tools are paid on the client's own card, not tracked in Pulse).",
  inputSchema: {
    search: z.string().trim().optional().describe("Match tool name or vendor"),
    include_inactive: z.boolean().default(false).describe("Include retired catalog tools"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, include_inactive }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;
    const admin = isAdminOrHigher(auth.role);

    let q = supabase
      .from("technologies")
      .select(
        "technology_id, name, vendor, category, is_active, is_agency_plan, is_client_billable, default_client_price, default_internal_cost, default_billing_cadence, agency_total_cost, notes, payment_sources(name, last_four)"
      )
      .order("name");
    if (!include_inactive) q = q.eq("is_active", true);
    if (search) q = q.or(`name.ilike.%${search}%,vendor.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const { data: att } = await supabase.from("contract_technologies").select("technology_id, status").limit(10000);
    const counts = new Map<string, { active: number; total: number }>();
    for (const a of (att ?? []) as { technology_id: string; status: string }[]) {
      const c = counts.get(a.technology_id) ?? { active: 0, total: 0 };
      c.total++;
      if (a.status === "active") c.active++;
      counts.set(a.technology_id, c);
    }

    const rows = (data ?? []).map((t: Record<string, any>) => {
      const c = counts.get(t.technology_id) ?? { active: 0, total: 0 };
      const base = {
        technology_id: t.technology_id,
        name: t.name,
        vendor: t.vendor,
        category: t.category,
        is_active: t.is_active,
        is_agency_plan: t.is_agency_plan,
        client_billable: t.is_client_billable,
        default_client_price: t.default_client_price,
        billing_cadence: t.default_billing_cadence,
        active_attachments: c.active,
        total_attachments: c.total,
        notes: t.notes,
      };
      if (!admin) return base;
      const card = t.payment_sources
        ? `${t.payment_sources.name}${t.payment_sources.last_four ? ` (…${t.payment_sources.last_four})` : ""}`
        : null;
      return {
        ...base,
        default_internal_cost: t.default_internal_cost,
        agency_total_cost: t.agency_total_cost,
        allocated_cost_per_attachment:
          t.is_agency_plan && t.agency_total_cost != null && c.active > 0
            ? Math.round((Number(t.agency_total_cost) / c.active) * 100) / 100
            : null,
        paid_with: t.is_agency_plan
          ? card ?? "MiD card not set"
          : t.is_client_billable
            ? "Client's own card (not tracked in Pulse)"
            : card ?? "MiD card not set",
      };
    });

    return jsonResult({
      count: rows.length,
      technologies: rows,
      empty_reason: rows.length === 0 ? (search ? "no_match_for_search" : "catalog_empty") : null,
      last_refreshed_at: new Date().toISOString(),
    });
  },
});
