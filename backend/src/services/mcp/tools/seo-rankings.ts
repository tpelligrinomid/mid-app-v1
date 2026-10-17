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
import { NightwatchManager } from "../../nightwatch/manage.js";

const MANAGE_TOOLS = new Set(["add_seo_keywords", "remove_seo_keywords", "tag_seo_keywords", "manage_seo_competitor", "get_seo_serp", "suggest_seo_keywords", "suggest_ai_prompts"]);

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

  const runner = MANAGE_TOOLS.has(tool) ? new NightwatchManager(integration.external_id) : new NightwatchToolRunner(integration.external_id);
  const result = JSON.parse(await runner.run(tool, input));
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

const confirm = z
  .boolean()
  .optional()
  .describe("Leave unset to get a preview; set true only after the user confirmed that exact change");
const CHANGE_NOTE =
  " Two-step: call without confirm to get a preview, show it to the user, and call again with confirm=true only after they explicitly agree.";

export const seoAddKeywords = defineTool({
  name: "add_seo_keywords",
  title: "Track new SEO keywords (Nightwatch)",
  description: "Start tracking new keywords for one client in Nightwatch (Google, daily). Uses keyword quota." + CHANGE_NOTE,
  inputSchema: {
    contract_id: contractId,
    keywords: z.array(z.string().trim().min(1)).min(1).max(100),
    device: z.enum(["desktop", "mobile", "both"]).optional().describe("Default desktop; both = tracked twice"),
    location: z.string().trim().optional().describe('City/region for local tracking, e.g. "Chicago, Illinois"'),
    tags: z.array(z.string().trim().min(1)).optional(),
    confirm,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "add_seo_keywords", input),
});

export const seoRemoveKeywords = defineTool({
  name: "remove_seo_keywords",
  title: "Stop tracking SEO keywords (Nightwatch)",
  description: "Stop tracking keywords for one client; their ranking history in Nightwatch is deleted. Exact tracked texts only." + CHANGE_NOTE,
  inputSchema: { contract_id: contractId, keywords: z.array(z.string().trim().min(1)).min(1).max(100), confirm },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "remove_seo_keywords", input),
});

export const seoTagKeywords = defineTool({
  name: "tag_seo_keywords",
  title: "Tag SEO keywords (Nightwatch)",
  description: "Add tags to one client's tracked keywords (existing tags kept)." + CHANGE_NOTE,
  inputSchema: {
    contract_id: contractId,
    keywords: z.array(z.string().trim().min(1)).min(1).max(100),
    tags: z.array(z.string().trim().min(1)).min(1),
    confirm,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "tag_seo_keywords", input),
});

export const seoManageCompetitor = defineTool({
  name: "manage_seo_competitor",
  title: "Add or remove an SEO competitor (Nightwatch)",
  description: "Add or remove a competitor domain tracked against one client's keywords." + CHANGE_NOTE,
  inputSchema: { contract_id: contractId, action: z.enum(["add", "remove"]), domain: z.string().trim().min(3), confirm },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "manage_seo_competitor", input),
});

export const seoSerp = defineTool({
  name: "get_seo_serp",
  title: "Google results page for a keyword (Nightwatch)",
  description: "Latest full Google results page for one of a client's tracked keywords: who ranks around them, local pack, AI Overview and other features.",
  inputSchema: { contract_id: contractId, keyword: z.string().trim().min(1) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "get_seo_serp", input),
});

export const seoSuggestKeywords = defineTool({
  name: "suggest_seo_keywords",
  title: "Keyword ideas for a client (Nightwatch)",
  description: "Keyword ideas for one client's site with search volume, CPC and competition. Read-only; use before add_seo_keywords.",
  inputSchema: { contract_id: contractId, limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "suggest_seo_keywords", input),
});

export const seoSuggestPrompts = defineTool({
  name: "suggest_ai_prompts",
  title: "AI prompt ideas (Nightwatch)",
  description: "Suggested AI-search prompts (what people ask ChatGPT, Perplexity, etc.) for a topic, for a client's AI-visibility tracking. Read-only.",
  inputSchema: { contract_id: contractId, topic: z.string().trim().min(2) },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  handler: async ({ contract_id, ...input }, ctx) => runForContract(ctx, contract_id, "suggest_ai_prompts", input),
});
