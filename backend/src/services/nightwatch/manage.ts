/**
 * Nightwatch management tools (via the Nightwatch MCP): keywords, tags,
 * competitors, SERP detail, keyword and AI-prompt ideas.
 *
 * Bound to one Nightwatch URL id resolved server-side from the contract.
 * Changes are two-step: without confirm=true a tool only returns a preview of
 * what it would do; the model has to show it and get the user's OK first.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { listCompetitors, listKeywords, listUrls, type NightwatchKeyword } from './client.js';
import { callNightwatchMcp } from './mcp.js';

const confirmProp = {
  type: 'boolean',
  description: 'Leave unset first to get a preview; set true only after the user has confirmed that exact change.',
} as const;

export const NIGHTWATCH_MANAGE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'add_seo_keywords',
    description:
      'Start tracking new keywords for this client in Nightwatch (Google, daily). Two-step: call without confirm to preview, show the preview to the user, then call again with confirm=true once they agree. Uses keyword quota.',
    input_schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, description: 'Keyword phrases to track.' },
        device: { type: 'string', enum: ['desktop', 'mobile', 'both'], description: 'Default desktop. "both" tracks each keyword twice.' },
        location: { type: 'string', description: 'Optional city/region for local tracking, e.g. "Chicago, Illinois".' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply, e.g. ["services", "branded"].' },
        confirm: confirmProp,
      },
      required: ['keywords'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_seo_keywords',
    description:
      "Stop tracking keywords for this client (their ranking history in Nightwatch is removed too). Exact tracked keyword texts only. Two-step: preview first, confirm=true only after the user agrees.",
    input_schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, description: 'Exact tracked keyword texts.' },
        confirm: confirmProp,
      },
      required: ['keywords'],
      additionalProperties: false,
    },
  },
  {
    name: 'tag_seo_keywords',
    description: 'Add tags to tracked keywords (existing tags are kept). Two-step: preview first, confirm=true after the user agrees.',
    input_schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100, description: 'Exact tracked keyword texts.' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Tags to add.' },
        confirm: confirmProp,
      },
      required: ['keywords', 'tags'],
      additionalProperties: false,
    },
  },
  {
    name: 'manage_seo_competitor',
    description: "Add or remove a competitor domain tracked against this client's keywords. Two-step: preview first, confirm=true after the user agrees.",
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove'] },
        domain: { type: 'string', description: 'Competitor domain, e.g. "ironpaper.com".' },
        confirm: confirmProp,
      },
      required: ['action', 'domain'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_seo_serp',
    description:
      'The latest full Google results page for one tracked keyword: who ranks above and below the client, local pack, AI Overview and other SERP features. Use to explain why a keyword ranks where it does.',
    input_schema: {
      type: 'object',
      properties: { keyword: { type: 'string', description: 'Tracked keyword text.' } },
      required: ['keyword'],
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_seo_keywords',
    description: "Keyword ideas for this client's site from Nightwatch (topic-based suggestions). Read-only; use before add_seo_keywords.",
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max ideas (default 20).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_ai_prompts',
    description:
      'AI search prompt suggestions (questions people ask ChatGPT, Perplexity etc.) for a topic, to decide which prompts to track for AI visibility. Read-only.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'Topic, e.g. "B2B marketing agency for SaaS".' } },
      required: ['topic'],
      additionalProperties: false,
    },
  },
];

const NAMES = new Set(NIGHTWATCH_MANAGE_TOOLS.map((t) => t.name));
export function isNightwatchManageTool(name: string): boolean {
  return NAMES.has(name);
}

export function nightwatchManageGuidance(): string {
  return `You can also manage this client's Nightwatch tracking: add_seo_keywords, remove_seo_keywords, tag_seo_keywords, manage_seo_competitor. These change the tracking setup, so ALWAYS call them first without confirm, show the user exactly what will change, and only call again with confirm=true after the user explicitly agrees in their reply. Never confirm on the user's behalf. suggest_seo_keywords, suggest_ai_prompts and get_seo_serp are read-only.`;
}

function preview(action: string, details: Record<string, unknown>) {
  return {
    status: 'preview',
    action,
    ...details,
    note: 'Nothing has changed yet. Show this to the user and ask them to confirm; call again with confirm=true only after they agree.',
  };
}

const cleanList = (v: unknown) =>
  Array.from(new Set((Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean)));

const bareDomain = (d: string) =>
  d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

function tagNames(tags: NightwatchKeyword['tags']): string[] {
  return (tags ?? []).map((t) => (typeof t === 'string' ? t : t?.name ?? '')).filter(Boolean);
}

const MAX_SERP_CHARS = 20000;

export class NightwatchManager {
  constructor(private readonly urlId: string) {}

  describe(name: string, input: Record<string, unknown>): string {
    const applying = input.confirm === true;
    switch (name) {
      case 'add_seo_keywords':
        return applying ? 'Adding keywords in Nightwatch' : 'Preparing keyword changes';
      case 'remove_seo_keywords':
        return applying ? 'Removing keywords in Nightwatch' : 'Preparing keyword changes';
      case 'tag_seo_keywords':
        return applying ? 'Tagging keywords in Nightwatch' : 'Preparing tag changes';
      case 'manage_seo_competitor':
        return applying ? 'Updating competitors in Nightwatch' : 'Preparing competitor change';
      case 'get_seo_serp':
        return `Loading the results page for "${input.keyword}"`;
      case 'suggest_ai_prompts':
        return 'Generating AI prompt ideas';
      default:
        return 'Generating keyword ideas';
    }
  }

  private async site() {
    return (await listUrls()).find((u) => String(u.id) === this.urlId);
  }

  async run(name: string, input: Record<string, unknown>): Promise<string> {
    const urlNum = Number(this.urlId);
    const confirm = input.confirm === true;

    switch (name) {
      case 'add_seo_keywords': {
        const keywords = cleanList(input.keywords).slice(0, 100);
        const existing = new Set((await listKeywords(this.urlId)).map((k) => k.query.toLowerCase()));
        const fresh = keywords.filter((k) => !existing.has(k.toLowerCase()));
        const device = ['desktop', 'mobile', 'both'].includes(String(input.device)) ? String(input.device) : 'desktop';
        const site = await this.site();
        const country = site?.country_code ?? 'us';
        const tags = cleanList(input.tags);
        const location = typeof input.location === 'string' && input.location.trim() ? input.location.trim() : null;
        const settings = {
          device,
          country,
          location,
          tags,
          already_tracked: keywords.filter((k) => existing.has(k.toLowerCase())),
          keyword_quota_used: fresh.length * (device === 'both' ? 2 : 1),
        };
        if (fresh.length === 0) return JSON.stringify({ status: 'nothing_to_do', ...settings });
        if (!confirm) return JSON.stringify(preview('add keywords', { keywords: fresh, ...settings }));
        await callNightwatchMcp('add_keywords', {
          url_id: urlNum,
          keywords: fresh,
          google_gl: country,
          google_hl: 'en',
          search_engine: 'google',
          desktop: device !== 'mobile',
          mobile: device !== 'desktop',
          ...(tags.length && { tags }),
          ...(location && { adwords_location_id: location }),
        });
        return JSON.stringify({
          status: 'done',
          added: fresh,
          ...settings,
          note: 'First rankings appear once Nightwatch checks them (usually within minutes to a day).',
        });
      }

      case 'remove_seo_keywords': {
        const wanted = cleanList(input.keywords).map((k) => k.toLowerCase());
        const all = await listKeywords(this.urlId);
        const matches = all.filter((k) => wanted.includes(k.query.toLowerCase()));
        const notTracked = wanted.filter((w) => !all.some((k) => k.query.toLowerCase() === w));
        if (matches.length === 0) return JSON.stringify({ status: 'nothing_to_do', not_tracked: notTracked });
        const details = {
          keywords: matches.map((k) => ({ keyword: k.query, position: k.position, device: k.mobile ? 'mobile' : 'desktop' })),
          not_tracked: notTracked,
          warning: 'Ranking history for these keywords is deleted in Nightwatch.',
        };
        if (!confirm) return JSON.stringify(preview('remove keywords', details));
        await callNightwatchMcp('remove_keywords', { url_id: urlNum, keyword_ids: matches.map((k) => k.id) });
        return JSON.stringify({ status: 'done', removed: matches.map((k) => k.query), not_tracked: notTracked });
      }

      case 'tag_seo_keywords': {
        const wanted = cleanList(input.keywords).map((k) => k.toLowerCase());
        const tags = cleanList(input.tags);
        const matches = (await listKeywords(this.urlId)).filter((k) => wanted.includes(k.query.toLowerCase()));
        if (matches.length === 0) return JSON.stringify({ status: 'nothing_to_do', not_tracked: wanted });
        const plan = matches.map((k) => ({ keyword: k.query, id: k.id, tags: Array.from(new Set([...tagNames(k.tags), ...tags])) }));
        if (!confirm) {
          return JSON.stringify(preview('tag keywords', { keywords: plan.map(({ keyword, tags: t }) => ({ keyword, tags: t })) }));
        }
        for (const p of plan) await callNightwatchMcp('update_keyword', { url_id: urlNum, keyword_id: p.id, tags: p.tags });
        return JSON.stringify({ status: 'done', tagged: plan.map((p) => p.keyword), tags });
      }

      case 'manage_seo_competitor': {
        const action = input.action === 'remove' ? 'remove' : 'add';
        const domain = bareDomain(String(input.domain ?? ''));
        if (!domain.includes('.')) throw new Error('domain must be a site domain like "example.com"');
        const competitors = await listCompetitors(this.urlId);
        const match = competitors.find((c) => bareDomain(c.display_name || c.url) === domain);
        if (action === 'add' && match) return JSON.stringify({ status: 'nothing_to_do', note: `${domain} is already tracked.` });
        if (action === 'remove' && !match) return JSON.stringify({ status: 'nothing_to_do', note: `${domain} isn't a tracked competitor.` });
        if (!confirm) return JSON.stringify(preview(`${action} competitor`, { domain }));
        if (action === 'add') await callNightwatchMcp('add_competitor', { url_id: urlNum, url: `https://${domain}` });
        else await callNightwatchMcp('remove_competitor', { url_id: urlNum, competitor_id: match!.id });
        return JSON.stringify({ status: 'done', action, domain });
      }

      case 'get_seo_serp': {
        const needle = String(input.keyword ?? '').toLowerCase();
        const all = await listKeywords(this.urlId);
        const k = all.find((x) => x.query.toLowerCase() === needle) ?? all.find((x) => x.query.toLowerCase().includes(needle));
        const resultId = (k as (NightwatchKeyword & { last_result_id?: number }) | undefined)?.last_result_id;
        if (!k || !resultId) return JSON.stringify({ error: 'Not a tracked keyword, or no results checked yet.' });
        const serp = JSON.stringify(await callNightwatchMcp('get_serp_data', { result_id: resultId }));
        return JSON.stringify({
          keyword: k.query,
          position: k.position,
          organic_position: k.position_organic,
          serp: serp.length > MAX_SERP_CHARS ? `${serp.slice(0, MAX_SERP_CHARS)}…(truncated)` : JSON.parse(serp),
        });
      }

      case 'suggest_seo_keywords': {
        const site = await this.site();
        if (!site) throw new Error('Nightwatch site not found');
        const ideas = await callNightwatchMcp('keyword_generate_ideas', {
          seedUrl: site.url,
          language: 'en',
          countryCode: site.country_code ?? 'us',
          limit: Math.min(Number(input.limit) || 20, 50),
        });
        return JSON.stringify({ seed: site.url, ideas });
      }

      case 'suggest_ai_prompts': {
        const site = await this.site();
        const prompts = await callNightwatchMcp('prompt_generate', {
          topic: String(input.topic ?? ''),
          countryCode: site?.country_code ?? 'us',
        });
        return JSON.stringify({ topic: input.topic, prompts });
      }

      default:
        throw new Error(`Unknown Nightwatch tool: ${name}`);
    }
  }
}
