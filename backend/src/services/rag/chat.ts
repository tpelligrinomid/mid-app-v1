/**
 * RAG Chat Service
 *
 * Orchestrates retrieval-augmented generation for the content library chat.
 * Uses a router pattern to classify questions and pick the best data source:
 *   - "structured" → query content_assets, deliverables, meetings, notes tables
 *   - "rag"        → vector similarity search through compass_knowledge
 *   - "hybrid"     → both structured + RAG
 */

import Anthropic from '@anthropic-ai/sdk';
import { searchKnowledge } from './search.js';
import { select } from '../../utils/edge-functions.js';
import { DATABOX_TOOLS, DataboxToolRunner, isDataboxTool } from '../databox/tools.js';
import type { SimilarityResult, SourceType } from '../../types/rag.js';

// Claude API config
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
// Answers run on Opus 5.5 at low effort: thinking is always on for this model
// and effort is the only control, so low keeps the pause before the first
// streamed token short. Opus 5.5 rejects temperature/top_p, so none are sent.
const ANSWER_MODEL = 'claude-opus-5-5';
const ANSWER_EFFORT = 'low';
// Intent classification runs before every answer — small and fast wins there.
const CLASSIFIER_MODEL = 'claude-haiku-4-5';
const API_VERSION = '2023-06-01';

// Anthropic-hosted web tools: they run inside the same request, so the answer
// call needs no tool loop. Caps keep a single message from fanning out.
// Research across several companies routinely takes 10+ searches, and this
// version can fire several in parallel, so search gets a looser cap than
// fetch ($10 per 1,000 searches, so 15 is at most $0.15 a message).
const WEB_TOOLS: Anthropic.ToolUnion[] = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 15,
    user_location: { type: 'approximate', country: 'US' },
  },
  {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
    max_uses: 10,
    max_content_tokens: 20000,
    citations: { enabled: true },
  },
];

export const WEB_GUIDANCE = `## Web access

You can search the web (web_search) and read web pages (web_fetch). The client's own data above is the source of truth for anything about this client; use the web for outside information such as competitors, market and industry facts, companies or people to research, recent news, or when the user asks you to look something up. Don't search for what the client data already answers.

web_fetch can only open a URL that already appeared in a web_search result or in the user's own message. Websites or URLs mentioned only in the client data above can't be fetched directly, and a blocked fetch still uses up an attempt. To read a site, first web_search for it (for example the company name or domain), then fetch the URL from the search results. If the results don't include the exact page you need (such as a homepage), search again more specifically, for example "site:example.com", before settling for a different page. Don't retry a fetch that failed.

Write only the final answer as text: no notes to yourself before or between tool calls.

Never invent company names, people, figures or URLs. If searching doesn't turn up something solid, say so plainly. When a point comes from the web, name the source in your answer, and keep it clear which points come from the client's data and which from the web.`;

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
  source_types?: SourceType[];
}

export interface ContextSource {
  title: string;
  source_type: string;
  source_id: string;
  chunk_index: number;
  similarity: number;
}

export interface WebSource {
  title: string;
  url: string;
}

