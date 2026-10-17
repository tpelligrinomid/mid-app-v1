/** Shared sentiment helpers for the MCP tools (quotes + trend). */

export const QUOTE_CHAR_CAP = 400;
export const QUOTE_RESPONSE_CAP = 40;

export type SentimentJson = {
  label?: string;
  confidence?: number;
  bullets?: string[];
  topics?: string[];
  quotes?: unknown;
} | null;

export function truncate(text: string, max = QUOTE_CHAR_CAP): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Up to `max` quotes from sentiment.quotes, falling back to a transcript snippet. */
export function extractQuotes(sentiment: SentimentJson, transcript: unknown, max = 3): string[] {
  const raw = sentiment?.quotes;
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const q of raw) {
      const text =
        typeof q === "string"
          ? q
          : q && typeof q === "object"
            ? String((q as Record<string, unknown>).quote ?? (q as Record<string, unknown>).text ?? "")
            : "";
      if (text.trim()) out.push(truncate(text));
      if (out.length >= max) return out;
    }
  }
  if (out.length) return out;

  // Fallback: a snippet of the transcript around the highest-signal topic.
  const body = typeof transcript === "string" ? transcript : "";
  if (!body) return out;
  const topic = sentiment?.topics?.[0];
  let idx = 0;
  if (topic) {
    const found = body.toLowerCase().indexOf(topic.toLowerCase());
    if (found > -1) idx = Math.max(0, found - 150);
  }
  const snippet = body.slice(idx, idx + QUOTE_CHAR_CAP + 50);
  if (snippet.trim()) out.push(truncate(snippet));
  return out;
}

const SCORE: Record<string, number> = { negative: -1, positive: 1, neutral: 0, mixed: 0 };

export interface TrendBucket {
  month: string;
  negative: number;
  mixed: number;
  neutral: number;
  positive: number;
  score: number;
}

export function buildTrend(labelsByMonth: Map<string, string[]>): {
  buckets: TrendBucket[];
  direction: "improving" | "declining" | "flat";
} {
  const buckets: TrendBucket[] = [...labelsByMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, labels]) => {
      const counts = { negative: 0, mixed: 0, neutral: 0, positive: 0 };
      let sum = 0;
      let scored = 0;
      for (const l of labels) {
        if (l in counts) counts[l as keyof typeof counts] += 1;
        if (l in SCORE) {
          sum += SCORE[l];
          scored += 1;
        }
      }
      return {
        month,
        ...counts,
        score: scored ? Math.round((sum / scored) * 100) / 100 : 0,
      };
    });

  if (buckets.length < 2) return { buckets, direction: "flat" };
  const last = buckets[buckets.length - 1].score;
  const prior = buckets.slice(0, -1);
  const mean = prior.reduce((s, b) => s + b.score, 0) / prior.length;
  const delta = last - mean;
  return {
    buckets,
    direction: delta > 0.15 ? "improving" : delta < -0.15 ? "declining" : "flat",
  };
}
