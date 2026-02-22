/**
 * Extended Content Categorization via Claude
 *
 * Like categorize.ts but fetches contract-specific content types, categories,
 * and custom attribute definitions from the database (not hardcoded).
 * Returns categorization + custom attribute values in a single Claude call.
 *
 * Used by bulk ingestion pipeline where we know the content type upfront
 * (blog_post) and can fetch the right attributes immediately.
 */

import { sendMessage } from './client.js';
import { select } from '../../utils/edge-functions.js';
import type { CategorizationResult } from './categorize.js';

const MAX_CONTENT_CHARS = 4000;

export interface ExtendedCategorizationResult extends CategorizationResult {
  custom_attributes: Record<string, unknown>;
}

interface ContentTypeRow {
  type_id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface ContentCategoryRow {
  category_id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface AttributeDefinitionRow {
  attribute_id: string;
  slug: string;
  name: string;
  field_type: string;
  options: string[] | null;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function buildAttributePromptSection(attrs: AttributeDefinitionRow[]): string {
  // Only include structured fields the AI can reliably fill from constrained options.
  // Text fields are excluded — they're often references (e.g. "Pillar Page") or
  // domain-specific values the AI can't determine from content alone.
  const fillable = attrs.filter((a) =>
    ['single_select', 'multi_select', 'boolean', 'number'].includes(a.field_type)
  );
  if (fillable.length === 0) return '';

  const lines = fillable.map((attr, i) => {
    let instruction = '';
    switch (attr.field_type) {
      case 'multi_select':
        instruction = `Options: ${JSON.stringify(attr.options || [])}\n   Return: array of matching values`;
        break;
      case 'single_select':
        instruction = `Options: ${JSON.stringify(attr.options || [])}\n   Return: single matching value`;
        break;
      case 'number':
        instruction = 'Return: numeric value';
        break;
      case 'boolean':
        instruction = 'Return: true or false';
        break;
      default:
        break;
    }
    return `${i + 1}. "${attr.slug}" (${attr.field_type}): ${attr.name}\n   ${instruction}`;
  });

  return `\n\nAdditionally, fill in these custom metadata fields:\n\n${lines.join('\n\n')}`;
}

/**
 * Categorize content and fill custom attributes in a single Claude call.
 *
 * For bulk blog ingestion, contentTypeSlug is 'blog_post' (known upfront).
 * For general use, pass undefined to let Claude determine the type.
 */
export async function categorizeWithAttributes(
  contentBody: string,
  title: string,
  contractId: string,
  contentTypeSlug?: string
): Promise<ExtendedCategorizationResult | null> {
  try {
    // Fetch contract's content types
    const types = await select<ContentTypeRow[]>('content_types', {
      select: 'type_id, slug, name, description',
      filters: { is_active: true },
    });
    // Filter to contract-specific + global (null contract_id handled by RLS/service role)
    // The edge function returns all rows visible to service role, so we accept all

    // Fetch contract's categories
    const categories = await select<ContentCategoryRow[]>('content_categories', {
      select: 'category_id, slug, name, description',
      filters: { is_active: true },
    });

    // Build content types section for prompt
    const typeLines = (types || []).map(
      (t) => `- ${t.slug}: ${t.name}${t.description ? ` — ${t.description}` : ''}`
    );

    // Build categories section for prompt
    const categoryLines = (categories || []).map(
      (c) => `- ${c.slug}: ${c.name}${c.description ? ` — ${c.description}` : ''}`
    );

    // Fetch attributes mapped to the known content type (for bulk ingestion)
    let attributes: AttributeDefinitionRow[] = [];
    if (contentTypeSlug) {
      // Find the type_id for the known slug
      const matchedType = (types || []).find((t) => t.slug === contentTypeSlug);
      if (matchedType) {
        // Query attributes through the junction table
        attributes = await select<AttributeDefinitionRow[]>('content_attribute_definitions', {
          select: 'attribute_id, slug, name, field_type, options, content_attribute_type_mappings!inner(type_id)',
          filters: {
            contract_id: contractId,
            'content_attribute_type_mappings.type_id': matchedType.type_id,
          },
        }).catch(() => {
          // If join fails (no mappings table yet or no mappings), fall back to all contract attrs
          return select<AttributeDefinitionRow[]>('content_attribute_definitions', {
            select: 'attribute_id, slug, name, field_type, options',
            filters: { contract_id: contractId },
          });
        });
      }
    }
    if (!attributes) attributes = [];

    const attributeSection = buildAttributePromptSection(attributes);

    // Only include structured fields in JSON shape (matching the filter in buildAttributePromptSection)
    const fillableAttrs = attributes.filter((a) =>
      ['single_select', 'multi_select', 'boolean', 'number'].includes(a.field_type)
    );
    const customAttrsJsonShape = fillableAttrs.length > 0
      ? `,\n  "custom_attributes": { ${fillableAttrs.map((a) => `"${a.slug}": <value>`).join(', ')} }`
      : '';

    const systemPrompt = `You are a content classification engine. Analyze the given content and return a JSON object with categorization data.

Available content types (use the slug):
${typeLines.join('\n')}

Available categories (use the slug):
${categoryLines.join('\n')}
${attributeSection}

Return ONLY valid JSON (no markdown fences, no extra text) with this exact shape:
{
  "content_type_slug": "<slug>",
  "category_slug": "<slug>",
  "ai_tags": ["tag1", "tag2", ...],
  "ai_summary": "<2-3 sentence summary>",
  "ai_key_themes": ["theme1", "theme2", ...],
  "confidence": { "content_type": <0.0-1.0>, "category": <0.0-1.0> }${customAttrsJsonShape}
}

Rules:
- ai_tags: 3-7 lowercase, hyphen-separated tags relevant to the content
- ai_key_themes: 2-5 high-level themes
- ai_summary: concise 2-3 sentence summary of the content
- confidence: your confidence in each classification (0.0 to 1.0)
- Pick the BEST matching type and category even if the fit isn't perfect
${attributes.length > 0 ? '- For custom_attributes, use null if a value cannot be determined from the content' : ''}`;

    const truncated = contentBody.length > MAX_CONTENT_CHARS
      ? contentBody.substring(0, MAX_CONTENT_CHARS) + '...'
      : contentBody;

    const userMessage = `Title: ${title}\n\nContent:\n${truncated}`;

    const responseText = await sendMessage(systemPrompt, userMessage, {
      maxTokens: 1024,
      temperature: 0.2,
    });

    // Strip markdown fences if present
    const cleaned = responseText.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as {
      content_type_slug: string;
      category_slug: string;
      ai_tags: string[];
      ai_summary: string;
      ai_key_themes: string[];
      confidence: { content_type: number; category: number };
      custom_attributes?: Record<string, unknown>;
    };

    const wordCount = countWords(contentBody);

    return {
      content_type_slug: parsed.content_type_slug,
      category_slug: parsed.category_slug,
      metadata: {
        ai_summary: parsed.ai_summary,
        ai_word_count: wordCount,
        ai_key_themes: parsed.ai_key_themes,
        ai_tags: parsed.ai_tags,
        ai_categorized_at: new Date().toISOString(),
        ai_confidence: parsed.confidence,
      },
      custom_attributes: parsed.custom_attributes || {},
    };
  } catch (err) {
    console.error('[Categorization] Failed to categorize content with attributes:', err);
    return null;
  }
}
