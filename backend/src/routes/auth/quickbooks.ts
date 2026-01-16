import { Router, Request, Response } from 'express';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { createUserClient } from '../../utils/supabase.js';
import * as quickBooksService from '../../services/quickbooks/index.js';

const router = Router();

/**
 * GET /api/auth/quickbooks
 * Start QuickBooks OAuth flow for a specific agency
 * Query params: agencyId (required)
 * Only admin/team_member can initiate OAuth
 *
 * The user's JWT is encoded in the OAuth state so we can authenticate
 * the callback request (since OAuth callbacks don't have auth headers).
 */
router.get(
  '/',
  authMiddleware,
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { agencyId } = req.query;

      if (!agencyId || typeof agencyId !== 'string') {
        res.status(400).json({ error: 'agencyId query parameter is required' });
        return;
      }

      // Get the user's token from the auth header to include in state
      const userToken = req.headers.authorization?.substring(7) || '';

      const authUrl = quickBooksService.getAuthorizationUrl(agencyId, userToken);
      res.redirect(authUrl);
    } catch (error) {
      console.error('QuickBooks auth error:', error);
      res.status(500).json({ error: 'Failed to initiate QuickBooks OAuth' });
    }
  }
);

/**
 * GET /api/auth/quickbooks/callback
 * QuickBooks OAuth callback
 * This endpoint is called by QuickBooks after user authorizes.
 *
 * Authentication is handled via the state parameter which contains
 * the user's JWT from when they initiated the flow.
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { state } = req.query;
    const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (!state || typeof state !== 'string') {
      console.error('QuickBooks callback missing state parameter');
      res.redirect(`${redirectUrl}/settings/integrations?quickbooks=error&reason=missing_state`);
      return;
    }

    // Extract agency ID and user token from state
    const stateData = quickBooksService.parseState(state);

    if (!stateData) {
      console.error('QuickBooks callback invalid state parameter');
      res.redirect(`${redirectUrl}/settings/integrations?quickbooks=error&reason=invalid_state`);
      return;
    }

    const { agencyId, userToken } = stateData;

    // Recreate authenticated Supabase client from the stored token
    const supabase = createUserClient(userToken);

    // Verify the token is still valid
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('QuickBooks callback - user token invalid or expired');
      res.redirect(`${redirectUrl}/settings/integrations?quickbooks=error&reason=auth_expired`);
      return;
    }

    // The full URL is needed for the OAuth library to parse
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const tokens = await quickBooksService.handleCallback(fullUrl, agencyId, supabase);

    // Redirect to frontend with success message
    res.redirect(
      `${redirectUrl}/settings/integrations?quickbooks=connected&agency=${agencyId}&realm=${tokens.realm_id}`
    );
  } catch (error) {
    console.error('QuickBooks callback error:', error);

    const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${redirectUrl}/settings/integrations?quickbooks=error&reason=callback_failed`);
  }
});

/**
 * GET /api/auth/quickbooks/status
 * Check QuickBooks connection status for a specific agency
 * Query params: agencyId (required)
 */
router.get(
  '/status',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { agencyId } = req.query;

      if (!agencyId || typeof agencyId !== 'string') {
        res.status(400).json({ error: 'agencyId query parameter is required' });
        return;
      }

      if (!req.supabase) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const tokens = await quickBooksService.getStoredTokens(agencyId, req.supabase);

      if (!tokens) {
        res.json({
          connected: false,
          agencyId,
          message: 'QuickBooks not connected for this agency',
        });
        return;
      }

      // Check if we can refresh the token (validates it's still usable)
      const validTokens = await quickBooksService.refreshTokenIfNeeded(agencyId, req.supabase);

      res.json({
        connected: !!validTokens,
        agencyId,
        realmId: validTokens?.realm_id || null,
        message: validTokens
          ? 'QuickBooks connected'
          : 'QuickBooks token expired or invalid',
      });
    } catch (error) {
      console.error('QuickBooks status check error:', error);
      res.status(500).json({ error: 'Failed to check QuickBooks status' });
    }
  }
);

/**
 * GET /api/auth/quickbooks/connections
 * List all agencies with QuickBooks connections
 * Admin/team_member only
 */
router.get(
  '/connections',
  authMiddleware,
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.supabase) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const agencies = await quickBooksService.getAllConnectedAgencies(req.supabase);

      res.json({
        connections: agencies,
        count: agencies.length,
      });
    } catch (error) {
      console.error('QuickBooks connections error:', error);
      res.status(500).json({ error: 'Failed to fetch QuickBooks connections' });
    }
  }
);

export default router;
