/**
 * Search Visibility — query normalization
 *
 * `query_normalized` is the join key between three sources that never agree on
 * spelling: a strategist typing a target keyword, Google Search Console
 * reporting what users actually searched, and DataForSEO echoing back what it
 * was asked. One function, used everywhere, or the join silently misses.
 *
 * Deliberately conservative. It does NOT stem, singularize, or reorder words —
 * "loyalty program" and "loyalty programs" stay distinct, because collapsing
 * them would merge two keywords a strategist chose to track separately and
 * there would be no way to tell afterwards that it happened.
 *
 * Spec: docs/spec-search-visibility-tracking.md §3
 */

/**
 * Normalize a keyword or prompt for matching.
 *
 * - lowercase
 * - strip diacritics (café -> cafe)
 * - collapse all whitespace runs to a single space
 * - strip punctuation that users add inconsistently, keeping intra-word
 *   hyphens and apostrophes ("t-shirt", "men's" stay intact)
 * - trim
 */
export function normalizeQuery(raw: string): string {
  if (!raw) return '';

  return raw
    .normalize('NFD')
    // Combining diacritical marks
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Curly quotes and dashes to their ASCII equivalents before stripping
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    // Drop punctuation except intra-word hyphen/apostrophe
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    // A hyphen or apostrophe not between two word characters is noise
    .replace(/(^|\s)['-]+/g, '$1')
    .replace(/['-]+(\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a pasted or uploaded list into distinct queries.
 *
 * Accepts an array, or a blob separated by newlines / commas / tabs — which is
 * what actually arrives when someone pastes a column out of a spreadsheet.
 * Deduplicates on the normalized form while preserving the first raw spelling
 * seen, so the strategist's own capitalization survives into the UI.
 */
export function parseQueryList(input: string[] | string): Array<{ text: string; normalized: string }> {
  const raw: string[] = Array.isArray(input)
    ? input
    : String(input).split(/[\r\n,\t]+/);

  const seen = new Map<string, string>();

  for (const entry of raw) {
    const text = String(entry ?? '').trim();
    if (!text) continue;

    const normalized = normalizeQuery(text);
    if (!normalized) continue;

    if (!seen.has(normalized)) {
      seen.set(normalized, text);
    }
  }

  return Array.from(seen.entries()).map(([normalized, text]) => ({ text, normalized }));
}

/**
 * Derive the GSC property type from its siteUrl.
 *
 * Domain properties cover every subdomain and both protocols; URL-prefix
 * properties cover exactly the given prefix. Picking the prefix form when a
 * domain property exists silently drops apex, other subdomains, and http —
 * the totals still look plausible, which is what makes it dangerous.
 */
export function gscPropertyType(siteUrl: string): 'domain' | 'url_prefix' {
  return siteUrl.startsWith('sc-domain:') ? 'domain' : 'url_prefix';
}

/**
 * The bare host a GSC property refers to, for comparing a URL-prefix property
 * against an available domain property for the same site.
 */
export function gscPropertyHost(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) {
    return siteUrl.slice('sc-domain:'.length).toLowerCase();
  }

  try {
    return new URL(siteUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return siteUrl.toLowerCase();
  }
}
