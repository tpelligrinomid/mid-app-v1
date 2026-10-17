import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { APP_URL } from "../app-url.js";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";
import { getServiceCategory, UNCATEGORIZED } from "../service-category.js";

const APP = APP_URL;
const MAX_ROWS = 200;

interface Row {
  task_id: string;
  clickup_task_id: string | null;
  name: string | null;
  status: string | null;
  points: number | null;
  date_done: string | null;
  custom_fields: unknown;
  assignees: unknown;
  contract_id: string;
  contract_name: string | null;
  external_id: string | null;
}

const round = (n: number) => Math.round(n * 4) / 4;

function assigneeNames(assignees: unknown): string[] {
  if (!Array.isArray(assignees)) return [];
  return (assignees as Array<Record<string, unknown>>)
    .map((a) => String(a.username ?? a.email ?? "").trim())
    .filter(Boolean);
}

function defaultWindow(): { from: string; to: string } {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default defineTool({
  name: "get_points_delivery",
  title: "Points delivered in a window",
  description:
    "Points delivered (completed work) over a date window, grouped by month, contract, service category or assignee. Answers 'how many points did we deliver for <contract> in July?' and 'which tasks consumed them?'. Omit contract to run portfolio-wide. Internal staff only (Owner/Admin/Team Member); client accounts are denied and results are always scoped by the signed-in user's contract access.",
  inputSchema: {
    contract: z
      .string()
      .trim()
      .optional()
      .describe("Contract UUID or external MID id. Omit for portfolio-wide delivery."),
    from: z.string().optional().describe("ISO date (YYYY-MM-DD) window start. Default: first day of 3 months ago."),
    to: z.string().optional().describe("ISO date (YYYY-MM-DD) window end (inclusive). Default: end of this month."),
    group_by: z.enum(["month", "contract", "service_category", "assignee"]).default("month"),
    include_tasks: z.boolean().default(false).describe("Include the underlying task rows"),
    limit: z.number().int().min(1).max(MAX_ROWS).default(50).describe("Max task rows returned (hard cap 200)"),
    cursor: z.string().optional().describe("Opaque cursor from a previous call's next_cursor"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contract, from, to, group_by, include_tasks, limit, cursor }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;

    const win = defaultWindow();
    const start = from ?? win.from;
    const end = to ?? win.to;

    let contractId: string | null = null;
    if (contract) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contract);
      if (isUuid) contractId = contract;
      else {
        const { data, error } = await supabase
          .from("contracts")
          .select("contract_id")
          .eq("external_id", contract)
          .limit(1);
        if (error) return errorResult(error.message);
        if (!data?.length) return errorResult(`No contract found for "${contract}" (or you don't have access to it).`);
        contractId = data[0].contract_id as string;
      }
    }

    const { data, error } = await supabase.rpc("mcp_points_delivery", {
      p_contract_id: contractId,
      p_from: start,
      p_to: end,
      p_limit: 5000,
    });
    if (error) return errorResult(error.message);
    const rows = (data ?? []) as Row[];

    const groups = new Map<string, { key: string; label: string; points_delivered: number; task_count: number }>();
    const contractsCovered = new Set<string>();
    let totalPoints = 0;

    const bump = (key: string, label: string, points: number) => {
      const g = groups.get(key) ?? { key, label, points_delivered: 0, task_count: 0 };
      g.points_delivered += points;
      g.task_count += 1;
      groups.set(key, g);
    };

    for (const r of rows) {
      const points = Number(r.points || 0);
      totalPoints += points;
      contractsCovered.add(r.contract_id);
      if (group_by === "month") {
        const key = (r.date_done ?? "").slice(0, 7);
        bump(key, key, points);
      } else if (group_by === "contract") {
        bump(r.contract_id, r.contract_name ?? "Unknown", points);
      } else if (group_by === "service_category") {
        const cat = getServiceCategory(r.custom_fields) || UNCATEGORIZED;
        bump(cat, cat, points);
      } else {
        const names = assigneeNames(r.assignees);
        if (!names.length) bump("unassigned", "Unassigned", points);
        else for (const n of names) bump(n, n, points / names.length);
      }
    }

    const groupList = [...groups.values()]
      .map((g) => ({ ...g, points_delivered: round(g.points_delivered) }))
      .sort((a, b) => (group_by === "month" ? a.key.localeCompare(b.key) : b.points_delivered - a.points_delivered));

    const offset = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
    const page = include_tasks ? rows.slice(offset, offset + Math.min(limit, MAX_ROWS)) : [];
    const nextOffset = offset + page.length;

    return jsonResult({
      window: { from: start, to: end },
      group_by,
      groups: groupList,
      totals: {
        points_delivered: round(totalPoints),
        task_count: rows.length,
        contracts_covered: contractsCovered.size,
      },
      ...(include_tasks
        ? {
            tasks: page.map((r) => ({
              task_id: r.task_id,
              clickup_task_id: r.clickup_task_id,
              name: r.name,
              status: r.status,
              points: Number(r.points || 0),
              date_done: r.date_done,
              service_category: getServiceCategory(r.custom_fields) || UNCATEGORIZED,
              contract_id: r.contract_id,
              contract_name: r.contract_name,
              external_id: r.external_id,
              clickup_url: r.clickup_task_id ? `https://app.clickup.com/t/${r.clickup_task_id}` : null,
              app_url: `${APP}/pulse/contracts/${r.contract_id}`,
            })),
            next_cursor: nextOffset < rows.length ? String(nextOffset) : null,
          }
        : {}),
    });
  },
});
