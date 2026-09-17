/**
 * Compass — Search Visibility routes
 *
 * Phase 1 surface: tracked query list management, per-contract tracking config,
 * and GSC property binding. Trends/reporting endpoints arrive in Phase 2, the
 * discovery triage queue in Phase 3.
 *
 * Spec: docs/spec-search-visibility-tracking.md §8
 */

import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { normalizeQuery, parseQueryList, gscPropertyType, gscPropertyHost } from '../../services/search-visibility/normalize.js';
import {
  listSites,
  verifyAccess,
  canReadAnalytics,
  getGscAccountEmail,
  isConfigured as gscConfigured,
} from '../../services/search-visibility/gsc-client.js';
import { runContract } from '../../services/search-visibility/collector.js';
import {
  validateTrackedQueryInput,
  validateTrackingConfigInput,
  isValidQueryType,
  type CreateTrackedQueryDTO,
  type UpdateTrackedQueryDTO,
  type BulkCreateTrackedQueriesDTO,
  type UpdateTrackingConfigDTO,
} from '../../types/search-visibility.js';

const router = Router();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Clients may only touch contracts granted to them. Staff see everything.
 * Mirrors the check used across the other Compass routes.
 */
async function assertContractAccess(req: Request, contractId: string): Promise<boolean> {
  if (!req.user || !req.supabase) return false;
  if (req.user.role !== 'client') return true;

  const { data } = await req.supabase
    .from('user_contract_access')
    .select('contract_id')
    .eq('user_id', req.user.user_id)
    .eq('contract_id', contractId)
    .maybeSingle();

  return !!data;
}

function requireContractId(req: Request, res: Response): string | null {
  const contractId = (req.query.contract_id ?? req.body?.contract_id) as string | undefined;
  if (!contractId || typeof contractId !== 'string') {
    res.status(400).json({ error: 'contract_id is required' });
    return null;
  }
  return contractId;
}

/** The config row, created on first touch so the UI never has to special-case its absence. */
async function ensureConfig(req: Request, contractId: string) {
  const { data: existing } = await req.supabase!
    .from('content_tracking_config')
    .select('*')
    .eq('contract_id', contractId)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await req.supabase!
    .from('content_tracking_config')
    .insert({ contract_id: contractId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return created;
}

// ============================================================================
// Tracked queries
// ============================================================================

/**
 * GET /api/compass/content/queries
 * Filters: contract_id (required), query_type, status, tag, search, limit, offset
 */
router.get('/queries', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const contractId = requireContractId(req, res);
  if (!contractId) return;

  if (!(await assertContractAccess(req, contractId))) {
    res.status(403).json({ error: 'Access denied to this contract' });
    return;
  }

  const { query_type, status, tag, search } = req.query;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const offset = Number(req.query.offset) || 0;

  let builder = req.supabase
    .from('content_tracked_queries')
    .select('*', { count: 'exact' })
    .eq('contract_id', contractId);

  if (typeof query_type === 'string') builder = builder.eq('query_type', query_type);
  if (typeof status === 'string') builder = builder.eq('status', status);
  else builder = builder.neq('status', 'archived');
  if (typeof tag === 'string') builder = builder.contains('tags', [tag]);
  if (typeof search === 'string' && search.trim()) {
    builder = builder.ilike('query_normalized', `%${normalizeQuery(search)}%`);
  }

  const { data, error, count } = await builder
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ queries: data ?? [], total: count ?? 0, limit, offset });
});

/**
 * POST /api/compass/content/queries
 */
router.post(
  '/queries',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const body = req.body as CreateTrackedQueryDTO;
    const contractId = requireContractId(req, res);
    if (!contractId) return;

    const validation = validateTrackedQueryInput(body, { requireText: true });
    if (!validation.valid) {
      res.status(400).json({ error: 'Validation failed', details: validation.errors });
      return;
    }

    const queryText = body.query_text.trim();
    const normalized = normalizeQuery(queryText);

    if (!normalized) {
      res.status(400).json({ error: 'query_text contains no matchable characters' });
      return;
    }

    const config = await ensureConfig(req, contractId);

    const { data, error } = await req.supabase
      .from('content_tracked_queries')
      .insert({
        contract_id: contractId,
        query_type: body.query_type ?? 'keyword',
        query_text: queryText,
        query_normalized: normalized,
        asset_id: body.asset_id ?? null,
        priority: body.priority ?? 'medium',
        source: body.source ?? 'manual',
        cadence: body.cadence ?? null,
        location_code: body.location_code ?? config.location_code,
        language_code: body.language_code ?? config.language_code,
        tags: body.tags ?? null,
        created_by: req.user.user_id,
        // Due immediately, so a newly added keyword gets its first data point on
        // the next nightly run rather than waiting out a full cadence period.
        next_run_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'This query is already tracked for this contract' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ query: data });
  }
);

/**
 * POST /api/compass/content/queries/bulk
 * CSV paste or array. Deduplicates within the payload and against existing rows.
 */
