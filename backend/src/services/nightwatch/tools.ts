/**
 * Nightwatch SEO tools for Compass chat and the MiD MCP.
 *
 * Each runner is bound to one Nightwatch URL id resolved server-side from the
 * contract (contract_integrations, provider 'nightwatch'). The model never
 * sees or chooses the URL id. Read-only.
 *
 * "position" in Nightwatch is the best rank across all result types (organic,
 * local pack, AI Overview, featured snippet…); "organic position" is organic
 * results only. They can differ a lot (e.g. 3 vs 33), so results always show
 * both. Movement is computed from actual positions (earlier minus later, so a
 * positive change means the keyword moved up), not from Nightwatch's change
 * fields, whose sign isn't documented.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  keywordResults,
  listCompetitors,
  listKeywords,
  type NightwatchKeyword,
} from './client.js';

const NOT_RANKING = 101; // Nightwatch searches 100 results deep

export const NIGHTWATCH_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_seo_rankings',
    description:
      "Current Google rankings for this client's tracked keywords (Nightwatch, checked daily). For each keyword: position (best across all result types, e.g. local pack, AI Overview, featured snippet), organic position, ranking URL, whether it appears in the AI Overview or a featured snippet, monthly search volume, and Search Console clicks/impressions when connected. Filter by text, tag or a maximum position.",
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Only keywords containing this text.' },
        tag: { type: 'string', description: 'Only keywords with this Nightwatch tag.' },
        max_position: { type: 'integer', minimum: 1, maximum: 100, description: 'Only keywords ranking at or above this position (e.g. 10 = page one).' },
        sort: { type: 'string', enum: ['position', 'volume', 'clicks'], description: 'Sort order (default position).' },
        limit: { type: 'integer', minimum: 1, maximum: 300, description: 'Max keywords returned (default 50).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_seo_ranking_history',
    description:
      'Daily ranking history for up to 10 tracked keywords over a date range (Nightwatch keeps it for 3 years from when tracking started). Returns one point per day: position, organic position and ranking URL. Use for trends and "how has X moved since…" questions.',
    input_schema: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 10,
          description: 'Keyword texts as tracked (exact or a distinctive part of it).',
        },
        from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (default today).' },
      },
      required: ['keywords', 'from'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_seo_movers',
    description:
      'Biggest ranking gains and losses across all tracked keywords over the last N days, computed from actual daily positions. Also lists keywords that newly entered or dropped out of the top 100. Positive change = moved up.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', enum: [1, 7, 30], description: 'Look-back window in days (default 7).' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max gainers and losers each (default 10).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_seo_competitors',
    description: "Competitor domains tracked for this client's site in Nightwatch.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const NAMES = new Set(NIGHTWATCH_TOOLS.map((t) => t.name));
export function isNightwatchTool(name: string): boolean {
  return NAMES.has(name);
}

export function nightwatchGuidance(): string {
  return `## SEO rankings (Nightwatch)

This client's keyword rankings are tracked daily in Nightwatch. Use get_seo_rankings for current positions, get_seo_movers for what changed recently, get_seo_ranking_history for trends over a period, and get_seo_competitors for tracked competitors. "Position" is the best rank across all result types (local pack, AI Overview, featured snippets); "organic position" is the plain organic rank — say which one you mean, and don't present a local-pack or snippet rank as an organic ranking. Rank history only exists from when tracking started. Use the SEO research tools (keyword volumes, SERP snapshots) for keywords that aren't tracked.`;
}

function tagNames(tags: NightwatchKeyword['tags']): string[] {
  return (tags ?? []).map((t) => (typeof t === 'string' ? t : t?.name ?? '')).filter(Boolean);
}

/** Recent daily positions, oldest first (order detected from the current position). */
function seriesOldestFirst(k: NightwatchKeyword): Array<number | null> {
  const series = k.historic_positions ?? [];
  if (series.length < 2) return series;
  if (series[series.length - 1] === k.position) return series;
  if (series[0] === k.position) return [...series].reverse();
  return series;
}

function summarizeKeyword(k: NightwatchKeyword) {
  return {
    keyword: k.query,
    position: k.position,
    organic_position: k.position_organic,
    ranking_url: k.result_url,
    ...(k.position_ai_overview_snippet != null && { ai_overview_position: k.position_ai_overview_snippet }),
    ...(k.position_featured_snippet != null && { featured_snippet_position: k.position_featured_snippet }),
    ...(k.position_local_pack != null && { local_pack_position: k.position_local_pack }),
    best_position: k.best_position,
    search_volume: k.adwords_local_search_volume ?? k.adwords_global_search_volume,
    ...(k.clicks != null && { gsc_clicks: k.clicks, gsc_impressions: k.impressions, gsc_ctr: k.ctr }),
    tags: tagNames(k.tags),
    ...(k.mobile && { device: 'mobile' }),
    tracked_since: k.created_at?.slice(0, 10),
  };
}

export class NightwatchToolRunner {
  constructor(private readonly urlId: string) {}

  async describe(name: string, input: Record<string, unknown>): Promise<string> {
    if (name === 'get_seo_ranking_history') return 'Loading keyword ranking history';
    if (name === 'get_seo_movers') return `Finding ranking changes over ${input.days ?? 7} days`;
    if (name === 'get_seo_competitors') return 'Loading tracked competitors';
    return 'Loading keyword rankings';
  }

