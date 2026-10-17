import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { APP_URL } from "../app-url.js";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "list_portfolio_tasks",
  title: "List tasks across all contracts",
  description:
    "Cross-account task view. Answers portfolio questions like 'what is overdue across all accounts?' or 'everything in working status this week' in ONE call — never loop list_tasks contract by contract. IMPORTANT: pass status='working' (or statuses=['working','waiting on client']) when the question is about specific statuses, and overdue_only=true when the question is about overdue work — results are NOT filtered unless you pass these. Rows include the ClickUp task id and an app_url deep link. Returns tasks plus per-contract and per-status rollups.",
  inputSchema: {
    status: z.string().trim().optional().describe("Exact task status, e.g. 'working', 'waiting on client', 'delivered'. Required for 'in working' questions."),
    statuses: z
      .array(z.string().trim())
      .optional()
      .describe("Multiple statuses to include, e.g. ['working','waiting on client']. Takes precedence over status."),
    open_only: z.boolean().default(true).describe("Exclude delivered/closed/cancelled tasks"),
    list_type: z.string().trim().optional().describe("e.g. Deliverables or ToDos"),
    overdue_only: z.boolean().default(false).describe("Only tasks with a due date in the past. Set true for overdue questions."),
    due_after: z.string().optional().describe("ISO date (YYYY-MM-DD) lower bound on due date"),
    due_before: z.string().optional().describe("ISO date (YYYY-MM-DD) upper bound on due date"),
    contract_search: z.string().trim().optional().describe("Limit to contracts matching this name or MID id"),
    summary_only: z.boolean().default(false).describe("Return only the rollups, no task rows"),
    limit: z.number().int().min(1).max(500).default(200),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (
    { status, statuses, open_only, list_type, overdue_only, due_after, due_before, contract_search, summary_only, limit },
    ctx
  ) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;

    const wanted = (statuses?.length ? statuses : status ? [status] : []).map((s) => s.trim().toLowerCase());

    const { data, error } = await supabase.rpc("mcp_portfolio_tasks", {
      p_status: wanted.length === 1 ? wanted[0] : null,
      p_list_type: list_type ?? null,
      p_overdue_only: overdue_only,
      p_due_after: due_after ?? null,
      p_due_before: due_before ?? null,
      p_contract_search: contract_search ?? null,
      p_limit: wanted.length > 1 ? Math.min(500, limit * 3) : limit,
    });
    if (error) return errorResult(error.message);

    const closed = new Set(["delivered", "complete", "completed", "closed", "cancelled", "canceled", "archived"]);
    const now = Date.now();
    const rows = ((data ?? []) as Array<Record<string, unknown>>).filter((t) => {
      const s = String(t.status ?? "").toLowerCase();
      if (wanted.length && !wanted.includes(s)) return false;
      if (open_only && !wanted.length && closed.has(s)) return false;
      if (overdue_only) {
        const d = t.due_date ? new Date(String(t.due_date)).getTime() : NaN;
        if (Number.isNaN(d) || d >= now) return false;
      }
      return true;
    });
    const byContract: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const t of rows) {
      const c = String(t.contract_name ?? "Unknown");
      byContract[c] = (byContract[c] ?? 0) + 1;
      const s = String(t.status ?? "unknown");
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }

    const tasks = rows.slice(0, limit).map((t) => ({
      task_id: t.task_id,
      clickup_task_id: t.clickup_task_id,
      clickup_url: t.clickup_task_id ? `https://app.clickup.com/t/${t.clickup_task_id}` : null,
      app_url: `${APP_URL}/pulse/contracts/${t.contract_id}`,
      name: t.name,
      status: t.status,
      points: t.points,
      due_date: t.due_date,
      days_overdue: t.days_overdue,
      list_type: t.list_type,
      contract_id: t.contract_id,
      contract_name: t.contract_name,
      contract_external_id: t.contract_external_id,
      assignees: Array.isArray(t.assignees)
        ? (t.assignees as Array<Record<string, unknown>>).map((a) => a.username ?? a.email)
        : [],
    }));

    return jsonResult({
      count: tasks.length,
      truncated: tasks.length >= limit,
      tasks_by_contract: byContract,
      tasks_by_status: byStatus,
      ...(summary_only ? {} : { tasks }),
    });
  },
});
