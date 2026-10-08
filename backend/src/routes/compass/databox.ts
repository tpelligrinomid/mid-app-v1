/**
 * Databox account picker
 *
 * GET /api/compass/databox/accounts
 *   Every Databox account the agency's API key can see, for choosing a
 *   contract's databox_account_id. Names aren't unique (two accounts are
 *   called "New North"), so each comes with its ID.
 *
 * GET /api/compass/databox/accounts/:id/sources
 *   The data sources connected in one account, so the picker can show what
 *   choosing it would give Compass (e.g. GA4, Google Ads, LinkedIn Ads).
 *
 * Admin and team members only. The Databox API key (DATABOX_API_KEY) stays
 * on the server; saving the choice goes through PUT /api/contracts/:id.
 */

import { Router, Request, Response } from 'express';

const router = Router();

const DATABOX_API = 'https://api.databox.com/v2';
const ACCOUNTS_CACHE_MS = 10 * 60 * 1000;

interface DataboxAccount {
  id: number;
  name: string;
}

interface DataboxSource {
  id: number;
  name: string;
  integrationKey: string;
  statusInfo?: { status?: string };
}

// Databox scopes a request to one account with the x-account-id header; a
// query parameter is silently ignored.
async function databoxGet<T>(path: string, accountId?: string): Promise<T> {
  const apiKey = process.env.DATABOX_API_KEY;
  if (!apiKey) throw new Error('DATABOX_API_KEY is not configured');
  const response = await fetch(`${DATABOX_API}${path}`, {
    headers: { 'x-api-key': apiKey, ...(accountId && { 'x-account-id': accountId }) },
  });
  if (!response.ok) throw new Error(`Databox API ${response.status} for ${path}`);
  const body = (await response.json()) as { data: T };
  return body.data;
}

/** All pages of a Databox v2 list endpoint. */
async function databoxList<T>(path: string, accountId?: string): Promise<T[]> {
  const items: T[] = [];
  const separator = path.includes('?') ? '&' : '?';
  for (let page = 0; page < 50; page++) {
    const data = await databoxGet<{ items: T[]; pagination?: { totalItems?: number } }>(
      `${path}${separator}page=${page}&pageSize=100`,
      accountId
    );
    items.push(...data.items);
    const total = data.pagination?.totalItems;
    if (data.items.length < 100 || (total !== undefined && items.length >= total)) break;
  }
  return items;
}

let accountsCache: { at: number; accounts: Array<{ id: string; name: string }> } | null = null;

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

router.get('/accounts', async (req: Request, res: Response): Promise<void> => {
  if (!requireTeam(req, res)) return;
  try {
    if (!accountsCache || Date.now() - accountsCache.at > ACCOUNTS_CACHE_MS) {
      // /accounts lists the client accounts the agency manages; the agency's
      // own account is the organization itself and isn't in that list.
      const [accounts, organization] = await Promise.all([
        databoxList<DataboxAccount>('/accounts'),
        databoxGet<DataboxAccount>('/organization'),
      ]);
      accountsCache = {
        at: Date.now(),
        accounts: [
          ...accounts.map((a) => ({ id: String(a.id), name: a.name })),
          { id: String(organization.id), name: `${organization.name} (agency account)` },
        ]
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      };
    }
    res.json({ accounts: accountsCache.accounts });
  } catch (err) {
    console.error('[Databox] Listing accounts failed:', err);
    res.status(502).json({ error: 'Could not load Databox accounts' });
  }
});

router.get('/accounts/:id/sources', async (req: Request, res: Response): Promise<void> => {
  if (!requireTeam(req, res)) return;
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: 'Account id must be numeric' });
    return;
  }
  try {
    const sources = await databoxList<DataboxSource>('/data-sources', id);
    res.json({
      sources: sources
        // Push/token sources hold no marketing metrics.
        .filter((s) => !(s.integrationKey === 'Custom' && s.name === 'Token'))
        .map((s) => ({
          id: String(s.id),
          name: s.name,
          type: s.integrationKey,
          status: s.statusInfo?.status ?? null,
        })),
    });
  } catch (err) {
    console.error(`[Databox] Listing sources for account ${id} failed:`, err);
    res.status(502).json({ error: 'Could not load Databox sources' });
  }
});

export default router;
