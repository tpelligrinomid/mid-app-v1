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
import type { PromptStep } from '../../types/content.js';

// Claude API config (matches chat.ts)
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
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
      max_tokens: 4096,
      temperature: 0.5,
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
          delta?: { type: string; text?: string };
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

        if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { fullText, inputTokens, outputTokens };
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

  const { asset_id, contract_id, sequence_id, reference_asset_ids, auto_retrieve, additional_instructions } = params;

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

      // Stream this step through Claude
      const result = await streamClaudeStep(
        resolvedSystem,
        resolvedUser,
        apiKey,
        (text) => onChunk({ type: 'delta', text })
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
