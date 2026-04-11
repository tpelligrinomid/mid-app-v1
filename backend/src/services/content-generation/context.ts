/**
 * Content Generation — Context Gathering
 *
 * Auto-resolves variables from the asset, contract, and brand voice.
 * Fetches reference content via RAG or manual asset selection.
 */

import { select } from '../../utils/edge-functions.js';
import { searchKnowledge } from '../rag/search.js';
import type { SimilarityResult } from '../../types/rag.js';

// ============================================================================
// Types
// ============================================================================

export interface GenerationContext {
  /** Auto-resolved template variables */
  variables: Record<string, string>;
  /** Formatted reference content block for injection into first step */
  referenceBlock: string;
  /** RAG sources for the frontend to display */
  sources: Array<{ title: string; source_type: string; source_id: string; similarity: number }>;
}

interface ContractRow {
  contract_name: string;
  industry: string | null;
}

interface BrandVoiceRow {
  voice_summary: string;
  tone: string[];
  personality: string[];
  writing_style: string | null;
  do_guidelines: string[];
  dont_guidelines: string[];
  example_excerpts: Array<{ text: string; source?: string; why?: string }>;
  target_audience: string | null;
  industry_context: string | null;
}

interface AssetRow {
  title: string;
  description: string | null;
  content_body: string | null;
  tags: string[] | null;
  status: string;
}

interface PublishedAssetRow {
  asset_id: string;
  title: string;
  external_url: string;
}

// ============================================================================
// Brand Voice Formatting
// ============================================================================

