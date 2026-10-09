/**
 * Databox tools for Compass chat
 *
 * Three read-only tools over the Databox MCP, each scoped to one Databox
 * account that the backend supplies from the contract (contracts.
 * databox_account_id). The model never sees or chooses the account, and a
 * source ID outside that account is rejected.
 *
 * Databox's raw metric payloads are large chart objects (one LinkedIn
 * breakdown by ad ran to ~126k characters), so results are cut down to
 * totals, previous-period comparisons and short series before the model
 * sees them.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { callDataboxTool } from './mcp.js';

// ============================================================================
// Tool definitions
// ============================================================================

export const DATABOX_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_marketing_sources',
    description:
      "List the client's connected marketing data sources in Databox (for example Google Analytics 4, Google Ads, LinkedIn Ads), with each source's ID and type. Call this first to find the source_id for the other marketing tools.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_source_metrics',
    description:
      'List the metrics one connected source provides, with each metric_key and the dimensions it can be broken down by (for example campaign, ad group, keyword, ad, channel). Use it to find the exact metric_key and dimension before calling get_marketing_metric.',
    input_schema: {
      type: 'object',
      properties: {
        source_id: { type: 'integer', description: 'Source ID from list_marketing_sources.' },
      },
      required: ['source_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_marketing_metric',
    description:
      "Get one metric's value for a date range from a connected source, compared with the previous period of the same length. Optionally break it down by a dimension (returns the top values) or by time (returns a series). Values come back with their currency or unit as formatted by Databox. Rates and averages such as CTR, CPC, CPM, reach and frequency are already computed for the whole range: never add up daily values of those.",
    input_schema: {
      type: 'object',
      properties: {
        source_id: { type: 'integer', description: 'Source ID from list_marketing_sources.' },
        metric_key: {
          type: 'string',
          description: 'Exact metric_key from list_source_metrics, for example "GoogleAdwords@cost".',
        },
        start_date: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'End date, YYYY-MM-DD (inclusive).' },
        dimension: {
          type: 'string',
          description: 'Optional dimension key from list_source_metrics, for example "campaign".',
        },
        granularity: {
          type: 'string',
          enum: ['day', 'week', 'month'],
          description: 'Optional: return a time series at this granularity instead of a single total.',
        },
      },
      required: ['source_id', 'metric_key', 'start_date', 'end_date'],
      additionalProperties: false,
    },
  },
];

const DATABOX_TOOL_NAMES = new Set(DATABOX_TOOLS.map((t) => t.name));

export function isDataboxTool(name: string): boolean {
  return DATABOX_TOOL_NAMES.has(name);
}

// ============================================================================
// Databox MCP response shapes (only the fields used here)
// ============================================================================

interface DataSource {
  id: string;
  name: string;
  type: string;
  created_at?: string;
}

interface MetricDefinition {
  metric_key: string;
  name: string;
  description?: string;
  dimensions?: Array<{ key: string; value: string }>;
}

interface ChartPoint {
  y: number | null;
  metadata?: { label?: string; formattedValue?: string; change?: { value: number; changeType: string } };
}

interface ChartSeries {
  seriesType: 'primary' | 'compare' | 'number';
  attributes?: { dimension?: string };
  data: ChartPoint[];
  compares?: ChartPoint[];
}

interface MetricDataResponse {
  chart?: { visualizationData?: ChartSeries[] };
}

// ============================================================================
// Execution
// ============================================================================

const GRANULARITY_UNIT: Record<string, number> = { day: 2, week: 3, month: 4 };
const MAX_DIMENSION_ROWS = 25;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A newly connected source can take hours to backfill its history.
const SYNC_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Runs Databox tools for one contract's account. Caches the account's source
 * list so source IDs can be checked against it without a call per tool use.
 */
export class DataboxToolRunner {
  private sources: Promise<DataSource[]> | null = null;

  constructor(private readonly accountId: string) {}

  private listSources(): Promise<DataSource[]> {
    this.sources ??= callDataboxTool<{ data_sources: DataSource[] }>('list_data_sources', {
      account_id: this.accountId,
    }).then((r) => r.data_sources ?? []);
    return this.sources;
  }

  private async requireSource(sourceId: unknown): Promise<DataSource> {
    const id = String(sourceId);
    const source = (await this.listSources()).find((s) => s.id === id);
    if (!source) throw new Error(`Source ${id} is not connected for this client. Call list_marketing_sources.`);
    return source;
  }

  /** Short progress line for the chat UI. */
  async describe(name: string, input: Record<string, unknown>): Promise<string> {
    if (name === 'list_marketing_sources') return 'Checking connected marketing data';
    const source = await this.requireSource(input.source_id).catch(() => null);
    const sourceName = source ? source.type : 'marketing data';
    if (name === 'list_source_metrics') return `Checking ${sourceName} metrics`;
    const metric = String(input.metric_key ?? '').split('@').pop();
    const by = input.dimension ? ` by ${input.dimension}` : '';
    return `Pulling ${sourceName} ${metric}${by} (${input.start_date} to ${input.end_date})`;
  }

