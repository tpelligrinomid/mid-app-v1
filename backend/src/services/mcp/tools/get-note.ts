import { defineTool } from "../define-tool.js";
import { z } from "zod";
import { requireInternalUser, jsonResult, errorResult } from "../supabase.js";

export default defineTool({
  name: "get_note_or_meeting",
  title: "Get note or meeting",
  description:
    "Read the full body of a Compass strategy note or the transcript/sentiment of a meeting. Provide exactly one of note_id or meeting_id.",
  inputSchema: {
    note_id: z.string().uuid().optional(),
    meeting_id: z.string().uuid().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ note_id, meeting_id }, ctx) => {
    if (!note_id && !meeting_id) return errorResult("Provide note_id or meeting_id.");
    const auth = await requireInternalUser(ctx);
    if ("error" in auth) return auth.error;
    const { supabase } = auth;

    if (note_id) {
      const { data, error } = await supabase
        .from("compass_notes")
        .select("note_id, contract_id, title, note_type, note_date, status, content_raw, action_items")
        .eq("note_id", note_id)
        .limit(1);
      if (error) return errorResult(error.message);
      if (!data?.length) return errorResult("Note not found or not visible to you.");
      return jsonResult({ note: data[0] });
    }

    const { data, error } = await supabase
      .from("compass_meetings")
      .select("meeting_id, contract_id, title, meeting_date, source, participants, duration_seconds, sentiment, transcript")
      .eq("meeting_id", meeting_id!)
      .limit(1);
    if (error) return errorResult(error.message);
    if (!data?.length) return errorResult("Meeting not found or not visible to you.");
    return jsonResult({ meeting: data[0] });
  },
});