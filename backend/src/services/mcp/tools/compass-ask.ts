import { defineTool } from "../define-tool.js";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";
import { z } from "zod";
import { streamChatResponse, type ContextSource, type WebSource } from "../../rag/chat.js";

export default defineTool({
  name: "compass_ask",
  title: "Ask Compass about a contract",
  description:
    "Ask Compass a question about ONE client contract and get a written answer. Compass reads that client's notes, meetings, deliverables and content, can search and read the web, and — when the contract has them connected — pulls the client's marketing performance (Databox: GA4, ad platforms) and SEO data. Use it for questions that need synthesis or outside research ('what did we agree on budget last month?', 'how did paid search perform in September?', 'who are their main competitors?'). For simple lookups (lists, counts, a single record) prefer the specific tools; they are faster. Answers can take up to a few minutes when web research is involved.",
  inputSchema: {
    contract_id: z.string().uuid().describe("Contract UUID (use list_contracts to find it)"),
    question: z.string().trim().min(1).max(4000).describe("The question, in plain language"),
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  handler: async ({ contract_id, question }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;

    // Compass chat reads some data through the service-level proxy, so confirm
    // under the caller's RLS that they can see this contract before running it.
    const { data: contract, error: contractErr } = await auth.supabase
      .from("contracts")
      .select("contract_id, contract_name")
      .eq("contract_id", contract_id)
      .maybeSingle();
    if (contractErr) return errorResult(contractErr.message);
    if (!contract) return errorResult("Contract not found, or you don't have access to it.");

    // Filled in by the stream callback below.
    const result = {
      answer: "",
      failure: null as string | null,
      contextSources: [] as ContextSource[],
      webSources: [] as WebSource[],
    };

    await streamChatResponse({ message: question, contract_id }, (chunk) => {
      if (chunk.type === "delta") result.answer += chunk.text;
      else if (chunk.type === "context") result.contextSources = chunk.sources;
      else if (chunk.type === "web_sources") result.webSources = chunk.sources;
      else if (chunk.type === "error") result.failure = chunk.message;
    });

    const { answer, failure, contextSources, webSources } = result;
    if (failure && !answer) return errorResult(`Compass couldn't answer: ${failure}`);

    return jsonResult({
      contract: { contract_id: contract.contract_id, contract_name: contract.contract_name },
      answer: answer.trim(),
      ...(failure ? { warning: failure } : {}),
      client_sources: contextSources.slice(0, 15).map((s) => ({
        title: s.title,
        source_type: s.source_type,
        source_id: s.source_id,
      })),
      web_sources: webSources,
    });
  },
});
