import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "list_contracts",
  title: "List contracts",
  description:
    "List MiD contracts visible to the signed-in user. Supports search by name or contract ID, and filters for status, engagement type and priority tier.",
  inputSchema: {
    search: z.string().trim().optional().describe("Match contract name or external contract ID (e.g. MID2025...)"),
    status: z.enum(["active", "pending", "inactive", "canceled"]).optional(),
    engagement_type: z.string().trim().optional().describe("e.g. Retainer, Project, Hosting"),
    priority: z.number().int().min(1).max(5).optional().describe("Priority tier 1-5"),
    limit: z.number().int().min(1).max(200).default(50),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, status, engagement_type, priority, limit }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;
    let q = supabase
      .from("contracts")
      .select(
        "contract_id, external_id, contract_name, contract_status, contract_type, engagement_type, amount, payment_type, monthly_points_allotment, contract_start_date, contract_end_date, contract_renewal_date, account_manager, priority, hosting, industry"
      )
      .order("contract_name")
      .limit(limit);

    if (status) q = q.eq("contract_status", status);
    if (engagement_type) q = q.eq("engagement_type", engagement_type);
    if (priority) q = q.eq("priority", priority);
    if (search) q = q.or(`contract_name.ilike.%${search}%,external_id.ilike.%${search}%`);

    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return jsonResult({ count: data?.length ?? 0, contracts: data ?? [] });
  },
});