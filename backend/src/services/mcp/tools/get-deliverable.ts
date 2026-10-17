import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "get_deliverable",
  title: "Get deliverable content",
  description:
    "Read one Compass deliverable including its markdown (content_raw) and structured JSON content (roadmaps, SEO audits, points plans).",
  inputSchema: {
    deliverable_id: z.string().uuid(),
    include_structured: z.boolean().default(true).describe("Include the structured JSON body (can be large)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ deliverable_id, include_structured }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;
    const cols =
      "deliverable_id, contract_id, title, description, deliverable_type, status, version, due_date, delivered_date, drive_url, tags, content_raw" +
      (include_structured ? ", content_structured" : "");
    const { data, error } = await supabase
      .from("compass_deliverables")
      .select(cols)
      .eq("deliverable_id", deliverable_id)
      .limit(1);
    if (error) return errorResult(error.message);
    if (!data?.length) return errorResult("Deliverable not found or not visible to you.");
    return jsonResult({ deliverable: data[0] });
  },
});