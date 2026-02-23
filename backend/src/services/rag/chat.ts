/**
 * RAG Chat Service
 *
 * Orchestrates retrieval-augmented generation for the content library chat.
 * 1. Searches compass_knowledge for relevant context chunks
 * 2. Builds a system prompt with retrieved context
 * 3. Streams Claude's response via SSE
 */

import { searchKnowledge } from './search.js';
import type { SimilarityResult } from '../../types/rag.js';

// Claude API config (mirrors client.ts)
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const API_VERSION = '2023-06-01';

// ============================================================================
// Types
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  message: string;
  contract_id: string;
  conversation_history?: ChatMessage[];
}

export interface ContextSource {
  title: string;
  source_type: string;
  source_id: string;
  similarity: number;
}

export type SSEChunk =
  | { type: 'context'; sources: ContextSource[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; usage?: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; message: string };

// ============================================================================
// System Prompt
// ============================================================================

function buildSystemPrompt(results: SimilarityResult[]): string {
  const contextBlocks = results
    .map((r, i) => {
      return `[${i + 1}] Title: "${r.title}"\nSource: ${r.source_type}\n---\n${r.content}`;
    })
    .join('\n\n');

  return `You are a knowledgeable content analyst for a marketing agency. You have access to the following content from the client's content library. Use ONLY this context to answer questions. If the context doesn't contain enough information to answer, say so clearly.

When referencing specific content, mention the title so the user knows which piece you're referring to.

Keep your responses concise and actionable. If the user asks about topics, themes, or patterns, synthesize across multiple pieces of content.

## Retrieved Content

${contextBlocks}`;
}

// ============================================================================
// Stream Chat Response
// ============================================================================

/**
 * Stream a RAG-powered chat response.
 *
 * 1. Search knowledge base for relevant chunks
 * 2. Emit context sources via SSE
 * 3. Call Claude with streaming enabled
 * 4. Emit text deltas as they arrive
 * 5. Emit done event when complete
 */
export async function streamChatResponse(
  params: ChatParams,
  onChunk: (chunk: SSEChunk) => void
): Promise<void> {
  const { message, contract_id, conversation_history = [] } = params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    onChunk({ type: 'error', message: 'ANTHROPIC_API_KEY is not configured' });
    return;
  }

  // 1. Search for relevant context
  let results: SimilarityResult[];
  try {
    results = await searchKnowledge({
      query: message,
      contract_id,
      match_count: 8,
      match_threshold: 0.5,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown search error';
    console.error('[RAG Chat] Knowledge search failed:', errMsg);
    onChunk({ type: 'error', message: `Knowledge search failed: ${errMsg}` });
    return;
  }

  // 2. Emit context sources
  const sources: ContextSource[] = results.map((r) => ({
    title: r.title,
    source_type: r.source_type,
    source_id: r.source_id,
    similarity: r.similarity,
  }));
  onChunk({ type: 'context', sources });

  // 3. Build system prompt + messages
  const systemPrompt = results.length > 0
    ? buildSystemPrompt(results)
    : 'You are a knowledgeable content analyst for a marketing agency. The user is asking about their content library, but no relevant content was found in the knowledge base. Let them know you couldn\'t find matching content and suggest they try rephrasing their question or check that content has been ingested.';

  const messages = [
    ...conversation_history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];

  // 4. Call Claude with streaming
  let response: Response;
  try {
    response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        temperature: 0.3,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Failed to reach Claude API';
    console.error('[RAG Chat] Claude API request failed:', errMsg);
    onChunk({ type: 'error', message: `Claude API request failed: ${errMsg}` });
    return;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[RAG Chat] Claude API ${response.status}:`, errorText.substring(0, 300));
    onChunk({ type: 'error', message: `Claude API error (${response.status})` });
    return;
  }

  // 5. Parse SSE stream from Claude
  const reader = response.body?.getReader();
  if (!reader) {
    onChunk({ type: 'error', message: 'No response body from Claude API' });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        let event: {
          type: string;
          delta?: { type: string; text?: string };
          usage?: { input_tokens: number; output_tokens: number };
          message?: { usage?: { input_tokens: number; output_tokens: number } };
        };
        try {
          event = JSON.parse(data);
        } catch {
          continue; // Skip malformed JSON
        }

        // Extract text deltas
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          onChunk({ type: 'delta', text: event.delta.text });
        }

        // Capture usage from message_start
        if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens;
        }

        // Capture usage from message_delta
        if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens;
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Stream reading error';
    console.error('[RAG Chat] Stream error:', errMsg);
    onChunk({ type: 'error', message: `Stream error: ${errMsg}` });
    return;
  } finally {
    reader.releaseLock();
  }

  // 6. Done
  onChunk({
    type: 'done',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
}
