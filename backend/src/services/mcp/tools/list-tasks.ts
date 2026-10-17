import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "list_tasks",
  title: "List contract tasks",
  description:
    "List ClickUp-synced tasks for a contract (top-level only, excludes deleted/archived by default). Filter by status such as working, waiting on client, delivered.",
  inputSchema: {
    contract_id: z.string().uuid().describe("Contract UUID (use list_contracts or get_contract to resolve one)"),
    status: z.string().trim().optional().describe("Task status, e.g. 'working', 'delivered', 'waiting on client'"),
    include_archived: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contract_id, status, include_archived, limit }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;
    let q = supabase
      .from("pulse_tasks")
      .select("task_id, clickup_task_id, name, status, points, due_date, date_done, assignees, list_type, is_archived")
      .eq("contract_id", contract_id)
      .is("parent_task_id", null)
      .eq("is_deleted", false)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (!include_archived) q = q.eq("is_archived", false);
    if (status) q = q.ilike("status", status);

    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return jsonResult({ count: data?.length ?? 0, tasks: data ?? [] });
  },
});