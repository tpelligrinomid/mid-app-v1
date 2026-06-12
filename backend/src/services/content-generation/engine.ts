/**
 * Content Generation — Execution Engine
 *
 * Runs a prompt sequence step-by-step through Claude with SSE streaming.
 * Auto-resolves variables from the asset/contract/brand voice.
 * Pipes output between steps via {{step:key}} references.
 */

import { resolveTemplate } from './templates.js';
import { gatherGenerationContext } from './context.js';
import { select, update } from '../../utils/edge-functions.js';
import { ingestContent } from '../rag/ingestion.js';
import type { PromptStep } from '../../types/content.js';

// Claude API config (matches chat.ts)
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-4-7';
const API_VERSION = '2023-06-01';

// ============================================================================
// Types
// ============================================================================

export type GenerationSSEChunk =
  | { type: 'context'; sources: Array<{ title: string; source_type: string; source_id: string; similarity: number }> }
  | { type: 'step_start'; step: string; step_number: number; total_steps: number }
  | { type: 'delta'; text: string }
  | { type: 'step_complete'; step: string; tokens: { input: number; output: number } }
  | { type: 'done'; total_tokens: { input: number; output: number } }
  | { type: 'error'; message: string };

export interface GenerateParams {
  asset_id: string;
  contract_id: string;
  sequence_id?: string;
  reference_asset_ids?: string[];
  reference_deliverable_ids?: string[];
  variables?: Record<string, string>;
  auto_retrieve?: boolean;
  additional_instructions?: string;
}

interface SequenceRow {
  sequence_id: string;
  name: string;
  steps: PromptStep[];
  content_type_slug: string;
}

interface AssetTypeRow {
  content_type_id: string | null;
  content_types?: { slug: string } | null;
}

// ============================================================================
// Sequence Resolution
// ============================================================================

/**
 * Find the right prompt sequence for this asset.
 * Priority: explicit sequence_id > contract-specific default > global default.
 */
async function resolveSequence(
  assetId: string,
  contractId: string,
  sequenceId?: string
): Promise<SequenceRow> {
  // Explicit override
  if (sequenceId) {
    const rows = await select<SequenceRow[]>('content_prompt_sequences', {
      select: 'sequence_id, name, steps, content_type_slug',
      filters: { sequence_id: sequenceId, is_active: true },
      limit: 1,
    });
    if (!rows?.[0]) throw new Error(`Prompt sequence ${sequenceId} not found or inactive`);
    return rows[0];
  }

  // Look up the asset's content type slug
  const assetRows = await select<AssetTypeRow[]>('content_assets', {
    select: 'content_type_id, content_types(slug)',
    filters: { asset_id: assetId },
    limit: 1,
  });

  const contentTypeSlug = assetRows?.[0]?.content_types?.slug;
  if (!contentTypeSlug) {
    throw new Error('Asset has no content type assigned. Please set a content type before generating.');
  }

  // Contract-specific default first
  const contractSeqs = await select<SequenceRow[]>('content_prompt_sequences', {
    select: 'sequence_id, name, steps, content_type_slug',
    filters: { contract_id: contractId, content_type_slug: contentTypeSlug, is_default: true, is_active: true },
    limit: 1,
  });
  if (contractSeqs?.[0]) return contractSeqs[0];

  // Global default fallback
  const globalSeqs = await select<SequenceRow[]>('content_prompt_sequences', {
    select: 'sequence_id, name, steps, content_type_slug',
    filters: { contract_id: { is: null }, content_type_slug: contentTypeSlug, is_default: true, is_active: true },
    limit: 1,
  });
  if (globalSeqs?.[0]) return globalSeqs[0];

  throw new Error(`No prompt sequence found for content type "${contentTypeSlug}". Create one in the Prompts management UI.`);
}

// ============================================================================
// Claude Streaming
// ============================================================================

