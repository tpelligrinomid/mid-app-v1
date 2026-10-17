/**
 * Content generation from Ask Compass: the same path as the Generate button in
 * Content Ops → Assets (prompt sequence, brand voice, RAG references), started
 * from chat. Typical flow: keyword → Claude proposes titles → the user picks one
 * → preview → confirm → a draft asset is created and generated in the
 * background.
 *
 * Bound to one contract and one staff user; never offered to client users.
 * generate_content is two-step: without confirm=true it only returns a preview.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { insert, select, update } from '../../utils/edge-functions.js';
import { executeGeneration } from './engine.js';

const APP_URL = (process.env.APP_URL ?? 'https://app.marketersindemand.com').replace(/\/+$/, '');

// Filled by the engine from the contract, brand voice and asset; never asked for.
const AUTO_VARIABLES = new Set(['company_name', 'industry', 'brand_voice', 'published_urls']);
// Sequences name the target keyword differently; a keyword given to the tool fills any of these.
const KEYWORD_VARIABLES = ['primary_keyword', 'keyword', 'target_keyword'];

export const CONTENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_content_options',
    description:
      "List the content types this client can generate and each one's prompt sequences (the custom prompts set up in Content Ops), with the variables each sequence takes. Call before generate_content.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'generate_content',
    description:
      'Create a draft content asset and run a prompt sequence on it, exactly like the Generate button in Content Ops. Two-step: call without confirm to get a preview (title, content type, sequence, variables, anything missing), show it to the user, and call again with the same inputs and confirm=true only after they explicitly agree. Generation then runs in the background (a few minutes); share the link it returns.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Asset title, as agreed with the user. Also used as the topic unless variables.topic is set.' },
        content_type: { type: 'string', description: 'Content type slug from list_content_options, e.g. "blog_post".' },
        sequence_id: { type: 'string', description: "Prompt sequence id from list_content_options. Omit to use the content type's default." },
        keyword: { type: 'string', description: 'Target keyword. Fills primary_keyword / keyword / target_keyword when the sequence uses one.' },
        variables: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: "Values for the sequence's variables, by variable name (e.g. angle, audience, secondary_keywords, word_count).",
        },
        additional_instructions: { type: 'string', description: 'Extra direction for the writer, from the user.' },
        confirm: {
          type: 'boolean',
          description: 'Leave unset first to get a preview; set true only after the user has confirmed that exact request.',
        },
      },
      required: ['title', 'content_type'],
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Set(CONTENT_TOOLS.map((t) => t.name));
export function isContentTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export function contentGuidance(): string {
  return `## Creating content

You can create content for this client with the same prompts the team uses in Content Ops (list_content_options, generate_content). When someone gives you a keyword or topic to write about:
1. Call list_content_options to see the content types and prompt sequences.
2. Propose 3-5 working titles that target the keyword, fit the client's audience and brand, and suit the content type. Use the SEO tools if search volume, ranking data or the current results page would help. Let the user pick or edit one.
3. Call generate_content without confirm to preview it. Fill the sequence's variables from the conversation and what you know about the client; ask about required ones you can't reasonably fill.
4. Show the preview, and call again with confirm=true only after the user agrees.
Never say content was created or generated unless generate_content returned confirm=true success, and share the link it returns.`;
}

interface VariableDef {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  default?: string;
  options?: string[];
}

interface SequenceRow {
  sequence_id: string;
  name: string;
  description: string | null;
  content_type_slug: string;
  contract_id: string | null;
  is_default: boolean;
  purpose: string | null;
  variables: VariableDef[] | null;
  steps: Array<{ name: string }> | null;
}

interface ContentTypeRow {
  type_id: string;
  slug: string;
  name: string;
  contract_id: string | null;
  is_active: boolean | null;
}

export class ContentGenerator {
  constructor(
    private readonly contractId: string,
    private readonly userId: string
  ) {}

  describe(name: string, input: Record<string, unknown>): string {
    if (name === 'list_content_options') return 'Checking content types and prompts';
    return input.confirm === true ? `Starting generation: ${String(input.title ?? '')}` : `Preparing a preview: ${String(input.title ?? '')}`;
  }

  async run(name: string, input: Record<string, unknown>): Promise<string> {
    if (name === 'list_content_options') return JSON.stringify(await this.listOptions());
    if (name === 'generate_content') return JSON.stringify(await this.generate(input));
    throw new Error(`Unknown content tool: ${name}`);
  }

  /** Active "generate" sequences for this contract plus global ones, contract's own first. */
  private async sequences(): Promise<SequenceRow[]> {
    const columns = 'sequence_id, name, description, content_type_slug, contract_id, is_default, purpose, variables, steps';
    const [own, global] = await Promise.all([
      select<SequenceRow[]>('content_prompt_sequences', { select: columns, filters: { contract_id: this.contractId, is_active: true } }),
      select<SequenceRow[]>('content_prompt_sequences', { select: columns, filters: { contract_id: { is: null }, is_active: true } }),
    ]);
    return [...(own ?? []), ...(global ?? [])].filter((s) => (s.purpose ?? 'generate') === 'generate');
  }

  private async contentTypes(): Promise<ContentTypeRow[]> {
    const columns = 'type_id, slug, name, contract_id, is_active';
    const [own, global] = await Promise.all([
      select<ContentTypeRow[]>('content_types', { select: columns, filters: { contract_id: this.contractId } }),
      select<ContentTypeRow[]>('content_types', { select: columns, filters: { contract_id: { is: null } } }),
    ]);
    return [...(own ?? []), ...(global ?? [])].filter((t) => t.is_active !== false);
  }

  /** The sequence generation will use: the one asked for, else the contract's default, else the global default. */
  private pickSequence(sequences: SequenceRow[], slug: string, sequenceId?: string): SequenceRow | undefined {
    if (sequenceId) return sequences.find((s) => s.sequence_id === sequenceId && s.content_type_slug === slug);
    const forType = sequences.filter((s) => s.content_type_slug === slug);
    return (
      forType.find((s) => s.is_default && s.contract_id) ??
      forType.find((s) => s.is_default) ??
      forType.find((s) => s.contract_id) ??
      forType[0]
    );
  }

  private async listOptions() {
    const [sequences, types] = await Promise.all([this.sequences(), this.contentTypes()]);
    const options = [];
    const seen = new Set<string>();
    for (const type of types) {
      if (seen.has(type.slug)) continue;
      const forType = sequences.filter((s) => s.content_type_slug === type.slug);
      if (forType.length === 0) continue;
      seen.add(type.slug);
      const defaultSeq = this.pickSequence(sequences, type.slug);
      options.push({
        content_type: type.slug,
        name: type.name,
        sequences: forType.map((s) => ({
          sequence_id: s.sequence_id,
          name: s.name,
          ...(s.description && { description: s.description }),
          default: s.sequence_id === defaultSeq?.sequence_id,
          client_specific: !!s.contract_id,
          steps: s.steps?.length ?? 0,
          variables: (s.variables ?? [])
            .filter((v) => !AUTO_VARIABLES.has(v.name))
            .map((v) => ({
              name: v.name,
              label: v.label ?? v.name,
              required: !!v.required,
              ...(v.default && { default: v.default }),
              ...(v.options && { options: v.options }),
            })),
        })),
      });
    }
    return {
      content_types: options,
      note: 'topic defaults to the title; company name, industry, brand voice and internal links are filled automatically.',
    };
  }

  private async generate(input: Record<string, unknown>) {
    const title = String(input.title ?? '').trim();
    const slug = String(input.content_type ?? '').trim();
    if (!title) return { error: 'title is required' };

    const [sequences, types] = await Promise.all([this.sequences(), this.contentTypes()]);
    // The contract's own type comes first in the list, so it wins over a global one with the same slug.
    const type = types.find((t) => t.slug === slug);
    if (!type) return { error: `Unknown content type "${slug}". Call list_content_options for valid types.` };
    const sequence = this.pickSequence(sequences, slug, input.sequence_id ? String(input.sequence_id) : undefined);
    if (!sequence) {
      return { error: `No active prompt sequence for "${type.name}"${input.sequence_id ? ' with that sequence_id' : ''}. Call list_content_options.` };
    }

    // Fill variables: what Claude passed, then the keyword, then declared defaults; topic falls back to the title.
    const defs = (sequence.variables ?? []).filter((v) => !AUTO_VARIABLES.has(v.name));
    const given = (input.variables && typeof input.variables === 'object' ? input.variables : {}) as Record<string, unknown>;
    const variables: Record<string, string> = {};
    for (const [k, v] of Object.entries(given)) {
      if (v !== undefined && v !== null && String(v).trim()) variables[k] = String(v).trim();
    }
    const keyword = input.keyword ? String(input.keyword).trim() : '';
    if (keyword) {
      for (const name of KEYWORD_VARIABLES) {
        if (!variables[name] && defs.some((d) => d.name === name)) variables[name] = keyword;
      }
    }
    for (const d of defs) if (!variables[d.name] && d.default) variables[d.name] = d.default;
    if (!variables.topic && defs.some((d) => d.name === 'topic')) variables.topic = title;

    const missing = defs.filter((d) => d.required && !variables[d.name]).map((d) => d.label ?? d.name);
    const instructions = input.additional_instructions ? String(input.additional_instructions).trim() : '';
    const plan = {
      title,
      content_type: type.name,
      sequence: { sequence_id: sequence.sequence_id, name: sequence.name, steps: sequence.steps?.length ?? 0 },
      variables,
      ...(instructions && { additional_instructions: instructions }),
    };

    if (input.confirm !== true) {
      return {
        preview: true,
        would_create: plan,
        ...(missing.length > 0 && { missing_required: missing }),
        next:
          missing.length > 0
            ? 'Fill the missing required variables (ask the user if needed), then preview again.'
            : 'Show this to the user. Call again with the same inputs and confirm=true only after they agree.',
      };
    }
    if (missing.length > 0) return { error: `Missing required variables: ${missing.join(', ')}` };

    const startedAt = new Date().toISOString();
    const created = await insert<Array<{ asset_id: string }>>(
      'content_assets',
      {
        contract_id: this.contractId,
        title,
        content_type_id: type.type_id,
        status: 'draft',
        created_by: this.userId,
        metadata: {
          generation: {
            status: 'running',
            source: 'ask_compass',
            sequence_id: sequence.sequence_id,
            sequence_name: sequence.name,
            started_at: startedAt,
            ...(keyword && { keyword }),
          },
        },
      },
      { select: 'asset_id' }
    );
    const assetId = Array.isArray(created) ? created[0]?.asset_id : (created as { asset_id?: string } | null)?.asset_id;
    if (!assetId) throw new Error('Could not create the asset');

    console.log(`[ContentGen] Ask Compass generation: asset=${assetId} sequence="${sequence.name}" user=${this.userId}`);
    void this.runInBackground(assetId, sequence, variables, instructions, startedAt);

    return {
      success: true,
      asset_id: assetId,
      ...plan,
      link: `${APP_URL}/compass/${this.contractId}/content-ops/assets?asset=${assetId}`,
      note: `Generating now in the background (${sequence.steps?.length ?? 0} steps, usually a few minutes). The draft fills in when it's done.`,
    };
  }

  /** Runs the engine without a stream to watch; a failure is recorded on the asset. */
  private async runInBackground(
    assetId: string,
    sequence: SequenceRow,
    variables: Record<string, string>,
    instructions: string,
    startedAt: string
  ): Promise<void> {
    let failure = null as string | null;
    try {
      await executeGeneration(
        {
          asset_id: assetId,
          contract_id: this.contractId,
          sequence_id: sequence.sequence_id,
          variables,
          auto_retrieve: true,
          ...(instructions && { additional_instructions: instructions }),
        },
        (chunk) => {
          if (chunk.type === 'error') failure = chunk.message;
        }
      );
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    if (!failure) return;
    console.error(`[ContentGen] Ask Compass generation failed for asset ${assetId}: ${failure}`);
    await update(
      'content_assets',
      {
        metadata: {
          generation: {
            status: 'failed',
            source: 'ask_compass',
            sequence_id: sequence.sequence_id,
            sequence_name: sequence.name,
            started_at: startedAt,
            error: failure.slice(0, 500),
          },
        },
        updated_at: new Date().toISOString(),
      },
      { asset_id: assetId }
    ).catch((err) => console.error(`[ContentGen] Could not record failure on asset ${assetId}:`, err));
  }
}