function formatBrandVoice(bv: BrandVoiceRow): string {
  const lines: string[] = [];
  lines.push(bv.voice_summary);

  if (bv.tone.length > 0) {
    lines.push(`Tone: ${bv.tone.join(', ')}`);
  }
  if (bv.personality.length > 0) {
    lines.push(`Personality: ${bv.personality.join(', ')}`);
  }
  if (bv.writing_style) {
    lines.push(`\nWriting Style: ${bv.writing_style}`);
  }
  if (bv.do_guidelines.length > 0) {
    lines.push('\nDO:');
    for (const g of bv.do_guidelines) lines.push(`- ${g}`);
  }
  if (bv.dont_guidelines.length > 0) {
    lines.push("\nDON'T:");
    for (const g of bv.dont_guidelines) lines.push(`- ${g}`);
  }
  if (bv.target_audience) {
    lines.push(`\nTarget Audience: ${bv.target_audience}`);
  }
  if (bv.example_excerpts.length > 0) {
    lines.push('\nExample Excerpts:');
    for (const ex of bv.example_excerpts) {
      lines.push(`"${ex.text}" — ${ex.source || 'Unknown'}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Reference Content Formatting
// ============================================================================

interface DeliverableRow {
  deliverable_id: string;
  title: string;
  deliverable_type: string;
  content_raw: string | null;
  content_structured: Record<string, unknown> | null;
}

function formatReferenceBlock(
  ragResults: SimilarityResult[],
  manualAssets: AssetRow[],
  referenceDeliverables: DeliverableRow[],
  additionalInstructions?: string
): string {
  const sections: string[] = [];

  // Reference deliverables — injected first as high-priority authoritative context
  if (referenceDeliverables.length > 0) {
    sections.push('## Reference Deliverables\n');
    sections.push('The following deliverables are provided as authoritative source material.');
    sections.push('Treat this content as primary context — use it to inform tone, positioning, audience understanding, and messaging.\n');

    for (let i = 0; i < referenceDeliverables.length; i++) {
      const d = referenceDeliverables[i];
      const content = d.content_raw
        || (d.content_structured ? JSON.stringify(d.content_structured, null, 2) : null);
      sections.push(`[${i + 1}] "${d.title}" (${d.deliverable_type})`);
      sections.push('---');
      sections.push(content || '(no content)');
      sections.push('');
    }
  }

  // Reference content assets + RAG results — supplementary context
  if (ragResults.length > 0 || manualAssets.length > 0) {
    sections.push('## Reference Content\n');
    sections.push('The following content from the client\'s library is provided as context.');
    sections.push('Use it for inspiration, consistency, and to avoid contradicting existing content.\n');

    let idx = 1;
    for (const asset of manualAssets) {
      sections.push(`[${idx}] "${asset.title}" (selected reference)`);
      sections.push('---');
      sections.push(asset.content_body?.substring(0, 10000) || '(no content)');
      sections.push('');
      idx++;
    }

    for (const r of ragResults) {
      sections.push(`[${idx}] "${r.title}" (${r.source_type})`);
      sections.push('---');
      sections.push(r.content);
      sections.push('');
      idx++;
    }
  }

  if (additionalInstructions) {
    sections.push('## Additional Instructions\n');
    sections.push(additionalInstructions);
  }

  return sections.join('\n');
}

// ============================================================================
// Internal Linking — RAG-filtered published URLs
// ============================================================================

/**
 * Find the most relevant published content with URLs for internal linking.
 * Uses RAG to semantically match, then looks up the actual URLs from content_assets.
 */
async function fetchRelevantPublishedUrls(
  query: string,
  contractId: string,
  excludeAssetId: string
): Promise<string> {
  const publishedAssets: PublishedAssetRow[] = [];

  try {
    // Try RAG search first for relevance-ranked results
    const ragResults = await searchKnowledge({
      query,
      contract_id: contractId,
      match_count: 30,
      match_threshold: 0.35,
      source_types: ['content'],
    });

    if (ragResults.length > 0) {
      // Get unique source_ids (excluding the asset being generated)
      const uniqueSourceIds = [...new Set(
        ragResults
          .map(r => r.source_id)
          .filter(id => id !== excludeAssetId)
      )];

      // Fetch the actual URLs from content_assets
      for (const sourceId of uniqueSourceIds.slice(0, 30)) {
        try {
          const rows = await select<PublishedAssetRow[]>('content_assets', {
            select: 'asset_id, title, external_url',
            filters: { asset_id: sourceId, status: 'published' },
            limit: 1,
          });
          if (rows?.[0]?.external_url) {
            publishedAssets.push(rows[0]);
          }
        } catch {
          // Skip individual failures
        }
      }

      if (publishedAssets.length > 0) {
        // Build the similarity map for sorting
        const similarityMap = new Map<string, number>();
        for (const r of ragResults) {
          const existing = similarityMap.get(r.source_id);
          if (!existing || r.similarity > existing) {
            similarityMap.set(r.source_id, r.similarity);
          }
        }

        const sorted = publishedAssets
          .map(a => ({ ...a, similarity: similarityMap.get(a.asset_id) || 0 }))
          .sort((a, b) => b.similarity - a.similarity);

        const lines = sorted.map(a =>
          `- "${a.title}" → ${a.external_url}`
        );

        return `Available pages for internal linking (${sorted.length} most relevant):\n${lines.join('\n')}`;
      }
    }
  } catch (err) {
    console.warn('[ContentGen] RAG search for internal links failed, falling back to direct query:', err);
  }

  // Fallback: direct query for published assets with URLs (not RAG-ranked, but still useful)
  try {
    const rows = await select<PublishedAssetRow[]>('content_assets', {
      select: 'asset_id, title, external_url',
      filters: { contract_id: contractId, status: 'published' },
      order: [{ column: 'published_date', ascending: false }],
      limit: 30,
    });

    const withUrls = (rows || []).filter(
      r => r.external_url && r.asset_id !== excludeAssetId
    );

    if (withUrls.length > 0) {
      const lines = withUrls.map(a =>
        `- "${a.title}" → ${a.external_url}`
      );
      return `Available pages for internal linking (${withUrls.length} recent):\n${lines.join('\n')}`;
    }
  } catch (err) {
    console.error('[ContentGen] Direct query for published URLs also failed:', err);
  }

  return 'No published content with URLs available for internal linking.';
}

// ============================================================================
// Main Context Gathering
// ============================================================================

export async function gatherGenerationContext(params: {
  contract_id: string;
  asset_id: string;
  reference_asset_ids?: string[];
  reference_deliverable_ids?: string[];
  user_variables?: Record<string, string>;
  auto_retrieve?: boolean;
  additional_instructions?: string;
}): Promise<GenerationContext> {
  const { contract_id, asset_id, reference_asset_ids, reference_deliverable_ids, user_variables, auto_retrieve = true, additional_instructions } = params;

  // Fetch contract, brand voice, and asset in parallel
  const [contractRows, brandVoiceRows, assetRows] = await Promise.all([
    select<ContractRow[]>('contracts', {
      select: 'contract_name, industry',
      filters: { contract_id },
      limit: 1,
    }),
    select<BrandVoiceRow[]>('compass_brand_voice', {
      select: 'voice_summary, tone, personality, writing_style, do_guidelines, dont_guidelines, example_excerpts, target_audience, industry_context',
      filters: { contract_id },
      limit: 1,
    }),
    select<AssetRow[]>('content_assets', {
      select: 'title, description, content_body, tags, status',
      filters: { asset_id },
      limit: 1,
    }),
  ]);

  const contract = contractRows?.[0];
  const brandVoice = brandVoiceRows?.[0];
  const asset = assetRows?.[0];

  if (!contract) throw new Error(`Contract ${contract_id} not found`);
  if (!asset) throw new Error(`Asset ${asset_id} not found`);

  // Build auto-resolved variables
  const variables: Record<string, string> = {
    company_name: contract.contract_name,
    industry: contract.industry || 'general',
    brand_voice: brandVoice ? formatBrandVoice(brandVoice) : 'No brand voice defined. Write in a professional, clear, and engaging tone.',
    topic: asset.title,
    audience: brandVoice?.target_audience || 'marketing professionals',
    // Fallbacks for sequence-specific variables — these get filled from
    // the asset title/description if the sequence references them
    angle: asset.description || 'comprehensive overview',
    key_argument: asset.description || asset.title,
    key_points: asset.description || asset.title,
    cta: 'Learn more',
    platform: 'linkedin',
    customer_name: '',
    challenge: '',
    solution: '',
    results: '',
  };

  // Merge user-provided variables (from the frontend form) — these override auto-resolved defaults
  if (user_variables) {
    for (const [key, value] of Object.entries(user_variables)) {
      if (value !== undefined && value !== null) {
        variables[key] = value;
      }
    }
  }

  // Fetch reference content
  let ragResults: SimilarityResult[] = [];
  let manualAssets: AssetRow[] = [];
  const sources: GenerationContext['sources'] = [];

  // Reference deliverables (high-priority authoritative context)
  let referenceDeliverables: DeliverableRow[] = [];
  if (reference_deliverable_ids && reference_deliverable_ids.length > 0) {
    for (const delivId of reference_deliverable_ids.slice(0, 5)) {
      try {
        const rows = await select<DeliverableRow[]>('compass_deliverables', {
          select: 'deliverable_id, title, deliverable_type, content_raw, content_structured',
          filters: { deliverable_id: delivId },
          limit: 1,
        });
        if (rows?.[0]) {
          referenceDeliverables.push(rows[0]);
        }
      } catch (err) {
        console.error(`[ContentGen] Failed to fetch reference deliverable ${delivId}:`, err);
      }
    }
  }

  // Manual reference assets
  if (reference_asset_ids && reference_asset_ids.length > 0) {
    for (const refId of reference_asset_ids.slice(0, 5)) {
      try {
        const rows = await select<AssetRow[]>('content_assets', {
          select: 'title, description, content_body, tags, status',
          filters: { asset_id: refId },
          limit: 1,
        });
        if (rows?.[0]) manualAssets.push(rows[0]);
      } catch (err) {
        console.error(`[ContentGen] Failed to fetch reference asset ${refId}:`, err);
      }
    }
  }

  // Auto RAG retrieval using the asset title as query
  if (auto_retrieve) {
    try {
      ragResults = await searchKnowledge({
        query: asset.title + (asset.description ? ` ${asset.description}` : ''),
        contract_id,
        match_count: 8,
        match_threshold: 0.4,
        source_types: ['content'],
      });

      // Deduplicate by source_id, keep best similarity
      const bestBySource = new Map<string, SimilarityResult>();
      for (const r of ragResults) {
        const existing = bestBySource.get(r.source_id);
        if (!existing || r.similarity > existing.similarity) {
          bestBySource.set(r.source_id, r);
        }
      }

      for (const r of bestBySource.values()) {
        sources.push({
          title: r.title,
          source_type: r.source_type,
          source_id: r.source_id,
          similarity: r.similarity,
        });
      }
    } catch (err) {
      console.error('[ContentGen] RAG retrieval failed (continuing without context):', err);
    }
  }

  const referenceBlock = formatReferenceBlock(ragResults, manualAssets, referenceDeliverables, additional_instructions);

  // Fetch relevant published URLs for internal linking (non-blocking — if it fails, we just skip it)
  const publishedUrls = await fetchRelevantPublishedUrls(
    asset.title + (asset.description ? ` ${asset.description}` : ''),
    contract_id,
    asset_id
  );
  variables.published_urls = publishedUrls;

  return { variables, referenceBlock, sources };
}