export type SSEChunk =
  | { type: 'context'; sources: ContextSource[] }
  // Progress while Claude searches or reads a page, e.g. 'Searching the web for "..."'.
  | { type: 'status'; message: string }
  // Web pages the answer cited or read, sent once before `done`.
  | { type: 'web_sources'; sources: WebSource[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; usage?: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; message: string };

type QueryIntent = 'structured' | 'rag' | 'hybrid';

interface ClassificationResult {
  intent: QueryIntent;
  structured_queries: string[];
}

// ============================================================================
// Intent Classification
// ============================================================================

async function classifyIntent(
  message: string,
  apiKey: string
): Promise<ClassificationResult> {
  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        max_tokens: 200,
        temperature: 0,
        system: `You classify user questions about a content library into one of three categories. Respond with ONLY valid JSON, no other text.

Categories:
- "structured": Questions about counts, trends, dates, categories, statuses, or attributes. These need database queries, not content search. Examples: "How many blog posts did we publish last month?", "What topics do we write about most?", "What content is in draft status?", "Show me content published in Q4"
- "rag": Questions about what specific content says, themes, opinions, strategies, or deep-dive analysis. These need semantic search through actual content. Examples: "What's our take on ABM?", "What do we say about demand gen?", "What themes come up in our blog posts?"
- "hybrid": Questions that need both structured data AND content search. This includes any request that combines temporal/recency language with content summarization. Examples: "What topics did we cover in Q4 and what were the key themes?", "Which published blog posts discuss ABM?", "Give me a summary of the last 3 meetings", "What was discussed in recent meetings?", "Summarize our last meeting", "What did we talk about this month?", "What are the key takeaways from meetings in the last 90 days?"

IMPORTANT: Any question asking to summarize, recap, list, or describe what happened in recent/last/past meetings or notes MUST be classified as "hybrid" with the appropriate structured_queries (e.g., "meetings_list", "notes_list"), NOT as "rag". The structured query provides the correct chronological ordering and metadata (note_type, date), while RAG provides the content for summarization. This includes questions that filter by note type (e.g., "paid media notes", "content notes", "strategy notes") or date range (e.g., "last 30 days", "this month", "past week").

Also provide "structured_queries" — an array of short labels for what structured data to fetch. Valid labels:
- "content_by_category" — count/list content grouped by category
- "content_by_type" — count/list content grouped by content type
- "content_by_status" — count/list content grouped by status
- "content_by_date" — content filtered or grouped by published date
- "content_by_attributes" — content with custom attribute analysis
- "content_list" — general list of content assets
- "deliverables_list" — list of deliverables
- "meetings_list" — list of meetings
- "notes_list" — list of notes (includes note_type: meeting, abm, paid, content, web, status, strategy)
- "content_stats" — overall content statistics

For "rag" intent, structured_queries should be an empty array.

Respond with JSON like: {"intent":"structured","structured_queries":["content_by_category","content_stats"]}`,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!response.ok) {
      return { intent: 'rag', structured_queries: [] };
    }

    const result = await response.json() as {
      content: { type: string; text: string }[];
    };

    const text = result.content?.[0]?.text?.trim();
    if (!text) return { intent: 'rag', structured_queries: [] };

    const parsed = JSON.parse(text);
    return {
      intent: parsed.intent || 'rag',
      structured_queries: parsed.structured_queries || [],
    };
  } catch {
    // Default to RAG if classification fails
    return { intent: 'rag', structured_queries: [] };
  }
}

// ============================================================================
// Structured Data Queries
// ============================================================================

interface StructuredData {
  label: string;
  data: string;
}

