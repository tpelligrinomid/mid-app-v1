import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves contract tech rows the same way Pulse does: blank per-row values
 * inherit catalog defaults, agency-plan cost is split evenly across active
 * attachments, and client-billable per-client tools are paid on the client's card.
 */

type Tech = {
  technology_id: string;
  name: string;
  vendor: string | null;
  category: string | null;
  default_internal_cost: number | null;
  default_client_price: number | null;
  default_billing_cadence: string | null;
  is_agency_plan: boolean;
  agency_total_cost: number | null;
  is_client_billable: boolean;
  payment_sources: { name: string; last_four: string | null } | null;
};

type Row = {
  contract_technology_id: string;
  contract_id: string;
  instance_label: string | null;
  status: string;
  quantity: number | null;
  internal_cost: number | null;
  client_price: number | null;
  billing_cadence: string | null;
  client_billable_override: boolean | null;
  activated_on: string | null;
  deactivated_on: string | null;
  payment_sources: { name: string; last_four: string | null } | null;
  technologies: Tech | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const toMonthly = (amount: number | null, cadence: string) =>
  amount == null ? null : cadence === "annual" ? amount / 12 : cadence === "monthly" ? amount : 0;
const cardLabel = (p: { name: string; last_four: string | null } | null) =>
  p ? (p.last_four ? `${p.name} (…${p.last_four})` : p.name) : null;

export async function activeAttachmentCounts(supabase: SupabaseClient, techIds: string[]) {
  const counts = new Map<string, number>();
  if (!techIds.length) return counts;
  const { data } = await supabase
    .from("contract_technologies")
    .select("technology_id")
    .eq("status", "active")
    .in("technology_id", techIds);
  for (const r of (data ?? []) as { technology_id: string }[]) {
    counts.set(r.technology_id, (counts.get(r.technology_id) ?? 0) + 1);
  }
  return counts;
}

export async function fetchResolvedTech(
  supabase: SupabaseClient,
  opts: { contractIds?: string[]; includeInactive?: boolean; includeCost: boolean }
) {
  let q = supabase
    .from("contract_technologies")
    .select(
      "contract_technology_id, contract_id, instance_label, status, quantity, internal_cost, client_price, billing_cadence, client_billable_override, activated_on, deactivated_on, payment_sources(name, last_four), technologies(technology_id, name, vendor, category, default_internal_cost, default_client_price, default_billing_cadence, is_agency_plan, agency_total_cost, is_client_billable, payment_sources(name, last_four))"
    )
    .limit(5000);
  if (opts.contractIds) q = q.in("contract_id", opts.contractIds);
  if (!opts.includeInactive) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) return { error: error.message } as const;
  const rows = (data ?? []) as unknown as Row[];

  const agencyIds = [...new Set(rows.filter((r) => r.technologies?.is_agency_plan).map((r) => r.technologies!.technology_id))];
  const counts = await activeAttachmentCounts(supabase, agencyIds);

  const resolved = rows.map((r) => {
    const t = r.technologies;
    const cadence = r.billing_cadence ?? t?.default_billing_cadence ?? "monthly";
    const clientBillable = r.client_billable_override ?? t?.is_client_billable ?? true;
    const qty = r.quantity || 1;

    let internal: number | null = r.internal_cost ?? t?.default_internal_cost ?? null;
    let costSource = r.internal_cost != null ? "row" : internal != null ? "catalog_default" : "none";
    if (r.internal_cost == null && t?.is_agency_plan && t.agency_total_cost != null) {
      const n = counts.get(t.technology_id) ?? 0;
      internal = r.status === "active" && n > 0 ? Number(t.agency_total_cost) / n : 0;
      costSource = "agency_plan_allocation";
    }
    const price =
      r.client_price != null
        ? Number(r.client_price)
        : t?.default_client_price != null
          ? Number(t.default_client_price) * qty
          : null;

    // Card: agency plans use the catalog card; client-billable per-client tools are on the client's own card.
    let paid_with: string | null;
    if (t?.is_agency_plan) paid_with = cardLabel(t.payment_sources) ?? cardLabel(r.payment_sources) ?? "MiD card not set";
    else if (clientBillable) paid_with = "Client's own card (not tracked in Pulse)";
    else paid_with = cardLabel(r.payment_sources) ?? cardLabel(t?.payment_sources ?? null) ?? "MiD card not set";

    const base = {
      contract_technology_id: r.contract_technology_id,
      contract_id: r.contract_id,
      technology: t?.name ?? null,
      vendor: t?.vendor ?? null,
      category: t?.category ?? null,
      instance_label: r.instance_label,
      quantity: qty,
      status: r.status,
      activated_on: r.activated_on,
      deactivated_on: r.deactivated_on,
      is_agency_plan: !!t?.is_agency_plan,
      client_billable: clientBillable,
      billing_cadence: cadence,
      client_price: price,
      monthly_client_price: price == null ? null : round2(toMonthly(price, cadence)!),
      price_source: r.client_price != null ? "row" : price != null ? "catalog_default" : "none",
    };
    if (!opts.includeCost) return base;
    const monthlyCost = toMonthly(internal, cadence);
    const monthlyPrice = base.monthly_client_price;
    return {
      ...base,
      internal_cost: internal == null ? null : round2(internal),
      monthly_internal_cost: monthlyCost == null ? null : round2(monthlyCost),
      cost_source: costSource,
      monthly_margin: monthlyCost != null && monthlyPrice != null ? round2(monthlyPrice - monthlyCost) : null,
      paid_with,
    };
  });

  return { rows: resolved } as const;
}
