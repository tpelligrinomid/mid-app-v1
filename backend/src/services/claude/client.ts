/**
 * Claude API Client
 *
 * Uses native fetch to call Anthropic's Messages API (no SDK dependency).
 * Model: claude-sonnet-4-20250514 (fast + cost-effective for classification)
 *
 * Follows the embeddings.ts pattern: module-level config, withRetry, typed responses.
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const API_VERSION = '2023-06-01';

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }
  return key;
}

/**
 * Retry a function with exponential backoff on 429/529 (rate limit / overloaded) errors
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const isRetryable = msg.includes('429') || msg.includes('529');
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.warn(`[Claude] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

interface SendMessageOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Send a message to Claude and return the response text.
 */
export async function sendMessage(
  systemPrompt: string,
  userMessage: string,
  options: SendMessageOptions = {}
): Promise<string> {
  const apiKey = getApiKey();
  const {
    model = DEFAULT_MODEL,
    maxTokens = 1024,
    temperature = 0.5,
  } = options;

  const response = await withRetry(async () => {
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Claude API ${res.status}: ${errorText.substring(0, 200)}`);
    }

    return res;
  });

  const result = await response.json() as {
    content: { type: string; text: string }[];
  };

  const textBlock = result.content.find((b) => b.type === 'text');
  return textBlock?.text ?? '';
}
