/**
 * Nightwatch site picker (contract settings).
 *
 * GET /api/compass/nightwatch/sites
 *   Sites ("URLs") tracked in the agency's Nightwatch account, to choose one
 *   for a contract. The API key (NIGHTWATCH_API_KEY) stays on the server.
 *
 * GET /api/compass/nightwatch/contracts/:contractId
 * PUT /api/compass/nightwatch/contracts/:contractId   { site_id: string | null }
 *   Read, set or clear the contract's Nightwatch site in contract_integrations,
 *   through the caller's client so RLS (internal staff only) applies.
 *
 * Admin and team members only.
 */
import { Router, Request, Response } from 'express';
import { listUrls, nightwatchConfigured } from '../../services/nightwatch/client.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITES_CACHE_MS = 5 * 60 * 1000;

let sitesCache: { at: number; sites: Array<{ id: string; url: string; name: string; keywords: number | null }> } | null = null;

function requireTeam(req: Request, res: Response): boolean {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return false;
  }
  if (req.user.role === 'client') {
    res.status(403).json({ error: 'Access denied', code: 'INSUFFICIENT_PERMISSIONS' });
    return false;
  }
  return true;
}

async function getSites() {
  if (sitesCache && Date.now() - sitesCache.at < SITES_CACHE_MS) return sitesCache.sites;
  const urls = await listUrls();
  const sites = urls.map((u) => ({
    id: String(u.id),
    url: u.url,
    name: u.custom_name || u.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''),
    keywords: u.keyword_count ?? null,
  }));
  sitesCache = { at: Date.now(), sites };
  return sites;
}

router.get('/sites', async (req: Request, res: Response): Promise<void> => {
  if (!requireTeam(req, res)) return;
  if (!nightwatchConfigured()) {
    res.status(503).json({ error: 'Nightwatch is not configured' });
    return;
  }
  try {
    res.json({ sites: await getSites() });
  } catch (err) {
    console.error('[Nightwatch] Listing sites failed:', err instanceof Error ? err.message : err);
    res.status(502).json({ error: 'Could not load Nightwatch sites' });
  }
});

router.get('/contracts/:contractId', async (req: Request, res: Response): Promise<void> => {
  if (!requireTeam(req, res)) return;
  const { contractId } = req.params;
  if (!UUID_RE.test(contractId)) {
    res.status(400).json({ error: 'Invalid contract id' });
    return;
  }
  const { data, error } = await req.supabase!
    .from('contract_integrations')
    .select('external_id, label, connected_at')
    .eq('contract_id', contractId)
    .eq('provider', 'nightwatch')
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ site_id: data?.external_id ?? null, label: data?.label ?? null, connected_at: data?.connected_at ?? null });
});

router.put('/contracts/:contractId', async (req: Request, res: Response): Promise<void> => {
  if (!requireTeam(req, res)) return;
  const { contractId } = req.params;
  const siteId = req.body?.site_id;
  if (!UUID_RE.test(contractId)) {
    res.status(400).json({ error: 'Invalid contract id' });
    return;
  }

  if (siteId === null || siteId === '') {
    const { error } = await req.supabase!
      .from('contract_integrations')
      .delete()
      .eq('contract_id', contractId)
      .eq('provider', 'nightwatch');
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ site_id: null });
    return;
  }

  if (typeof siteId !== 'string' || !/^\d+$/.test(siteId)) {
    res.status(400).json({ error: 'site_id must be a Nightwatch site id or null' });
    return;
  }

  // Only sites that exist in the agency's Nightwatch account can be connected.
  let site;
  try {
    site = (await getSites()).find((s) => s.id === siteId);
  } catch {
    res.status(502).json({ error: 'Could not verify the Nightwatch site' });
    return;
  }
  if (!site) {
    res.status(400).json({ error: 'Unknown Nightwatch site' });
    return;
  }

  const { error } = await req.supabase!.from('contract_integrations').upsert(
    {
      contract_id: contractId,
      provider: 'nightwatch',
      external_id: siteId,
      label: site.name,
      connected_by: req.user!.auth_id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'contract_id,provider' }
  );
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ site_id: siteId, label: site.name });
});

export default router;