router.post(
  '/queries/bulk',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const body = req.body as BulkCreateTrackedQueriesDTO;
    const contractId = requireContractId(req, res);
    if (!contractId) return;

    if (!body.queries) {
      res.status(400).json({ error: 'queries is required (array or delimited string)' });
      return;
    }

    if (body.query_type !== undefined && !isValidQueryType(body.query_type)) {
      res.status(400).json({ error: 'query_type must be "keyword" or "prompt"' });
      return;
    }

    const parsed = parseQueryList(body.queries);
    if (parsed.length === 0) {
      res.status(400).json({ error: 'No usable queries found in payload' });
      return;
    }

    if (parsed.length > 5000) {
      res.status(400).json({ error: 'Bulk import is limited to 5,000 queries per request' });
      return;
    }

    const queryType = body.query_type ?? 'keyword';
    const config = await ensureConfig(req, contractId);

    // Skip what's already tracked rather than relying on the unique index to
    // reject the whole insert — a paste with one duplicate should still import.
    const { data: existing } = await req.supabase
      .from('content_tracked_queries')
      .select('query_normalized')
      .eq('contract_id', contractId)
      .eq('query_type', queryType);

    const known = new Set((existing ?? []).map((r: { query_normalized: string }) => r.query_normalized));
    const fresh = parsed.filter((p) => !known.has(p.normalized));

    if (fresh.length === 0) {
      res.json({ created: 0, skipped: parsed.length, queries: [] });
      return;
    }

    const now = new Date().toISOString();
    const createdBy = req.user.user_id;
    const rows = fresh.map((p) => ({
      contract_id: contractId,
      query_type: queryType,
      query_text: p.text,
      query_normalized: p.normalized,
      priority: body.priority ?? 'medium',
      source: body.source ?? 'manual',
      cadence: body.cadence ?? null,
      location_code: config.location_code,
      language_code: config.language_code,
      tags: body.tags ?? null,
      created_by: createdBy,
      next_run_at: now,
    }));

    const { data, error } = await req.supabase
      .from('content_tracked_queries')
      .insert(rows)
      .select();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({
      created: data?.length ?? 0,
      skipped: parsed.length - fresh.length,
      queries: data ?? [],
    });
  }
);

/**
 * PUT /api/compass/content/queries/:id
 */
router.put(
  '/queries/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const body = req.body as UpdateTrackedQueryDTO;
    const validation = validateTrackedQueryInput(body, { requireText: false });
    if (!validation.valid) {
      res.status(400).json({ error: 'Validation failed', details: validation.errors });
      return;
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.query_text !== undefined) {
      const text = body.query_text.trim();
      patch.query_text = text;
      patch.query_normalized = normalizeQuery(text);
    }
    for (const field of ['asset_id', 'priority', 'status', 'cadence', 'location_code', 'language_code', 'tags'] as const) {
      if (body[field] !== undefined) patch[field] = body[field];
    }

    const { data, error } = await req.supabase
      .from('content_tracked_queries')
      .update(patch)
      .eq('query_id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Query not found' });
      return;
    }

    res.json({ query: data });
  }
);

/**
 * DELETE /api/compass/content/queries/:id
 *
 * Archives by default — deleting drops the snapshot history with it, and that
 * history cannot be re-collected. `?hard=true` really deletes.
 */
router.delete(
  '/queries/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (req.query.hard === 'true') {
      const { error } = await req.supabase
        .from('content_tracked_queries')
        .delete()
        .eq('query_id', req.params.id);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.json({ deleted: true, history_removed: true });
      return;
    }

    const { data, error } = await req.supabase
      .from('content_tracked_queries')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('query_id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Query not found' });
      return;
    }

    res.json({ archived: true, query: data });
  }
);

// ============================================================================
// Tracking config
// ============================================================================

/**
 * GET /api/compass/content/tracking-config?contract_id=...
 */
router.get('/tracking-config', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const contractId = requireContractId(req, res);
  if (!contractId) return;

  if (!(await assertContractAccess(req, contractId))) {
    res.status(403).json({ error: 'Access denied to this contract' });
    return;
  }

  try {
    const config = await ensureConfig(req, contractId);
    res.json({
      config,
      // The address the client has to add on their side. Surfaced here so the
      // settings panel can show it with a copy button.
      gsc_account_email: gscConfigured() ? getGscAccountEmail() : null,
      gsc_configured: gscConfigured(),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load config' });
  }
});

/**
 * PUT /api/compass/content/tracking-config
 */
router.put(
  '/tracking-config',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const body = req.body as UpdateTrackingConfigDTO;
    const contractId = requireContractId(req, res);
    if (!contractId) return;

    const validation = validateTrackingConfigInput(body);
    if (!validation.valid) {
      res.status(400).json({ error: 'Validation failed', details: validation.errors });
      return;
    }

    await ensureConfig(req, contractId);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const field of [
      'domain',
      'competitor_domains',
      'brand_terms',
      'keyword_cadence',
      'prompt_cadence',
      'prompt_samples_per_run',
      'prompt_engines',
      'location_code',
      'language_code',
      'enabled',
    ] as const) {
      if (body[field] !== undefined) patch[field] = body[field];
    }

    const { data, error } = await req.supabase
      .from('content_tracking_config')
      .update(patch)
      .eq('contract_id', contractId)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ config: data });
  }
);

