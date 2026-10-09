/**
 * SEO research tools for Compass chat
 *
 * Keyword rankings, keyword gaps, competitor domains, keyword metrics and
 * backlinks from DataForSEO, through Master Marketer's quick /api/v1/seo/*
 * endpoints (one DataForSEO call each, answered in seconds). Read-only and
 * not tied to the contract: they work on any public domain.
 *
 * Each call costs a few cents, so one answer gets at most MAX_SEO_CALLS.
 */

import type Anthropic from '@anthropic-ai/sdk';

const MAX_SEO_CALLS = 8;
const REQUEST_TIMEOUT_MS = 30_000;

const DOMAIN_PROP = { type: 'string', description: 'Bare domain, for example "newnorth.com".' } as const;

export const SEO_TOOLS: Anthropic.Tool[] = [
  {
    name: 'seo_ranked_keywords',
    description:
      "Keywords a domain ranks for in Google (US), sorted by estimated traffic, with position, ranking URL, monthly search volume, keyword difficulty (0-100), CPC and search intent. Also returns the domain's total ranking keywords and estimated monthly organic traffic. Works for the client's site or any competitor.",
    input_schema: {
      type: 'object',
      properties: {
        domain: DOMAIN_PROP,
        max_position: { type: 'integer', description: 'Only keywords ranking at or above this position (default 20).' },
        min_search_volume: { type: 'integer', description: 'Minimum monthly searches (default 10).' },
        limit: { type: 'integer', description: 'Rows to return, up to 100 (default 50).' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
  },
  {
    name: 'seo_keyword_gap',
    description:
      "Keywords a competitor ranks for in Google (US) where the client's domain doesn't rank at all, sorted by the competitor's estimated traffic from each, with the competitor's position and ranking URL, volume, difficulty and intent. The best source for content ideas based on a competitor.",
    input_schema: {
      type: 'object',
      properties: {
        domain: { ...DOMAIN_PROP, description: "The client's own domain." },
        competitor_domain: { ...DOMAIN_PROP, description: "The competitor's domain." },
        max_competitor_position: { type: 'integer', description: 'Only keywords where the competitor ranks at or above this position (default 20).' },
        min_search_volume: { type: 'integer', description: 'Minimum monthly searches (default 10).' },
        limit: { type: 'integer', description: 'Rows to return, up to 100 (default 50).' },
      },
      required: ['domain', 'competitor_domain'],
      additionalProperties: false,
    },
  },
  {
    name: 'seo_competitor_domains',
    description:
      "Domains that compete with a domain in Google (US) organic search, by number of shared ranking keywords, with each one's average position and total ranking keywords. Use it when the user doesn't name competitors.",
    input_schema: { type: 'object', properties: { domain: DOMAIN_PROP }, required: ['domain'], additionalProperties: false },
  },
  {
    name: 'seo_keyword_data',
    description:
      'Monthly Google (US) search volume, keyword difficulty (0-100), CPC and search intent for up to 50 keywords. Use it to check any keyword before recommending it.',
    input_schema: {
      type: 'object',
      properties: { keywords: { type: 'array', items: { type: 'string' }, description: 'Up to 50 keywords.' } },
      required: ['keywords'],
      additionalProperties: false,
    },
  },
  {
    name: 'seo_related_keywords',
    description:
      'Keywords related to a seed keyword (from Google\'s "searches related to"), with volume, difficulty and intent, sorted by volume. Use it to expand a topic or find variations of a pattern.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Seed keyword.' },
        limit: { type: 'integer', description: 'Rows to return, up to 100 (default 30).' },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
  },
  {
    name: 'seo_backlink_summary',
    description:
      "A domain's backlink profile: total backlinks, referring domains, dofollow vs nofollow, domain rank and spam score. Use it to compare a site's authority with competitors'.",
    input_schema: { type: 'object', properties: { domain: DOMAIN_PROP }, required: ['domain'], additionalProperties: false },
  },
];

const ENDPOINTS: Record<string, string> = {
  seo_ranked_keywords: 'ranked-keywords',
  seo_keyword_gap: 'keyword-gap',
  seo_competitor_domains: 'competitor-domains',
  seo_keyword_data: 'keyword-data',
  seo_related_keywords: 'related-keywords',
  seo_backlink_summary: 'backlink-summary',
};

export function isSeoTool(name: string): boolean {
  return name in ENDPOINTS;
}

/** SEO tools are offered only when Master Marketer is configured. */
export function seoToolsAvailable(): boolean {
  return Boolean(process.env.MASTER_MARKETER_URL && process.env.MASTER_MARKETER_API_KEY);
}

/** Runs SEO tools for one answer, enforcing the per-answer call cap. */
export class SeoToolRunner {
  private calls = 0;

  describe(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case 'seo_ranked_keywords':
        return `Pulling keywords ${input.domain} ranks for`;
      case 'seo_keyword_gap':
        return `Finding keywords ${input.competitor_domain} ranks for and ${input.domain} doesn't`;
      case 'seo_competitor_domains':
        return `Finding search competitors for ${input.domain}`;
      case 'seo_keyword_data': {
        const count = Array.isArray(input.keywords) ? input.keywords.length : 0;
        return `Checking search volume for ${count} keyword${count === 1 ? '' : 's'}`;
      }
      case 'seo_related_keywords':
        return `Finding keywords related to "${input.keyword}"`;
      case 'seo_backlink_summary':
        return `Checking backlinks for ${input.domain}`;
      default:
        return 'Running SEO research';
    }
  }

  async run(name: string, input: Record<string, unknown>): Promise<string> {
    const endpoint = ENDPOINTS[name];
    if (!endpoint) throw new Error(`Unknown SEO tool: ${name}`);
    if (this.calls >= MAX_SEO_CALLS) {
      throw new Error(`SEO research limit reached for this answer (${MAX_SEO_CALLS} calls). Answer with the data you have.`);
    }
    this.calls++;

    const baseUrl = process.env.MASTER_MARKETER_URL!.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/api/v1/seo/${endpoint}`, {
      method: 'POST',
      headers: { 'x-api-key': process.env.MASTER_MARKETER_API_KEY!, 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 300);
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {
        // not JSON
      }
      throw new Error(`SEO lookup failed (${response.status}): ${message}`);
    }
    return text;
  }
}

export function seoGuidance(): string {
  return `## SEO research data

You can look up Google search data (US) with the seo_* tools: what any domain ranks for (seo_ranked_keywords), keywords a competitor ranks for that the client doesn't (seo_keyword_gap), search competitors (seo_competitor_domains), volume and difficulty for specific keywords (seo_keyword_data), related keywords (seo_related_keywords) and backlinks (seo_backlink_summary). Use them whenever a question involves keywords, rankings, search volume, competitors' SEO or content ideas, and never state a search volume, difficulty or ranking you didn't get from them. They cost money per call, so plan the few calls you need (at most ${MAX_SEO_CALLS} per answer).

The client's own domain: take it from the documents or the conversation; if you can't tell, ask instead of guessing.

When suggesting content from keyword data:
- Prefer keywords with commercial or transactional intent (someone looking to buy or choose a provider) over informational ones, unless the user asks otherwise, and say which intent each has.
- Group keywords that one page would target together, and look for repeatable patterns (for example "[competitor] alternative", "[service] for [industry]", "X vs Y") rather than one-off topics.
- Weigh volume against difficulty and say why each idea is worth it. Note anything the client's documents (content plan, SEO audit) already cover.
- Volumes and traffic are DataForSEO estimates for the US; say so once.
- These are third-party estimates. For the client's actual clicks and rankings, use Google Search Console in the marketing data tools when it's connected.`;
}
