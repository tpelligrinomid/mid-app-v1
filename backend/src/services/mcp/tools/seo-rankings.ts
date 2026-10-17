/**
 * Nightwatch SEO tools for the MCP, scoped per contract (docs/data-tools-architecture.md):
 * contract_id is required; the caller's access to the contract is checked under
 * RLS; the Nightwatch URL is resolved server-side from contract_integrations —
 * there is no site/project input, so a caller can't reach another client's data.
 */
import { z } from "zod";
import { defineTool, type ToolContext } from "../define-tool.js";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";
import { nightwatchConfigured } from "../../nightwatch/client.js";
import { NightwatchToolRunner } from "../../nightwatch/tools.js";

async function runForContract(ctx: ToolContext, contractId: string, tool: string, input: Record<string, unknown>) {
  const auth = await requireInternalUser(ctx);
  if ("error" in auth) return auth.error;
  if (!nightwatchConfigured()) return errorResult("Nightwatch isn't configured on the server.");

  const { data: contract, error: contractErr } = await auth.supabase
    .from("contracts")
    .select("contract_id, contract_name")
    .eq("contract_id", contractId)
    .maybeSingle();
  if (contractErr) return errorResult(contractErr.message);
  if (!contract) return errorResult("Contract not found, or you don't have access to it.");

  const { data: integration, error: intErr } = await auth.supabase
    .from("contract_integrations")
    .select("external_id")
    .eq("contract_id", contractId)
    .eq("provider", "nightwatch")
    .maybeSingle();
  if (intErr) return errorResult(intErr.message);
  if (!integration?.external_id) {
    return errorResult(`${contract.contract_name} has no Nightwatch site connected. Connect one in the contract settings.`);
  }

  const result = JSON.parse(await new NightwatchToolRunner(integration.external_id).run(tool, input));
  return jsonResult({ contract: { contract_id: contract.contract_id, contract_name: contract.contract_name }, ...result });
}

const contractId = z.string().uuid().describe("Contract UUID (use list_contracts to find it)");

export const seoRankings = defineTool({
  name: "get_seo_rankings",
  title: "SEO rankings (Nightwatch)",
  description:
    "Current Google rankings for one client's tracked keywords (Nightwatch, daily). Each keyword: position (best across result types such as local pack, AI Overview, featured snippet), organic position, ranking URL, AI Overview / featured snippet presence, search volume, Search Console clicks/impressions. Always distinguish position from organic position.",
  inputSchema: {
    contract_id: contractId,
    search: z.string().trim().optional().describe("Only keywords containing this text"),
    tag: z.string().trim().optional().describe("Only keywords with this Nightwatch tag"),
    max_position: z.number().int().min(1).max(100).optional().describe("Only keywords at or above this position (10 = page one)"),
    sort: z.enum(["position", "volume", "clicks"]).optional(),
    limit: z.number().int().min(1).max(300).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "get_seo_rankings", input),
});

export const seoRankingHistory = defineTool({
  name: "get_seo_ranking_history",
  title: "SEO ranking history (Nightwatch)",
  description:
    "Daily ranking history for up to 10 of one client's tracked keywords over a date range (history exists from when tracking started). One point per day: position, organic position, ranking URL.",
  inputSchema: {
    contract_id: contractId,
    keywords: z.array(z.string().trim().min(1)).min(1).max(10).describe("Tracked keyword texts (exact or a distinctive part)"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date YYYY-MM-DD"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD (default today)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "get_seo_ranking_history", input),
});

export const seoMovers = defineTool({
  name: "get_seo_movers",
  title: "SEO ranking movers (Nightwatch)",
  description:
    "Biggest ranking gains and losses across one client's tracked keywords over the last 1, 7 or 30 days, from actual daily positions (positive change = moved up), plus keywords entering or dropping out of the top 100.",
  inputSchema: {
    contract_id: contractId,
    days: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional().describe("Look-back window (default 7)"),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "get_seo_movers", input),
});

export const seoCompetitors = defineTool({
  name: "get_seo_competitors",
  title: "SEO competitors (Nightwatch)",
  description: "Competitor domains tracked in Nightwatch for one client's site.",
  inputSchema: { contract_id: contractId },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id }, ctx) => runForContract(ctx, contract_id, "get_seo_competitors", {}),
});
