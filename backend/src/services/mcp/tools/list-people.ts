import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "list_people",
  title: "List people",
  description:
    "Directory of MiD team members (ClickUp-synced) and platform users. Use this FIRST to resolve a person's name to their ClickUp user id and email before calling list_assignee_tasks.",
  inputSchema: {
    search: z.string().trim().optional().describe("Partial name or email, e.g. 'Nathalia' or 'nathalia.braga@'"),
    assignable_only: z.boolean().default(true).describe("Only people who can be assigned ClickUp tasks"),
    limit: z.number().int().min(1).max(200).default(50),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, assignable_only, limit }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;

    let q = supabase
      .from("pulse_clickup_users")
      .select("id, username, full_name, email, initials, user_type, is_assignable")
      .order("username")
      .limit(limit);
    if (assignable_only) q = q.eq("is_assignable", true);
    if (search) q = q.or(`username.ilike.%${search}%,full_name.ilike.%${search}%,email.ilike.%${search}%`);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    return jsonResult({
      count: data?.length ?? 0,
      people: (data ?? []).map((p) => ({
        clickup_user_id: p.id,
        name: p.full_name ?? p.username,
        email: p.email,
        initials: p.initials,
        is_assignable: p.is_assignable,
      })),
      next_step: "Pass clickup_user_id (or the person's name) to list_assignee_tasks to see their workload.",
    });
  },
});