async function fetchStructuredData(
  queries: string[],
  contractId: string,
  sourceTypes?: SourceType[]
): Promise<StructuredData[]> {
  const results: StructuredData[] = [];

  // Determine which tables to query based on source_types scope
  const isContentScope = sourceTypes?.includes('content');
  const isManagementScope = sourceTypes?.some(st =>
    ['note', 'meeting', 'deliverable'].includes(st)
  );

  for (const query of queries) {
    try {
      switch (query) {
        case 'content_by_category': {
          if (isManagementScope && !isContentScope) break;
          const assets = await select<Record<string, unknown>[]>('content_assets', {
            select: 'category_id, title, status, published_date, custom_attributes, metadata',
            filters: { contract_id: contractId },
            limit: 500,
          });
          if (assets && assets.length > 0) {
            // Fetch category names — contract-specific + global (null contract_id)
            const [contractCats, globalCats] = await Promise.all([
              select<Record<string, unknown>[]>('content_categories', {
                select: 'category_id, name',
                filters: { contract_id: contractId },
              }),
              select<Record<string, unknown>[]>('content_categories', {
                select: 'category_id, name',
                filters: { contract_id: { is: null } },
              }),
            ]);
            const catMap = new Map([
              ...(globalCats || []).map(c => [c.category_id, c.name] as [unknown, unknown]),
              ...(contractCats || []).map(c => [c.category_id, c.name] as [unknown, unknown]),
            ]);
            const grouped: Record<string, number> = {};
            for (const a of assets) {
              // Try category_id first, then AI-assigned category from metadata
              let catName = 'Uncategorized';
              if (a.category_id && catMap.has(a.category_id)) {
                catName = catMap.get(a.category_id) as string;
              } else if (a.metadata && typeof a.metadata === 'object') {
                const meta = a.metadata as Record<string, unknown>;
                if (meta.ai_category_slug) catName = meta.ai_category_slug as string;
                else if (meta.ai_category) catName = meta.ai_category as string;
              }
              grouped[catName] = (grouped[catName] || 0) + 1;
            }
            const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
            results.push({
              label: 'Content by Category',
              data: sorted.map(([cat, count]) => `${cat}: ${count} pieces`).join('\n'),
            });
          }
          break;
        }

        case 'content_by_type': {
          if (isManagementScope && !isContentScope) break;
          const assets = await select<Record<string, unknown>[]>('content_assets', {
            select: 'content_type_id, title, status, metadata',
            filters: { contract_id: contractId },
            limit: 500,
          });
          if (assets && assets.length > 0) {
            const types = await select<Record<string, unknown>[]>('content_types', {
              select: 'type_id, name',
              limit: 100,
            });
            const typeMap = new Map((types || []).map(t => [t.type_id, t.name]));
            const grouped: Record<string, number> = {};
            for (const a of assets) {
              let typeName = 'Untyped';
              if (a.content_type_id && typeMap.has(a.content_type_id)) {
                typeName = typeMap.get(a.content_type_id) as string;
              } else if (a.metadata && typeof a.metadata === 'object') {
                const meta = a.metadata as Record<string, unknown>;
                if (meta.ai_content_type_slug) typeName = meta.ai_content_type_slug as string;
                else if (meta.ai_content_type) typeName = meta.ai_content_type as string;
              }
              grouped[typeName] = (grouped[typeName] || 0) + 1;
            }
            const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
            results.push({
              label: 'Content by Type',
              data: sorted.map(([type, count]) => `${type}: ${count} pieces`).join('\n'),
            });
          }
          break;
        }

        case 'content_by_status': {
          if (isManagementScope && !isContentScope) break;
          const assets = await select<Record<string, unknown>[]>('content_assets', {
            select: 'status, title',
            filters: { contract_id: contractId },
            limit: 500,
          });
          if (assets && assets.length > 0) {
            const grouped: Record<string, number> = {};
            for (const a of assets) {
              const status = (a.status as string) || 'unknown';
              grouped[status] = (grouped[status] || 0) + 1;
            }
            results.push({
              label: 'Content by Status',
              data: Object.entries(grouped).map(([s, c]) => `${s}: ${c}`).join('\n'),
            });
          }
          break;
        }

        case 'content_by_date': {
          if (isManagementScope && !isContentScope) break;
          const assets = await select<Record<string, unknown>[]>('content_assets', {
            select: 'title, status, published_date, category_id',
            filters: { contract_id: contractId },
            order: [{ column: 'published_date', ascending: false }],
            limit: 200,
          });
          if (assets && assets.length > 0) {
            const withDates = assets.filter(a => a.published_date);
            const byMonth: Record<string, string[]> = {};
            for (const a of withDates) {
              const month = (a.published_date as string).substring(0, 7); // YYYY-MM
              if (!byMonth[month]) byMonth[month] = [];
              byMonth[month].push(a.title as string);
            }
            const monthLines = Object.entries(byMonth)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .slice(0, 12)
              .map(([month, titles]) => `${month}: ${titles.length} pieces (${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '...' : ''})`)
              .join('\n');
            results.push({
              label: 'Content by Published Date',
              data: `${withDates.length} published pieces total.\n${monthLines}`,
            });
          }
          break;
        }

        case 'content_by_attributes': {
          if (isManagementScope && !isContentScope) break;
          const [attrDefs, assets] = await Promise.all([
            select<Record<string, unknown>[]>('content_attribute_definitions', {
              select: 'slug, name, field_type',
              filters: { contract_id: contractId },
            }),
            select<Record<string, unknown>[]>('content_assets', {
              select: 'title, custom_attributes',
              filters: { contract_id: contractId },
              limit: 500,
            }),
          ]);
          if (attrDefs && attrDefs.length > 0 && assets && assets.length > 0) {
            const lines: string[] = [];
            for (const def of attrDefs) {
              const slug = def.slug as string;
              const name = def.name as string;
              const valueCounts: Record<string, number> = {};
              let withValue = 0;
              for (const a of assets) {
                const attrs = a.custom_attributes as Record<string, unknown> | null;
                if (attrs && attrs[slug] != null) {
                  withValue++;
                  const val = String(attrs[slug]);
                  valueCounts[val] = (valueCounts[val] || 0) + 1;
                }
              }
              if (withValue > 0) {
                const topValues = Object.entries(valueCounts)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([v, c]) => `${v} (${c})`)
                  .join(', ');
                lines.push(`${name}: ${withValue}/${assets.length} have values. Top: ${topValues}`);
              }
            }
            if (lines.length > 0) {
              results.push({ label: 'Custom Attributes', data: lines.join('\n') });
            }
          }
          break;
        }

        case 'content_list': {
          if (isManagementScope && !isContentScope) break;
          const assets = await select<Record<string, unknown>[]>('content_assets', {
            select: 'title, status, published_date, tags',
            filters: { contract_id: contractId },
            order: [{ column: 'published_date', ascending: false }],
            limit: 50,
          });
          if (assets && assets.length > 0) {
            results.push({
              label: 'Content Assets (recent)',
              data: assets.map(a =>
                `- "${a.title}" [${a.status}]${a.published_date ? ` published ${a.published_date}` : ''}`
              ).join('\n'),
            });
          }
          break;
        }

        case 'content_stats': {
          if (isManagementScope && !isContentScope) break;
          const assets = await select<Record<string, unknown>[]>('content_assets', {
            select: 'status, published_date',
            filters: { contract_id: contractId },
            limit: 1000,
          });
          if (assets && assets.length > 0) {
            const total = assets.length;
            const published = assets.filter(a => a.status === 'published').length;
            const draft = assets.filter(a => a.status === 'draft').length;
            const inProd = assets.filter(a => a.status === 'in_production').length;
            const withDates = assets.filter(a => a.published_date);
            const dates = withDates.map(a => a.published_date as string).sort();
            results.push({
              label: 'Content Statistics',
              data: `Total: ${total} content assets\nPublished: ${published}\nDraft: ${draft}\nIn Production: ${inProd}\nDate range: ${dates[0] || 'N/A'} to ${dates[dates.length - 1] || 'N/A'}`,
            });
          }
          break;
        }

        case 'deliverables_list': {
          if (isContentScope && !isManagementScope) break;
          const deliverables = await select<Record<string, unknown>[]>('compass_deliverables', {
            select: 'title, deliverable_type, status, delivered_date, due_date',
            filters: { contract_id: contractId },
            order: [{ column: 'created_at', ascending: false }],
            limit: 50,
          });
          if (deliverables && deliverables.length > 0) {
            results.push({
              label: 'Deliverables',
              data: deliverables.map(d =>
                `- "${d.title}" [${d.deliverable_type}, ${d.status}]${d.delivered_date ? ` delivered ${d.delivered_date}` : d.due_date ? ` due ${d.due_date}` : ''}`
              ).join('\n'),
            });
          }
          break;
        }

        case 'meetings_list': {
          if (isContentScope && !isManagementScope) break;
          const meetings = await select<Record<string, unknown>[]>('compass_meetings', {
            select: 'title, meeting_date, participants, duration_seconds',
            filters: { contract_id: contractId },
            order: [{ column: 'meeting_date', ascending: false }],
            limit: 50,
          });
          if (meetings && meetings.length > 0) {
            results.push({
              label: 'Recent Meetings',
              data: meetings.map(m => {
                const duration = m.duration_seconds ? ` (${Math.round(Number(m.duration_seconds) / 60)}min)` : '';
                const participants = Array.isArray(m.participants) ? ` — ${(m.participants as string[]).join(', ')}` : '';
                return `- "${m.title}" on ${(m.meeting_date as string).substring(0, 10)}${duration}${participants}`;
              }).join('\n'),
            });
          }
          break;
        }

        case 'notes_list': {
          if (isContentScope && !isManagementScope) break;
          const notes = await select<Record<string, unknown>[]>('compass_notes', {
            select: 'title, note_type, note_date, status, content_raw',
            filters: { contract_id: contractId },
            order: [{ column: 'note_date', ascending: false }],
            limit: 200,
          });
          if (notes && notes.length > 0) {
            results.push({
              label: 'Recent Notes',
              data: notes.map(n => {
                const summary = n.content_raw
                  ? (n.content_raw as string).substring(0, 500) + ((n.content_raw as string).length > 500 ? '...' : '')
                  : '(no content)';
                return `- "${n.title}" [${n.note_type}] ${n.note_date || ''}\n  ${summary}`;
              }).join('\n'),
            });
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[RAG Chat] Structured query "${query}" failed:`, err instanceof Error ? err.message : err);
    }
  }

  return results;
}

// ============================================================================
// System Prompts
// ============================================================================

function buildRagPrompt(results: SimilarityResult[]): string {
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

function buildStructuredPrompt(structuredData: StructuredData[]): string {
  const dataBlocks = structuredData
    .map(d => `## ${d.label}\n${d.data}`)
    .join('\n\n');

  return `You are a knowledgeable content analyst for a marketing agency. You have access to structured data from the client's content management system. Use this data to answer their question accurately.

Present numbers and statistics clearly. If the data reveals interesting patterns or insights, highlight them. Keep your response concise and actionable.

${dataBlocks}`;
}

function buildHybridPrompt(structuredData: StructuredData[], ragResults: SimilarityResult[]): string {
  const dataBlocks = structuredData
    .map(d => `## ${d.label}\n${d.data}`)
    .join('\n\n');

  const contextBlocks = ragResults
    .map((r, i) => {
      return `[${i + 1}] Title: "${r.title}"\nSource: ${r.source_type}\n---\n${r.content}`;
    })
    .join('\n\n');

  return `You are a knowledgeable content analyst for a marketing agency. You have access to both structured data and content from the client's library. Use ALL of this context to give a comprehensive answer.

When referencing specific content, mention the title. Present numbers and statistics clearly. Keep your response concise and actionable.

## Structured Data

${dataBlocks}

## Retrieved Content

${contextBlocks}`;
}

const NO_CONTENT_PROMPT = `You are a knowledgeable content analyst for a marketing agency. No content in the client's library matched this question.

If the question needs outside information (market, competitors, companies, people, news) or the user asks you to research something, use the web. If it is about the client's own content and the web can't answer it, say you couldn't find matching content and suggest rephrasing the question or checking that the content has been ingested.`;

// ============================================================================
// Stream Chat Response
// ============================================================================

export async function streamChatResponse(
  params: ChatParams,
  onChunk: (chunk: SSEChunk) => void
): Promise<void> {
  const { message, contract_id, conversation_history = [], source_types } = params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    onChunk({ type: 'error', message: 'ANTHROPIC_API_KEY is not configured' });
    return;
  }

  // 1. Classify the question intent
  const classification = await classifyIntent(message, apiKey);
  const { intent, structured_queries } = classification;

  // 2. Fetch data based on intent
  let ragResults: SimilarityResult[] = [];
  let structuredData: StructuredData[] = [];

  if (intent === 'structured' || intent === 'hybrid') {
    structuredData = await fetchStructuredData(structured_queries, contract_id, source_types);
  }

  if (intent === 'rag' || intent === 'hybrid') {
    try {
      ragResults = await searchKnowledge({
        query: message,
        contract_id,
        match_count: 50,
        match_threshold: 0.3,
        source_types,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown search error';
      console.error('[RAG Chat] Knowledge search failed:', errMsg);
      // For hybrid, continue with just structured data; for pure RAG, emit error
      if (intent === 'rag') {
        onChunk({ type: 'error', message: `Knowledge search failed: ${errMsg}` });
        return;
      }
    }
  }

  // If structured intent returned no data, fall back to RAG
  if (intent === 'structured' && structuredData.length === 0) {
    try {
      ragResults = await searchKnowledge({
        query: message,
        contract_id,
        match_count: 50,
        match_threshold: 0.3,
        source_types,
      });
    } catch {
      // Continue with empty results
    }
  }

  // 3. Emit context sources (from RAG results if any)
  const bestBySource = new Map<string, SimilarityResult>();
  for (const r of ragResults) {
    const existing = bestBySource.get(r.source_id);
    if (!existing || r.similarity > existing.similarity) {
      bestBySource.set(r.source_id, r);
    }
  }
  const sources: ContextSource[] = Array.from(bestBySource.values()).map((r) => ({
    title: r.title,
    source_type: r.source_type,
    source_id: r.source_id,
    chunk_index: r.chunk_index,
    similarity: r.similarity,
  }));
  onChunk({ type: 'context', sources });

  // 4. Build system prompt based on what data we have
  let systemPrompt: string;

  if (structuredData.length > 0 && ragResults.length > 0) {
    systemPrompt = buildHybridPrompt(structuredData, ragResults);
  } else if (structuredData.length > 0) {
    systemPrompt = buildStructuredPrompt(structuredData);
  } else if (ragResults.length > 0) {
    systemPrompt = buildRagPrompt(ragResults);
  } else {
    systemPrompt = NO_CONTENT_PROMPT;
  }
  systemPrompt += `\n\n${WEB_GUIDANCE}`;

  const messages = [
    ...conversation_history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: withExplicitLinks(message) },
  ];

  // 5. Marketing data tools, when the contract has a Databox account
  const databoxAccountId = await getDataboxAccountId(contract_id);
  if (databoxAccountId) systemPrompt += `\n\n${marketingGuidance()}`;

  // 6. Answer, running tools as Claude asks for them
  await runAnswer(
    {
      apiKey,
      system: systemPrompt,
      messages: [
        ...conversation_history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: withExplicitLinks(message) },
      ],
      databox: databoxAccountId ? new DataboxToolRunner(databoxAccountId) : null,
    },
    onChunk
  );
}

async function getDataboxAccountId(contractId: string): Promise<string | null> {
  try {
    const row = await select<{ databox_account_id: string | null }>('contracts', {
      select: 'databox_account_id',
      filters: { id: contractId },
      single: true,
    });
    return row?.databox_account_id || null;
  } catch (err) {
    // Missing column (migration 021 not applied) or no row: answer without marketing tools.
    console.warn('[RAG Chat] No Databox account for contract:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function marketingGuidance(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `## Marketing performance data

You can read this client's own marketing performance (for example Google Analytics 4, Google Ads, LinkedIn Ads) with list_marketing_sources, list_source_metrics and get_marketing_metric. Use them for questions about the client's traffic, ad spend, campaigns, ads, keywords, conversions or results. Start with list_marketing_sources, then list_source_metrics to get exact metric keys and dimensions; don't guess keys.

Today is ${today}. Turn relative periods ("last month", "this quarter", "last 30 days") into exact dates, and say which dates you used. Every result includes the previous period of the same length, so you can describe the change without another call. Report values with the currency or unit shown, and if sources use different currencies, keep them separate rather than adding them up. Work out derived figures (cost per lead, ROAS, share of spend) from the returned totals and show how.

These numbers are the client's own data and take priority over anything from the web.`;
}

// ============================================================================
// Answer loop
// ============================================================================

// Upper bound on model turns in one answer (each Databox tool round is a turn).
const MAX_ANSWER_TURNS = 12;

export interface AnswerParams {
  apiKey: string;
  system: string;
  messages: Anthropic.MessageParam[];
  databox: DataboxToolRunner | null;
}

/**
 * Stream an answer, executing Compass's own tools (Databox) between turns.
 * Web search and fetch run on Anthropic's side inside each turn; a paused
 * server-tool turn is resumed by sending it back.
 */
export async function runAnswer(params: AnswerParams, onChunk: (chunk: SSEChunk) => void): Promise<void> {
  const client = new Anthropic({ apiKey: params.apiKey });
  const relay = new StreamRelay(onChunk);
  const messages = [...params.messages];
  let webTools = true;
  let stopReason: string | null = null;

  for (let turn = 0; turn < MAX_ANSWER_TURNS; turn++) {
    const tools: Anthropic.ToolUnion[] = [
      ...(webTools ? WEB_TOOLS : []),
      ...(params.databox ? DATABOX_TOOLS : []),
    ];

    let message: Anthropic.Message;
    try {
      const stream = client.messages.stream({
        model: ANSWER_MODEL,
        // Thinking counts toward max_tokens, so leave room beyond the reply.
        max_tokens: 16000,
        output_config: { effort: ANSWER_EFFORT },
        system: params.system,
        messages,
        ...(tools.length > 0 && { tools }),
      });
      for await (const event of stream) relay.handle(event);
      message = await stream.finalMessage();
    } catch (err) {
      // If the web tools are rejected (e.g. web search turned off for the
      // org), answer without them rather than failing every chat.
      if (err instanceof Anthropic.BadRequestError && webTools && turn === 0) {
        console.error('[RAG Chat] Claude API 400 with web tools, retrying without them:', err.message.substring(0, 300));
        webTools = false;
        turn--;
        continue;
      }
      const errMsg = err instanceof Error ? err.message : 'Claude API request failed';
      console.error('[RAG Chat] Claude API request failed:', errMsg);
      onChunk({ type: 'error', message: `Claude API request failed: ${errMsg.substring(0, 200)}` });
      return;
    }

    relay.addUsage(message.usage);
    stopReason = message.stop_reason;

    if (stopReason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }

    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (stopReason !== 'tool_use' || toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: message.content });
    const results = await Promise.all(
      toolUses.map(async (toolUse): Promise<Anthropic.ToolResultBlockParam> => {
        const input = (toolUse.input ?? {}) as Record<string, unknown>;
        try {
          if (!params.databox || !isDataboxTool(toolUse.name)) throw new Error(`Unknown tool: ${toolUse.name}`);
          onChunk({ type: 'status', message: await params.databox.describe(toolUse.name, input) });
          return { type: 'tool_result', tool_use_id: toolUse.id, content: await params.databox.run(toolUse.name, input) };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[RAG Chat] Tool ${toolUse.name} failed:`, errMsg);
          return { type: 'tool_result', tool_use_id: toolUse.id, content: errMsg, is_error: true };
        }
      })
    );
    // All results go back in one user message so parallel calls stay parallel.
    messages.push({ role: 'user', content: results });
  }

  relay.finish(stopReason);
}

// web_fetch only opens URLs that literally appear in a user message (or in
// search results), and a bare domain like "newnorth.com" doesn't count. Bare
// domains the user mentions are appended as full URLs so Claude can open them.
const BARE_DOMAIN = /(?<![@\w./:-])((?:[a-z0-9-]+\.)+(?:com|io|co|ai|net|org|app|dev|us|uk|ca|au|de|biz|info|tech|agency|consulting|marketing|so|xyz|me))(\/[^\s,;)]*)?(?![\w-])/gi;

export function withExplicitLinks(message: string): string {
  const urls = new Set<string>();
  for (const match of message.matchAll(BARE_DOMAIN)) {
    const path = (match[2] ?? '/').replace(/[.?!]+$/, '') || '/';
    urls.add(`https://${match[1].toLowerCase()}${path}`);
    if (urls.size >= 10) break;
  }
  if (urls.size === 0) return message;
  return `${message}\n\n(Links: ${Array.from(urls).join(' ')})`;
}

// Text shorter than this that is followed by a tool call is treated as a
// working note ("Need homepages first.") and dropped instead of shown.
const NOTE_HOLD_CHARS = 200;

/**
 * Turns Claude's stream events, across every turn of an answer, into
 * SSEChunks: answer text, tool progress, web sources, and the closing
 * done/error event.
 */
class StreamRelay {
  // Server tool calls stream their input as JSON fragments; collect them per
  // content block so a status line can be sent once the input is complete.
  private pendingToolInputs = new Map<number, { name: string; json: string }>();
  private webSources = new Map<string, WebSource>();
  private sentText = false;
  private toolUsedSinceText = false;
  // Each text block is held until it passes NOTE_HOLD_CHARS, another text
  // block starts, or the turn ends; a tool call starting first drops it.
  private heldText = '';
  private textBlockStreaming = false;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(private readonly onChunk: (chunk: SSEChunk) => void) {}

  addUsage(usage: Anthropic.Usage): void {
    this.inputTokens += usage.input_tokens;
    this.outputTokens += usage.output_tokens;
  }

  private emitText(text: string): void {
    // Text that resumes after a tool call starts a new paragraph instead of
    // running on from whatever was shown before the call.
    const prefix = this.toolUsedSinceText && this.sentText ? '\n\n' : '';
    this.toolUsedSinceText = false;
    this.sentText = true;
    this.onChunk({ type: 'delta', text: prefix + text });
  }

  private flushHeldText(): void {
    if (this.heldText) this.emitText(this.heldText);
    this.heldText = '';
  }

  private addWebSource(url: string | undefined, title: string | undefined): void {
    if (url && !this.webSources.has(url)) this.webSources.set(url, { url, title: title || url });
  }

  handle(event: Anthropic.RawMessageStreamEvent): void {
    if (event.type === 'content_block_start') {
      // Loosely typed: server tool result shapes vary by tool version.
      const block = event.content_block as {
        type: string;
        name?: string;
        input?: Record<string, unknown>;
        content?: { type?: string; url?: string; error_code?: string; content?: { title?: string } };
      };
      if (block.type === 'text') {
        this.flushHeldText();
        this.textBlockStreaming = false;
      }
      if ((block.type === 'server_tool_use' || block.type === 'tool_use') && block.name) {
        if (this.heldText) console.log(`[RAG Chat] Dropped working note before ${block.name}: ${this.heldText.trim()}`);
        this.heldText = '';
        this.toolUsedSinceText = true;
        if (block.type === 'server_tool_use') {
          // Calls made from code execution arrive with their input already
          // filled in rather than streamed as input_json_delta.
          const startInput = block.input && Object.keys(block.input).length ? JSON.stringify(block.input) : '';
          this.pendingToolInputs.set(event.index, { name: block.name, json: startInput });
        }
      }
      // A fetched page is a source even when no sentence cites it directly.
      if (block.type === 'web_fetch_tool_result' && block.content?.type === 'web_fetch_result') {
        this.addWebSource(block.content.url, block.content.content?.title);
      }
      // Tool errors come back as a 200 with an error object instead of
      // results; log them, since otherwise only the answer's wording shows it.
      if ((block.type === 'web_search_tool_result' || block.type === 'web_fetch_tool_result') && block.content?.error_code) {
        console.warn(`[RAG Chat] ${block.type} error: ${block.content.error_code}`);
      }
      return;
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta as {
        type: string;
        text?: string;
        partial_json?: string;
        citation?: { type?: string; url?: string; title?: string };
      };
      if (delta.type === 'text_delta' && delta.text) {
        if (this.textBlockStreaming) {
          this.emitText(delta.text);
        } else {
          this.heldText += delta.text;
          if (this.heldText.length >= NOTE_HOLD_CHARS) {
            this.flushHeldText();
            this.textBlockStreaming = true;
          }
        }
      }
      if (delta.type === 'input_json_delta' && delta.partial_json) {
        const pending = this.pendingToolInputs.get(event.index);
        if (pending) pending.json += delta.partial_json;
      }
      if (delta.type === 'citations_delta' && delta.citation?.type === 'web_search_result_location') {
        this.addWebSource(delta.citation.url, delta.citation.title);
      }
      return;
    }

    if (event.type === 'content_block_stop') {
      const pending = this.pendingToolInputs.get(event.index);
      if (!pending) return;
      this.pendingToolInputs.delete(event.index);
      let input: { query?: string; url?: string } = {};
      try {
        input = JSON.parse(pending.json || '{}');
      } catch {
        // Leave the status generic
      }
      if (pending.name === 'web_search') {
        this.onChunk({ type: 'status', message: input.query ? `Searching the web for "${input.query}"` : 'Searching the web' });
      } else if (pending.name === 'web_fetch') {
        this.onChunk({ type: 'status', message: input.url ? `Reading ${input.url}` : 'Reading a web page' });
      }
      return;
    }

    if (event.type === 'message_stop') {
      // Text still held at the end of a turn is answer text, not a note.
      this.flushHeldText();
      this.pendingToolInputs.clear();
    }
  }

  finish(stopReason: string | null): void {
    this.flushHeldText();

    // A safety-classifier decline arrives as a normal stream that ends with
    // stop_reason "refusal"; without this the answer would just stop short.
    if (stopReason === 'refusal') {
      console.warn('[RAG Chat] Claude declined the request (stop_reason: refusal)');
      this.onChunk({ type: 'error', message: 'Claude declined to answer this question. Try rephrasing it.' });
      return;
    }

    // Still paused or still calling tools after MAX_ANSWER_TURNS.
    if (stopReason === 'pause_turn' || stopReason === 'tool_use') {
      console.warn(`[RAG Chat] Answer stopped at the turn limit (stop_reason: ${stopReason})`);
      this.onChunk({
        type: 'delta',
        text: '\n\n_I hit my limit on lookups for one message, so this answer may be incomplete. Ask a narrower follow-up to dig further._',
      });
    }

    if (this.webSources.size > 0) {
      this.onChunk({ type: 'web_sources', sources: Array.from(this.webSources.values()) });
    }

    this.onChunk({
      type: 'done',
      usage: { input_tokens: this.inputTokens, output_tokens: this.outputTokens },
    });
  }
}