async function streamClaudeStep(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  onDelta: (text: string) => void
): Promise<{ fullText: string; inputTokens: number; outputTokens: number }> {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API ${response.status}: ${errorText.substring(0, 300)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body from Claude API');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  // Anthropic ends a successful stream with `message_stop`, preceded by a
  // `message_delta` carrying the final `stop_reason` + usage. If the socket
  // closes cleanly mid-response we get neither — fullText is partial and
  // outputTokens stays 0. Track completion so we can reject that case below.
  let sawMessageStop = false;
  let stopReason: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        let event: {
          type: string;
          delta?: { type: string; text?: string; stop_reason?: string };
          usage?: { input_tokens: number; output_tokens: number };
          message?: { usage?: { input_tokens: number; output_tokens: number } };
        };

        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          fullText += event.delta.text;
          onDelta(event.delta.text);
        }

        if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens;
        }

        if (event.type === 'message_delta') {
          if (event.usage) outputTokens = event.usage.output_tokens;
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        }

        if (event.type === 'message_stop') {
          sawMessageStop = true;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Clean-but-incomplete stream: the reader drained without a terminal
  // `message_stop`. Treat as a transient failure so withRetry re-runs the step
  // rather than persisting a truncated body. (A genuine `max_tokens` stop still
  // emits message_stop, so it passes through here and is surfaced below.)
  if (!sawMessageStop) {
    throw new Error(
      `Claude API stream terminated before completion (received ${fullText.length} chars, no message_stop)`
    );
  }

  // The model hit the output cap — the content is real but truncated. Surface
  // it so callers don't silently ship a half-finished asset.
  if (stopReason === 'max_tokens') {
    throw new Error('Claude API stream stopped at max_tokens — output truncated');
  }

  return { fullText, inputTokens, outputTokens };
}

// ============================================================================
// Retry
// ============================================================================

const MAX_ATTEMPTS = 3;

/**
 * Transient failures worth retrying. The common one: undici surfaces a stale
 * keep-alive socket reset as `TypeError: terminated` with an ECONNRESET cause.
 * Also covers connection timeouts and Anthropic 429/5xx responses.
 */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const message = err.message.toLowerCase();
  if (message.includes('terminated') || message.includes('fetch failed')) return true;

  // Network error codes can sit on the error itself or its `cause`
  const code =
    (err as NodeJS.ErrnoException).code ??
    (err as { cause?: NodeJS.ErrnoException }).cause?.code;
  if (
    code &&
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
  ) {
    return true;
  }

  // streamClaudeStep throws `Claude API <status>: ...` for non-OK responses
  if (/Claude API (?:429|5\d\d)/.test(err.message)) return true;

  return false;
}