// ============================================================================
// GSC property binding
// ============================================================================

/**
 * GET /api/compass/content/tracking-config/gsc/properties
 *
 * Every property the shared MiD account can see. This is the picker AND the
 * access check: a contract's property is chosen from here, never typed, because
 * a wrong property returns a thin dataset that reads as poor SEO performance
 * rather than as a misconfiguration.
 */
router.get(
  '/tracking-config/gsc/properties',
  requireRole('admin', 'team_member'),
  async (_req: Request, res: Response): Promise<void> => {
    if (!gscConfigured()) {
      res.status(503).json({
        error: 'Google Search Console is not configured',
        details: 'Set GSC_SERVICE_ACCOUNT_JSON on the backend.',
      });
      return;
    }

    try {
      const sites = await listSites();

      const properties = sites.map((site) => ({
        site_url: site.siteUrl,
        permission_level: site.permissionLevel,
        property_type: gscPropertyType(site.siteUrl),
        host: gscPropertyHost(site.siteUrl),
        usable: canReadAnalytics(site.permissionLevel),
      }));

      res.json({
        gsc_account_email: getGscAccountEmail(),
        properties,
      });
    } catch (error) {
      res.status(502).json({
        error: 'Failed to list Search Console properties',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /api/compass/content/tracking-config/gsc/bind
 * Body: { contract_id, site_url }
 *
 * Verifies with a real one-row read before storing — a property can appear in
 * sites.list and still fail to serve analytics, so listing is not proof.
 */
router.post(
  '/tracking-config/gsc/bind',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const contractId = requireContractId(req, res);
    if (!contractId) return;

    const siteUrl = req.body?.site_url as string | undefined;
    if (!siteUrl) {
      res.status(400).json({ error: 'site_url is required' });
      return;
    }

    try {
      const sites = await listSites();
      const match = sites.find((s) => s.siteUrl === siteUrl);

      if (!match) {
        res.status(404).json({
          error: 'Property not visible to the MiD account',
          // Distinct from the unverified case below: here there is no grant at
          // all, so the fix is on the client's side.
          remediation: 'client_grant',
          details:
            'The client has not added the MiD account to this property yet, or it was removed. ' +
            'Ask them to add it under Settings → Users and permissions, at Restricted.',
          gsc_account_email: getGscAccountEmail(),
        });
        return;
      }

      if (!canReadAnalytics(match.permissionLevel)) {
        // siteUnverifiedUser is an OWNERSHIP verification lapse on a property we
        // hold directly — usually a site rebuild dropped the verification HTML
        // file. Nothing for the client to do; we re-verify. Telling a strategist
        // to chase a client here would send them somewhere with no fix.
        res.status(403).json({
          error: 'Property ownership is unverified',
          remediation: 'reverify_ownership',
          details:
            `Permission level is ${match.permissionLevel}. This property needs ownership re-verified in ` +
            'Search Console by MiD, not a new grant from the client. Prefer the DNS method (or a ' +
            'domain property) over the HTML file, which the next site deploy will remove again.',
        });
        return;
      }

      const verified = await verifyAccess(siteUrl);
      if (!verified.ok) {
        res.status(502).json({ error: 'Verification read failed', details: verified.message });
        return;
      }

      const propertyType = gscPropertyType(siteUrl);
      const host = gscPropertyHost(siteUrl);

      // A URL-prefix property silently drops the apex domain, other subdomains,
      // and http. The totals still look plausible, which is what makes it worth
      // warning about rather than just allowing.
      const domainAlternative =
        propertyType === 'url_prefix'
          ? sites.find((s) => s.siteUrl.startsWith('sc-domain:') && gscPropertyHost(s.siteUrl) === host)
          : undefined;

      await ensureConfig(req, contractId);

      const { data, error } = await req.supabase
        .from('content_tracking_config')
        .update({
          gsc_property: siteUrl,
          gsc_property_type: propertyType,
          gsc_permission_level: match.permissionLevel,
          gsc_access_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('contract_id', contractId)
        .select()
        .single();

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({
        config: data,
        warning: domainAlternative
          ? `A domain property (${domainAlternative.siteUrl}) exists for this host and covers all subdomains and both protocols. The URL-prefix property you selected will under-report.`
          : null,
      });
    } catch (error) {
      res.status(502).json({
        error: 'Failed to bind property',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

// ============================================================================
// Manual run
// ============================================================================

/**
 * POST /api/compass/content/tracking-config/run-now
 * Body: { contract_id }
 *
 * Runs the full collection for one contract immediately. Useful during
 * onboarding so a strategist sees data without waiting for the nightly cron.
 */
router.post(
  '/tracking-config/run-now',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    const contractId = requireContractId(req, res);
    if (!contractId) return;

    try {
      const result = await runContract(contractId);
      res.json({ result });
    } catch (error) {
      res.status(500).json({
        error: 'Collection run failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

export default router;