  async run(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'get_seo_rankings':
        return JSON.stringify(await this.rankings(input));
      case 'get_seo_ranking_history':
        return JSON.stringify(await this.history(input));
      case 'get_seo_movers':
        return JSON.stringify(await this.movers(input));
      case 'get_seo_competitors':
        return JSON.stringify(await this.competitors());
      default:
        throw new Error(`Unknown Nightwatch tool: ${name}`);
    }
  }

  private async rankings(input: Record<string, unknown>) {
    const search = typeof input.search === 'string' ? input.search.toLowerCase() : '';
    const tag = typeof input.tag === 'string' ? input.tag.toLowerCase() : '';
    const maxPosition = typeof input.max_position === 'number' ? input.max_position : null;
    const sort = (input.sort as string) || 'position';
    const limit = Math.min(Number(input.limit) || 50, 300);

    const all = await listKeywords(this.urlId);
    let rows = all.filter(
      (k) =>
        (!search || k.query.toLowerCase().includes(search)) &&
        (!tag || tagNames(k.tags).some((t) => t.toLowerCase() === tag)) &&
        (maxPosition == null || (k.position != null && k.position <= maxPosition))
    );
    rows.sort((a, b) => {
      if (sort === 'volume') return (b.adwords_local_search_volume ?? 0) - (a.adwords_local_search_volume ?? 0);
      if (sort === 'clicks') return (b.clicks ?? 0) - (a.clicks ?? 0);
      return (a.position ?? NOT_RANKING) - (b.position ?? NOT_RANKING);
    });
    const ranking = all.filter((k) => k.position != null);
    rows = rows.slice(0, limit);
    return {
      tracked_keywords: all.length,
      ranking_in_top_100: ranking.length,
      in_top_3: ranking.filter((k) => k.position! <= 3).length,
      in_top_10: ranking.filter((k) => k.position! <= 10).length,
      in_top_10_organic: all.filter((k) => k.position_organic != null && k.position_organic <= 10).length,
      returned: rows.length,
      keywords: rows.map(summarizeKeyword),
    };
  }

  private async history(input: Record<string, unknown>) {
    const wanted = (Array.isArray(input.keywords) ? input.keywords : []).map(String).slice(0, 10);
    const from = String(input.from || '').slice(0, 10);
    const to = String(input.to || new Date().toISOString()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('from must be YYYY-MM-DD');

    const all = await listKeywords(this.urlId);
    const matches = wanted.map((w) => {
      const needle = w.toLowerCase();
      return all.find((k) => k.query.toLowerCase() === needle) ?? all.find((k) => k.query.toLowerCase().includes(needle));
    });

    const series = await Promise.all(
      matches.map(async (k, i) => {
        if (!k) return { requested: wanted[i], error: 'Not a tracked keyword for this client' };
        const results = await keywordResults(this.urlId, k.id, from, to);
        // One point per day (latest check that day), oldest first.
        const byDay = new Map<string, (typeof results)[number]>();
        for (const r of results) byDay.set(r.created_at.slice(0, 10), r);
        const points = Array.from(byDay.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, r]) => ({ date, position: r.position, organic_position: r.position_organic, url: r.result_url_path }));
        return { keyword: k.query, tracked_since: k.created_at.slice(0, 10), points };
      })
    );
    return { from, to, keywords: series };
  }

  private async movers(input: Record<string, unknown>) {
    const days = [1, 7, 30].includes(Number(input.days)) ? Number(input.days) : 7;
    const limit = Math.min(Number(input.limit) || 10, 50);
    const all = await listKeywords(this.urlId);

    let available = 0;
    const changes = all
      .map((k) => {
        const s = seriesOldestFirst(k);
        available = Math.max(available, s.length - 1);
        if (s.length <= days) return null;
        const before = s[s.length - 1 - days];
        const now = s[s.length - 1];
        return {
          keyword: k.query,
          before: before ?? 'not in top 100',
          now: now ?? 'not in top 100',
          change: (before ?? NOT_RANKING) - (now ?? NOT_RANKING),
          entered: before == null && now != null,
          dropped: before != null && now == null,
          organic_position: k.position_organic,
          search_volume: k.adwords_local_search_volume,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (changes.length === 0) {
      return {
        days,
        note: `Not enough history yet: tracking has ${available} day(s) of history; ${days} needed. History builds up daily from when tracking started.`,
      };
    }
    const moved = changes.filter((c) => !c.entered && !c.dropped && c.change !== 0);
    return {
      days,
      keywords_compared: changes.length,
      gainers: moved.filter((c) => c.change > 0).sort((a, b) => b.change - a.change).slice(0, limit),
      losers: moved.filter((c) => c.change < 0).sort((a, b) => a.change - b.change).slice(0, limit),
      entered_top_100: changes.filter((c) => c.entered).slice(0, limit),
      dropped_out_of_top_100: changes.filter((c) => c.dropped).slice(0, limit),
      unchanged: changes.filter((c) => c.change === 0).length,
    };
  }

  private async competitors() {
    const competitors = await listCompetitors(this.urlId);
    return {
      competitors: competitors.map((c) => ({ domain: c.display_name || c.url, name: c.custom_name })),
    };
  }
}
