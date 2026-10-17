import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { APP_URL } from "../app-url.js";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "list_assignee_tasks",
  title: "List tasks by assignee",
  description:
    "Cross-contract task workload for one person. Answers 'what is <person> working on this week?'. Resolve the person by clickup_user_id (from list_people) or by name/email. Returns top-level, non-deleted tasks with contract name, status, points and due date. Use due_before/due_after for a date window.",
  inputSchema: {
    clickup_user_id: z.number().int().optional().describe("Preferred: from list_people"),
    person: z.string().trim().optional().describe("Name or email fallback, e.g. 'Nathalia Braga'"),
    status: z.string().trim().optional().describe("Task status, e.g. working, waiting on client, delivered"),
    statuses: z
      .array(z.string().trim())
      .optional()
      .describe("Multiple statuses to include, e.g. ['working','waiting on client']. Takes precedence over status."),
    open_only: z.boolean().default(true).describe("Exclude delivered/closed/cancelled tasks"),
    list_type: z.string().trim().optional().describe("e.g. Deliverables or ToDos"),
    due_after: z.string().optional().describe("ISO date (YYYY-MM-DD) lower bound on due date"),
    due_before: z.string().optional().describe("ISO date (YYYY-MM-DD) upper bound on due date"),
    contract_id: z.string().uuid().optional().describe("Limit to one contract"),
    limit: z.number().int().min(1).max(200).default(100),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (
    { clickup_user_id, person, status, statuses, open_only, list_type, due_after, due_before, contract_id, limit },
    ctx
  ) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;

    let userId = clickup_user_id;
    let resolved: { clickup_user_id: number; name: string | null; email: string | null } | null = null;

    if (!userId) {
      if (!person) return errorResult("Provide clickup_user_id or person (name/email).");
      const { data: matches, error: pErr } = await supabase
        .from("pulse_clickup_users")
        .select("id, username, full_name, email")
        .or(`username.ilike.%${person}%,full_name.ilike.%${person}%,email.ilike.%${person}%`)
        .limit(10);
      if (pErr) return errorResult(pErr.message);
      if (!matches || matches.length === 0) return errorResult(`No person matched "${person}". Try list_people.`);
      if (matches.length > 1) {
        return jsonResult({
          ambiguous: true,
          message: `Multiple people matched "${person}". Re-run with clickup_user_id.`,
          candidates: matches.map((m) => ({ clickup_user_id: m.id, name: m.full_name ?? m.username, email: m.email })),
        });
      }
      userId = matches[0].id as number;
      resolved = { clickup_user_id: userId, name: matches[0].full_name ?? matches[0].username, email: matches[0].email };
    }

    const wanted = (statuses?.length ? statuses : status ? [status] : []).map((s) => s.trim().toLowerCase());

    const { data, error } = await supabase.rpc("mcp_assignee_tasks", {
      p_clickup_user_id: userId,
      p_status: wanted.length === 1 ? wanted[0] : null,
      p_list_type: list_type ?? null,
      p_due_after: due_after ?? null,
      p_due_before: due_before ?? null,
      p_contract_id: contract_id ?? null,
      p_limit: wanted.length > 1 ? Math.min(200, limit * 3) : limit,
    });
    if (error) return errorResult(error.message);

    const closed = new Set(["delivered", "complete", "completed", "closed", "cancelled", "canceled", "archived"]);
    const tasks = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((t) => {
        const s = String(t.status ?? "").toLowerCase();
        if (wanted.length) return wanted.includes(s);
        return !open_only || !closed.has(s);
      })
      .slice(0, limit)
      .map((t): Record<string, unknown> => ({
        ...t,
        clickup_url: t.clickup_task_id ? `https://app.clickup.com/t/${t.clickup_task_id}` : null,
        app_url: `${APP_URL}/pulse/contracts/${t.contract_id}`,
      }));

    const byContract: Record<string, number> = {};
    for (const t of tasks) byContract[String(t.contract_name ?? "Unknown")] = (byContract[String(t.contract_name ?? "Unknown")] ?? 0) + 1;

    return jsonResult({
      person: resolved ?? { clickup_user_id: userId },
      count: tasks.length,
      tasks_by_contract: byContract,
      tasks,
    });
  },
});
