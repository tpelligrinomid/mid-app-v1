/**
 * Nightwatch REST client (https://apidocs.nightwatch.io).
 *
 * One agency API token (NIGHTWATCH_API_KEY) for the whole account; it never
 * leaves the server. Callers always pass a URL id resolved from the contract
 * (contract_integrations), never one chosen by a user or the model.
 *
 * Nightwatch sits behind Cloudflare, which rejects requests without a normal
 * User-Agent (error 1010). Never proxy /user: it returns the account's API
 * token and Google OAuth token.
 */

const NIGHTWATCH_API = 'https://api.nightwatch.io/api/v1';
const USER_AGENT = 'MiD-Platform/1.0 (+https://app.marketersindemand.com)';

export function nightwatchConfigured(): boolean {
  return !!process.env.NIGHTWATCH_API_KEY;
}

export async function nightwatchGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = process.env.NIGHTWATCH_API_KEY;
  if (!token) throw new Error('NIGHTWATCH_API_KEY is not configured');
  const query = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(`${NIGHTWATCH_API}${path}?${query}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    // The token is in the URL; never include the URL in errors or logs.
    throw new Error(`Nightwatch API ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

export interface NightwatchUrl {
  id: number;
  url: string;
  custom_name: string | null;
  keyword_count: number | null;
  country_code: string | null;
}

export interface NightwatchKeyword {
  id: number;
  query: string;
  position: number | null;
  position_organic: number | null;
  previous_position: number | null;
  best_position: number | null;
  historic_positions: Array<number | null> | null;
  last_historic_position_on: string | null;
  position_ai_overview_snippet: number | null;
  position_featured_snippet: number | null;
  position_local_pack: number | null;
  result_url: string | null;
  adwords_local_search_volume: number | null;
  adwords_global_search_volume: number | null;
  adwords_local_average_cpc: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  search_console_position: number | null;
  tags: Array<string | { name?: string }> | null;
  engine: string | null;
  mobile: boolean | null;
  google_gl: string | null;
  competitor_results?: unknown;
  created_at: string;
}

export interface NightwatchResult {
  created_at: string;
  position: number | null;
  position_organic: number | null;
  result_url_path: string | null;
}

export interface NightwatchCompetitor {
  id: number;
  url: string;
  display_name: string | null;
  custom_name: string | null;
}

export const listUrls = () => nightwatchGet<NightwatchUrl[]>('/urls');
export const listKeywords = (urlId: string) => nightwatchGet<NightwatchKeyword[]>(`/urls/${encodeURIComponent(urlId)}/keywords`);
export const listCompetitors = (urlId: string) =>
  nightwatchGet<NightwatchCompetitor[]>(`/urls/${encodeURIComponent(urlId)}/competitors`);
export const keywordResults = (urlId: string, keywordId: number, from: string, to: string) =>
  nightwatchGet<NightwatchResult[]>(
    `/urls/${encodeURIComponent(urlId)}/keywords/${keywordId}/results`,
    { time_start: from, time_end: to }
  );
