/**
 * Transcript text extraction for RAG ingestion.
 *
 * compass_meetings.transcript is jsonb — it may arrive as:
 *   - string (pasted / manual entry)
 *   - TranscriptSegment[] (Fireflies, speaker-tagged)
 *   - arbitrary object (legacy / unknown shapes)
 *
 * Speaker tagging is preserved so vector search can return attributable
 * quotes ("Matt: ...") rather than anonymous text.
 */
export function extractTranscriptText(transcript: unknown): string {
  if (!transcript) return '';

  if (typeof transcript === 'string') return transcript;

  if (Array.isArray(transcript)) {
    const segments = transcript as { text?: string; speaker?: string }[];
    return segments
      .map((s) => {
        const text = s.text ?? '';
        if (!text) return '';
        return s.speaker ? `${s.speaker}: ${text}` : text;
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof transcript === 'object') return JSON.stringify(transcript);

  return '';
}
