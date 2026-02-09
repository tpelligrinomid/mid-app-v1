/**
 * OpenAI Embeddings Service
 *
 * Uses native fetch to call OpenAI's embedding API (no SDK dependency).
 * Model: text-embedding-3-small (1536 dimensions)
 */

import type { EmbeddingResult } from '../../types/rag.js';

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_BATCH_SIZE = 100;
// Safety: truncate any input to ~6000 tokens worth of characters (8191 limit)
// cl100k_base worst case is ~3 chars/token, so 18000 chars ≈ 6000 tokens
const MAX_INPUT_CHARS = 18000;

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  return key;
}

/**
 * Retry a function with exponential backoff on 429 (rate limit) errors
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err instanceof Error && err.message.includes('429');
      if (!isRateLimit || attempt === maxRetries) {
        throw err;
      }
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.warn(`[Embeddings] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

/**
 * Call OpenAI embeddings API for one or more texts
 */
async function callEmbeddingsApi(
  texts: string[]
): Promise<{ embedding: number[]; tokens: number }[]> {
  const apiKey = getApiKey();

  // Safety truncation: prevent any single input from exceeding token limit
  const safeTexts = texts.map((t) =>
    t.length > MAX_INPUT_CHARS ? t.substring(0, MAX_INPUT_CHARS) : t
  );

  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: safeTexts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embeddings API ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const result = await response.json() as {
    data: { embedding: number[]; index: number }[];
    usage: { prompt_tokens: number; total_tokens: number };
  };

  // Sort by index to match input order
  const sorted = result.data.sort((a, b) => a.index - b.index);
  const tokensPerItem = Math.ceil(result.usage.total_tokens / texts.length);

  return sorted.map((item) => ({
    embedding: item.embedding,
    tokens: tokensPerItem,
  }));
}

/**
 * Get embedding for a single text
 */
export async function getEmbedding(text: string): Promise<EmbeddingResult> {
  const results = await withRetry(() => callEmbeddingsApi([text]));
  return {
    embedding: results[0].embedding,
    tokens_used: results[0].tokens,
  };
}

/**
 * Get embeddings for multiple texts (batched, up to 100 per API call)
 */
export async function getEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
  const allResults: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const results = await withRetry(() => callEmbeddingsApi(batch));
    allResults.push(
      ...results.map((r) => ({
        embedding: r.embedding,
        tokens_used: r.tokens,
      }))
    );
  }

  return allResults;
}
