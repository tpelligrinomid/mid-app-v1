import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, isAdminOrHigher, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "create_release_note",
  title: "Create a release note",
  description:
    "Publish an internal MiD platform release note. Restricted to Owner/Admin by database policy. Posts to the release-notes Slack channel automatically when published.",
  inputSchema: {
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).describe("Markdown body"),
    category: z.enum(["feature", "improvement", "fix"]).default("improvement"),
    note_type: z.string().trim().default("Frontend").describe("e.g. Frontend, Backend, Data"),
    publish: z.boolean().default(true),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, body, category, note_type, publish }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    if (!isAdminOrHigher(auth.role)) {
      return errorResult("Publishing release notes is restricted to Owner and Admin accounts.");
    }
    const { supabase } = auth;
    const { data, error } = await supabase
      .from("pulse_release_notes")
      .insert({
        title,
        body,
        category,
        note_type,
        is_published: publish,
        published_at: publish ? new Date().toISOString() : null,
      })
      .select("note_id, title, category, note_type, is_published, published_at");
    if (error) return errorResult(error.message);
    return jsonResult({ created: data?.[0] ?? null });
  },
});