  /** Execute a tool and return the JSON string for the tool_result. */
  async run(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'list_marketing_sources': {
        const sources = await this.listSources();
        return JSON.stringify({
          sources: sources
            // Push/token sources hold no marketing metrics.
            .filter((s) => !['Push custom data'].includes(s.type))
            .map((s) => ({
              source_id: Number(s.id),
              name: s.name,
              type: s.type,
              connected_on: s.created_at?.slice(0, 10) ?? null,
            })),
        });
      }

      case 'list_source_metrics': {
        await this.requireSource(input.source_id);
        const result = await callDataboxTool<{ metrics: MetricDefinition[] }>('list_metrics', {
          data_source_id: Number(input.source_id),
        });
        return JSON.stringify({
          metrics: (result.metrics ?? []).map((m) => ({
            metric_key: m.metric_key,
            name: m.name,
            dimensions: (m.dimensions ?? []).map((d) => d.key),
          })),
        });
      }

      case 'get_marketing_metric': {
        const source = await this.requireSource(input.source_id);
        const start = String(input.start_date ?? '');
        const end = String(input.end_date ?? '');
        if (!DATE_RE.test(start) || !DATE_RE.test(end)) throw new Error('start_date and end_date must be YYYY-MM-DD');
        if (typeof input.metric_key !== 'string' || !input.metric_key) throw new Error('metric_key is required');
        const granularity = typeof input.granularity === 'string' ? GRANULARITY_UNIT[input.granularity] : undefined;
        const dimension = typeof input.dimension === 'string' && input.dimension ? input.dimension : undefined;

        const data = await callDataboxTool<MetricDataResponse>('load_metric_data', {
          data_source_id: Number(source.id),
          metric_key: input.metric_key,
          start_date: start,
          end_date: end,
          ...(dimension && { dimension }),
          ...(granularity && { granulation_time_unit: granularity, is_whole_range: false }),
        });
        return JSON.stringify(
          summarizeMetric(data, {
            source: `${source.type}: ${source.name}`,
            metric_key: input.metric_key,
            start_date: start,
            end_date: end,
            dimension,
            granularity: granularity ? String(input.granularity) : undefined,
          }, source.created_at)
        );
      }

      default:
        throw new Error(`Unknown marketing tool: ${name}`);
    }
  }
}

/**
 * An empty result from a just-connected source means Databox is still
 * backfilling, not that the connection is broken; say so, so the answer
 * doesn't tell the user to fix a working connection.
 */
function noDataNote(sourceCreatedAt?: string): string {
  const connected = sourceCreatedAt ? Date.parse(sourceCreatedAt) : NaN;
  if (!Number.isNaN(connected) && Date.now() - connected < SYNC_GRACE_MS) {
    return `No data yet. This source was connected in Databox on ${sourceCreatedAt!.slice(0, 10)} and is probably still importing its history; try again in a few hours. The connection itself is fine.`;
  }
  return 'No data for this metric and date range.';
}

function value(point: ChartPoint | undefined) {
  return point ? { value: point.y, formatted: point.metadata?.formattedValue ?? null } : null;
}

function changePercent(point: ChartPoint | undefined): number | null {
  const change = point?.metadata?.change;
  if (!change) return null;
  return change.changeType === 'decrease' ? -change.value : change.value;
}

/**
 * Cut Databox's chart payload down to what an answer needs: the range total
 * per dimension value (with the previous-period total and % change), or a
 * time series when a granularity was asked for.
 */
export function summarizeMetric(
  data: MetricDataResponse,
  request: { source: string; metric_key: string; start_date: string; end_date: string; dimension?: string; granularity?: string },
  sourceCreatedAt?: string
) {
  const series = data.chart?.visualizationData ?? [];
  const totals = series.filter((s) => s.seriesType === 'number');

  const rows = totals
    .map((s) => ({
      ...(request.dimension && { [request.dimension]: s.attributes?.dimension ?? '(none)' }),
      current: value(s.data[0]),
      previous_period: value(s.compares?.[0]),
      change_percent: changePercent(s.compares?.[0]),
    }))
    .sort((a, b) => (b.current?.value ?? 0) - (a.current?.value ?? 0));

  const result: Record<string, unknown> = {
    ...request,
    note: rows.length === 0 ? noDataNote(sourceCreatedAt) : undefined,
  };

  if (request.dimension) {
    result.rows = rows.slice(0, MAX_DIMENSION_ROWS);
    if (rows.length > MAX_DIMENSION_ROWS) result.rows_omitted = rows.length - MAX_DIMENSION_ROWS;
  } else {
    result.total = rows[0] ?? null;
  }

  if (request.granularity) {
    // One series per dimension value; keep the top few to stay compact.
    const primaries = series.filter((s) => s.seriesType === 'primary').slice(0, request.dimension ? 5 : 1);
    result.series = primaries.map((s) => ({
      ...(request.dimension && { [request.dimension]: s.attributes?.dimension ?? '(none)' }),
      points: s.data
        .filter((p) => p.y !== null)
        .map((p) => ({ period: p.metadata?.label, value: p.y, formatted: p.metadata?.formattedValue })),
    }));
  }

  return result;
}