/**
 * Runs `fn`, retrying transient failures with exponential backoff + jitter.
 * `onRetry` fires before each retry — used to re-emit step_start so the client
 * knows the failed attempt's partial text should be discarded.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  onRetry?: () => void
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_ATTEMPTS || !isRetryableError(err)) throw err;

      const delayMs = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[ContentGen] ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed (${reason}); retrying in ${delayMs}ms`
      );
      onRetry?.();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

// ============================================================================
// Main Execution
// ============================================================================

export async function executeGeneration(
  params: GenerateParams,
  onChunk: (chunk: GenerationSSEChunk) => void
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    onChunk({ type: 'error', message: 'ANTHROPIC_API_KEY is not configured' });
    return;
  }

  const { asset_id, contract_id, sequence_id, reference_asset_ids, reference_deliverable_ids, variables: userVariables, auto_retrieve, additional_instructions } = params;

  try {
    // 1. Resolve prompt sequence
    const sequence = await resolveSequence(asset_id, contract_id, sequence_id);
    const steps = (sequence.steps as PromptStep[]).sort((a, b) => a.step_order - b.step_order);

    if (steps.length === 0) {
      onChunk({ type: 'error', message: 'Prompt sequence has no steps' });
      return;
    }

    console.log(`[ContentGen] Starting generation: asset=${asset_id} sequence="${sequence.name}" (${steps.length} steps)`);

    // 2. Gather context (auto-resolve variables, fetch reference content)
    const context = await gatherGenerationContext({
      contract_id,
      asset_id,
      reference_asset_ids,
      reference_deliverable_ids,
      user_variables: userVariables,
      auto_retrieve,
      additional_instructions,
    });

    // Emit context sources
    onChunk({ type: 'context', sources: context.sources });

    // 3. Execute steps sequentially
    const stepOutputs: Record<string, string> = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      onChunk({
        type: 'step_start',
        step: step.name,
        step_number: i + 1,
        total_steps: steps.length,
      });

      // Resolve templates in prompts
      let resolvedSystem = resolveTemplate(step.system_prompt, context.variables, stepOutputs);
      let resolvedUser = resolveTemplate(step.user_prompt, context.variables, stepOutputs);

      // Inject reference content into the first step only
      if (i === 0 && context.referenceBlock) {
        resolvedUser = resolvedUser + '\n\n' + context.referenceBlock;
      }

      // Stream this step through Claude, retrying transient network failures
      const result = await withRetry(
        `Step "${step.name}"`,
        () =>
          streamClaudeStep(
            resolvedSystem,
            resolvedUser,
            apiKey,
            (text) => onChunk({ type: 'delta', text })
          ),
        // Re-emit step_start so the client resets this step's partial text
        () =>
          onChunk({
            type: 'step_start',
            step: step.name,
            step_number: i + 1,
            total_steps: steps.length,
          })
      );

      stepOutputs[step.output_key] = result.fullText;
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;

      onChunk({
        type: 'step_complete',
        step: step.name,
        tokens: { input: result.inputTokens, output: result.outputTokens },
      });

      console.log(`[ContentGen] Step "${step.name}" complete: ${result.inputTokens} in / ${result.outputTokens} out`);
    }

    // 4. Parse final output and write back to asset
    const finalStepKey = steps[steps.length - 1].output_key;
    const finalOutput = stepOutputs[finalStepKey] || '';

    // Extract JSON metadata block if present (```json ... ```)
    const jsonMatch = finalOutput.match(/```json\s*([\s\S]*?)\s*```/);
    let contentStructured: Record<string, unknown> | null = null;
    let contentBody = finalOutput;

    if (jsonMatch) {
      try {
        contentStructured = JSON.parse(jsonMatch[1]);
      } catch {
        console.warn('[ContentGen] Failed to parse JSON metadata block from output');
      }
      contentBody = finalOutput.substring(0, jsonMatch.index).trim();
    }

    // Write back to asset
    await update(
      'content_assets',
      {
        content_body: contentBody,
        ...(contentStructured && { content_structured: contentStructured }),
        metadata: {
          generation: {
            sequence_id: sequence.sequence_id,
            sequence_name: sequence.name,
            steps_completed: steps.length,
            total_tokens: { input: totalInputTokens, output: totalOutputTokens },
            generated_at: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      },
      { asset_id }
    );

    console.log(`[ContentGen] Generation complete: asset=${asset_id} tokens=${totalInputTokens}+${totalOutputTokens}`);

    // Fire-and-forget: embed generated content into RAG knowledge base
    // (skipped when the asset's content type has is_rag_eligible = false —
    // used for derivative output like social post packages, summaries, etc.,
    // which would otherwise pollute future retrievals as echo-chamber input)
    if (contentBody && process.env.OPENAI_API_KEY) {
      let isRagEligible = true;
      try {
        const assetRows = await select<Array<{ content_type_id: string | null }>>('content_assets', {
          select: 'content_type_id',
          filters: { asset_id },
          limit: 1,
        });
        const contentTypeId = assetRows?.[0]?.content_type_id;
        if (contentTypeId) {
          const typeRows = await select<Array<{ is_rag_eligible: boolean }>>('content_types', {
            select: 'is_rag_eligible',
            filters: { type_id: contentTypeId },
            limit: 1,
          });
          isRagEligible = typeRows?.[0]?.is_rag_eligible ?? true;
        }
      } catch (err) {
        // Fail-safe: on lookup error, default to eligible (preserve prior behavior).
        console.warn(`[ContentGen] RAG eligibility check failed for asset ${asset_id}, defaulting to eligible:`, err);
      }

      if (isRagEligible) {
        ingestContent({
          contract_id,
          source_type: 'content',
          source_id: asset_id,
          title: context.variables.topic,
          content: contentBody,
        }).catch((err) => {
          console.error(`[ContentGen] Embedding failed for asset ${asset_id} (non-blocking):`, err);
        });
      } else {
        console.log(`[ContentGen] Skipping RAG ingestion for asset ${asset_id} — content type marked is_rag_eligible=false`);
      }
    }

    // Fire-and-forget: auto-categorize and tag the generated content
    // Same pattern as the ingest pipeline — reuses existing categorization logic
    (async () => {
      try {
        const { categorizeWithAttributes } = await import('../claude/categorize-with-attributes.js');
        const { applyCategorizationViaEdgeFn } = await import('../content-ingestion/processor.js');

        const catResult = await categorizeWithAttributes(
          contentBody,
          context.variables.topic,
          contract_id,
          sequence.content_type_slug
        );

        if (catResult) {
          await applyCategorizationViaEdgeFn(
            asset_id,
            contract_id,
            {
              generation: {
                sequence_id: sequence.sequence_id,
                sequence_name: sequence.name,
                steps_completed: steps.length,
                total_tokens: { input: totalInputTokens, output: totalOutputTokens },
                generated_at: new Date().toISOString(),
              },
            },
            catResult,
            { skipContentType: true } // content type already set on the asset
          );
          console.log(`[ContentGen] Auto-categorization applied to asset ${asset_id}`);
        }
      } catch (catErr) {
        console.error(`[ContentGen] Auto-categorization failed for asset ${asset_id} (non-blocking):`, catErr);
      }
    })();

    onChunk({
      type: 'done',
      total_tokens: { input: totalInputTokens, output: totalOutputTokens },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    console.error(`[ContentGen] Generation failed for asset ${asset_id}:`, err);
    onChunk({ type: 'error', message });
  }
}
