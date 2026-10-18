/**
 * Deliverables in Ask Compass: read one in full, review it against what has
 * happened since, and edit it in place.
 *
 * Edits work on the markdown text (content_raw) that the app shows for content
 * plans, research, briefs and most plans. Each confirmed change bumps the minor
 * version (1.0 -> 1.1) and stores the full text of both the previous and the
 * new version in compass_deliverable_versions, so any version can be restored.
 * Changes are two-step: without confirm=true the tools only preview.
 *
 * Bound to one contract and one staff user; never offered to client users.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { insert, select, update } from '../../utils/edge-functions.js';
import { ingestContent } from '../rag/ingestion.js';

const APP_URL = (process.env.APP_URL ?? 'https://app.marketersindemand.com').replace(/\/+$/, '');

// Enough for the largest plans (the biggest research deliverables are ~415k).
export const MAX_DELIVERABLE_CHARS = 450_000;
const MAX_EDITS = 50;

interface DeliverableRow {
  deliverable_id: string;
  contract_id: string;
  title: string;
  deliverable_type: string | null;
  status: string | null;
  version: string | null;
  created_at: string | null;
  updated_at: string | null;
  drive_url: string | null;
  content_raw: string | null;
  content_structured: Record<string, unknown> | null;
}

interface VersionRow {
  version_id: string;
  version_number: string;
  change_summary: string | null;
  created_at: string | null;
  content_raw: string | null;
}

const DELIVERABLE_COLUMNS =
  'deliverable_id, contract_id, title, deliverable_type, status, version, created_at, updated_at, drive_url, content_raw, content_structured';

const confirmProp = {
  type: 'boolean',
  description: 'Leave unset first to get a preview; set true only after the user has confirmed that exact change.',
} as const;

export const DELIVERABLE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_deliverable',
    description:
      "Read one of this client's deliverables in full (content plan, roadmap, research, brief...), with its version history. Use find_content_references (kinds: [\"deliverable\"]) to find the id. Not needed for the deliverable that is already open.",
    input_schema: {
      type: 'object',
      properties: { deliverable_id: { type: 'string' } },
      required: ['deliverable_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_deliverable',
    description:
      "Change a deliverable's text in place. Each edit replaces one exact passage (find) with new text (replace); find must appear exactly once, so include enough surrounding words. For a rename or a term used throughout, set all=true to replace every occurrence in one edit. Put every change for one request in a single call so it becomes one version. To add a section, find the passage it should follow and replace it with that passage plus the new section. Two-step: call without confirm to preview, show the user what changes, and call again with the same edits and confirm=true only after they agree. Saves a new version; the previous one can be restored.",
    input_schema: {
      type: 'object',
      properties: {
        deliverable_id: { type: 'string' },
        edits: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_EDITS,
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Exact text currently in the deliverable (copied verbatim, including markdown).' },
              replace: { type: 'string', description: 'The new text. Empty to delete the passage.' },
              all: { type: 'boolean', description: 'Replace every occurrence (for renames). Default: find must appear exactly once.' },
            },
            required: ['find', 'replace'],
            additionalProperties: false,
          },
        },
        change_summary: { type: 'string', description: 'One line on what changed and why, for the version history.' },
        confirm: confirmProp,
      },
      required: ['deliverable_id', 'edits', 'change_summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'restore_deliverable_version',
    description:
      'Restore a deliverable to an earlier saved version (from read_deliverable\'s version list). Saves the restore as a new version, so it can be undone too. Two-step: preview first, confirm=true after the user agrees.',
    input_schema: {
      type: 'object',
      properties: {
        deliverable_id: { type: 'string' },
        version_number: { type: 'string', description: 'e.g. "1.0"' },
        confirm: confirmProp,
      },
      required: ['deliverable_id', 'version_number'],
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Set(DELIVERABLE_TOOLS.map((t) => t.name));
export function isDeliverableTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

/** 1.0 -> 1.1, 2.9 -> 2.10, "3" -> 3.1. */
function nextMinorVersion(version: string | null): string {
  const [major, minor] = (version || '1.0').split('.');
  const maj = Number.parseInt(major, 10);
  const min = Number.parseInt(minor ?? '0', 10);
  return `${Number.isFinite(maj) ? maj : 1}.${(Number.isFinite(min) ? min : 0) + 1}`;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

function clip(text: string, max = 600): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The deliverable's readable text: the markdown when there is one, else its structured data. */
export function deliverableText(d: Pick<DeliverableRow, 'content_raw' | 'content_structured'>): string {
  if (d.content_raw) return d.content_raw;
  if (d.content_structured) return JSON.stringify(d.content_structured, null, 1);
  return '';
}

/** System-prompt section for the deliverable the user has open in the app. */
export function openDeliverablePrompt(d: DeliverableRow, canEdit: boolean): string {
  const text = deliverableText(d);
  const truncated = text.length > MAX_DELIVERABLE_CHARS;
  const meta = [
    d.deliverable_type,
    `version ${d.version || '1.0'}`,
    d.status,
    d.created_at && `created ${d.created_at.slice(0, 10)}`,
    d.updated_at && `last updated ${d.updated_at.slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join(', ');
  const editNote = !canEdit
    ? ''
    : d.content_raw
      ? `\n\nTo change it, use edit_deliverable (deliverable_id ${d.deliverable_id}) with passages copied exactly from the text below. Keep edits surgical and keep the document's structure, headings and formatting. Preview first; confirm only after the user agrees. Say which version the change creates.`
      : '\n\nThis deliverable is stored as structured data, so it can only be edited in the app\'s editor; you can still review it and suggest changes.';

  return `## Open deliverable

The user has this deliverable open in the app and is asking about it: "${d.title}" (${meta}), deliverable_id ${d.deliverable_id}. Its full text is below. Answer questions about it from this text, and say when something isn't in it.

To review progress against it, compare what it commits to (topics and clusters, cadence, keywords, channels, KPIs, dates, owners) with what has actually happened since ${d.created_at?.slice(0, 10) ?? 'it was created'}: content published (find_content_references with kinds ["asset"]), rankings for its keywords (SEO tools), performance (marketing data tools) and recent meetings and notes. Be concrete: list planned vs done with dates, call out gaps and what's ahead of plan, then suggest adjustments.${editNote}

<deliverable title="${d.title.replace(/"/g, "'")}">
${truncated ? `${text.slice(0, MAX_DELIVERABLE_CHARS)}\n[... truncated: the deliverable continues beyond this point]` : text}
</deliverable>`;
}

export class DeliverableEditor {
  constructor(
    private readonly contractId: string,
    private readonly userId: string
  ) {}

  describe(name: string, input: Record<string, unknown>): string {
    if (name === 'read_deliverable') return 'Reading the deliverable';
    if (name === 'edit_deliverable') return input.confirm === true ? 'Saving the changes to the deliverable' : 'Preparing the changes';
    return input.confirm === true ? `Restoring version ${String(input.version_number ?? '')}` : 'Preparing the restore';
  }

  async run(name: string, input: Record<string, unknown>): Promise<string> {
    if (name === 'read_deliverable') return JSON.stringify(await this.read(input));
    if (name === 'edit_deliverable') return JSON.stringify(await this.edit(input));
    if (name === 'restore_deliverable_version') return JSON.stringify(await this.restore(input));
    throw new Error(`Unknown deliverable tool: ${name}`);
  }

  /** The deliverable, only if it belongs to this contract. */
  async get(deliverableId: string): Promise<DeliverableRow | null> {
    if (!deliverableId) return null;
    const rows = await select<DeliverableRow[]>('compass_deliverables', {
      select: DELIVERABLE_COLUMNS,
      filters: { deliverable_id: deliverableId, contract_id: this.contractId },
      limit: 1,
    });
    return rows?.[0] ?? null;
  }

  private async versions(deliverableId: string): Promise<VersionRow[]> {
    const rows = await select<VersionRow[]>('compass_deliverable_versions', {
      select: 'version_id, version_number, change_summary, created_at, content_raw',
      filters: { deliverable_id: deliverableId },
      order: [{ column: 'created_at', ascending: false }],
    });
    return rows ?? [];
  }

  private link(d: DeliverableRow): string {
    return `${APP_URL}/compass/${this.contractId}/deliverables/${d.deliverable_id}`;
  }

  private async read(input: Record<string, unknown>) {
    const d = await this.get(String(input.deliverable_id ?? ''));
    if (!d) return { error: 'Deliverable not found for this client. Use an id from find_content_references.' };
    const text = deliverableText(d);
    const versions = await this.versions(d.deliverable_id);
    return {
      deliverable_id: d.deliverable_id,
      title: d.title,
      type: d.deliverable_type,
      status: d.status,
      version: d.version || '1.0',
      created: d.created_at?.slice(0, 10),
      updated: d.updated_at?.slice(0, 10),
      editable_here: !!d.content_raw,
      link: this.link(d),
      versions: versions.map((v) => ({
        version: v.version_number,
        saved: v.created_at?.slice(0, 10),
        ...(v.change_summary && { summary: v.change_summary }),
        restorable: !!v.content_raw,
      })),
      content: text.length > MAX_DELIVERABLE_CHARS ? `${text.slice(0, MAX_DELIVERABLE_CHARS)}\n[... truncated]` : text,
    };
  }

  private async edit(input: Record<string, unknown>) {
    const d = await this.get(String(input.deliverable_id ?? ''));
    if (!d) return { error: 'Deliverable not found for this client.' };
    if (!d.content_raw) {
      return { error: 'This deliverable is stored as structured data; it can only be edited in the app editor. Suggest the changes instead.' };
    }
    const edits = (Array.isArray(input.edits) ? input.edits : []) as Array<{ find?: unknown; replace?: unknown; all?: unknown }>;
    if (edits.length === 0) return { error: 'No edits given.' };
    if (edits.length > MAX_EDITS) return { error: `At most ${MAX_EDITS} edits per change.` };

    // Apply in order, each against the text as changed by the edits before it.
    let text = d.content_raw;
    const results = [];
    let ok = true;
    for (const [i, e] of edits.entries()) {
      const find = typeof e.find === 'string' ? e.find : '';
      const replace = typeof e.replace === 'string' ? e.replace : '';
      const count = countOccurrences(text, find);
      if (e.all === true && count > 0) {
        text = text.split(find).join(replace);
        results.push({ edit: i + 1, replaced_everywhere: count, before: clip(find), after: clip(replace) || '(deleted)' });
        continue;
      }
      if (count !== 1) {
        ok = false;
        results.push({
          edit: i + 1,
          problem: count === 0 ? 'find text not found (copy it exactly from the deliverable)' : `find text appears ${count} times; include more surrounding words`,
          find: clip(find, 200),
        });
        continue;
      }
      text = text.replace(find, () => replace);
      results.push({ edit: i + 1, before: clip(find), after: clip(replace) || '(deleted)' });
    }

    const summary = String(input.change_summary ?? '').trim() || 'Edited from Ask Compass';
    const nextVersion = nextMinorVersion(d.version);
    if (!ok) return { error: 'Some edits could not be applied; nothing was changed.', edits: results };

    const delta = text.length - d.content_raw.length;
    if (input.confirm !== true) {
      return {
        preview: true,
        deliverable: d.title,
        would_create_version: `${d.version || '1.0'} -> ${nextVersion}`,
        change_summary: summary,
        edits: results,
        size_change: `${delta >= 0 ? '+' : ''}${delta} characters`,
        next: 'Show the changes to the user. Call again with the same edits and confirm=true only after they agree.',
      };
    }

    await this.save(d, text, nextVersion, summary);
    return {
      success: true,
      deliverable: d.title,
      version: nextVersion,
      previous_version: d.version || '1.0',
      change_summary: summary,
      edits_applied: results.length,
      link: this.link(d),
      note: `Saved as version ${nextVersion}. Version ${d.version || '1.0'} can be restored with restore_deliverable_version.`,
    };
  }

  private async restore(input: Record<string, unknown>) {
    const d = await this.get(String(input.deliverable_id ?? ''));
    if (!d) return { error: 'Deliverable not found for this client.' };
    const wanted = String(input.version_number ?? '').trim();
    const version = (await this.versions(d.deliverable_id)).find((v) => v.version_number === wanted && v.content_raw);
    if (!version?.content_raw) return { error: `No saved text for version ${wanted}. Check read_deliverable's version list.` };
    if (version.content_raw === d.content_raw) return { error: `The deliverable already matches version ${wanted}.` };

    const nextVersion = nextMinorVersion(d.version);
    const summary = `Restored version ${wanted}`;
    if (input.confirm !== true) {
      return {
        preview: true,
        deliverable: d.title,
        restores: `version ${wanted} (saved ${version.created_at?.slice(0, 10)}${version.change_summary ? `: ${version.change_summary}` : ''})`,
        would_create_version: `${d.version || '1.0'} -> ${nextVersion}`,
        size_change: `${(d.content_raw ?? '').length} -> ${version.content_raw.length} characters`,
        next: 'Show this to the user. Call again with confirm=true only after they agree.',
      };
    }

    await this.save(d, version.content_raw, nextVersion, summary);
    return { success: true, deliverable: d.title, version: nextVersion, change_summary: summary, link: this.link(d) };
  }

  /** Snapshot the current text (once per version), write the new text, record the new version, re-embed. */
  private async save(d: DeliverableRow, newText: string, nextVersion: string, summary: string): Promise<void> {
    const current = d.version || '1.0';
    const versions = await this.versions(d.deliverable_id);
    const currentRow = versions.find((v) => v.version_number === current);
    if (!currentRow) {
      await insert('compass_deliverable_versions', {
        deliverable_id: d.deliverable_id,
        version_number: current,
        content_raw: d.content_raw,
        content_structured: d.content_structured,
        drive_url: d.drive_url,
        change_summary: 'Saved before the first Ask Compass edit',
        created_by: this.userId,
      });
    } else if (!currentRow.content_raw) {
      await update('compass_deliverable_versions', { content_raw: d.content_raw }, { version_id: currentRow.version_id });
    }

    const now = new Date().toISOString();
    await update('compass_deliverables', { content_raw: newText, version: nextVersion, updated_at: now }, { deliverable_id: d.deliverable_id });
    await insert('compass_deliverable_versions', {
      deliverable_id: d.deliverable_id,
      version_number: nextVersion,
      content_raw: newText,
      drive_url: d.drive_url,
      change_summary: summary,
      created_by: this.userId,
    });
    console.log(`[Deliverables] Ask Compass edit: ${d.deliverable_id} ${current} -> ${nextVersion} by ${this.userId}: ${summary}`);

    if (process.env.OPENAI_API_KEY) {
      ingestContent({
        contract_id: d.contract_id,
        source_type: 'deliverable',
        source_id: d.deliverable_id,
        title: d.title,
        content: newText,
      }).catch((err) => console.error(`[Deliverables] Re-embedding failed for ${d.deliverable_id} (non-blocking):`, err));
    }
  }
}
