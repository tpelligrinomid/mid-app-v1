import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "create_note",
  title: "Create a Compass note",
  description:
    "Create a strategy note on a contract in Compass. The note is attributed to the signed-in user. Body is markdown.",
  inputSchema: {
    contract_id: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    content: z.string().trim().min(1).describe("Markdown body of the note"),
    note_type: z.string().trim().default("strategy").describe("Note type, e.g. strategy, weekly, internal"),
    note_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("YYYY-MM-DD; defaults to today"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ contract_id, title, content, note_type, note_date }, ctx) => {
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;
    const { data, error } = await supabase
      .from("compass_notes")
      .insert({
        contract_id,
        title,
        content_raw: content,
        note_type,
        note_date: note_date ?? new Date().toISOString().slice(0, 10),
        status: "draft",
        created_by: ctx.getUserId(),
      })
      .select("note_id, contract_id, title, note_type, note_date, status");
    if (error) return errorResult(error.message);
    return jsonResult({ created: data?.[0] ?? null });
  },
});