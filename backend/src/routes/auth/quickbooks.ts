import { Router, Request, Response } from 'express';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import * as quickBooksService from '../../services/quickbooks/index.js';

const router = Router();

/**
 * GET /api/auth/quickbooks
 * Start QuickBooks OAuth flow for a specific agency
 * Query params: agencyId (required)
 * Only admin/team_member can initiate OAuth
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

      const authUrl = quickBooksService.getAuthorizationUrl(agencyId);
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
 * Token storage is handled via Edge Functions (no user auth needed here).
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

    // Extract agency ID from state
    const stateData = quickBooksService.parseState(state);

    if (!stateData) {
      console.error('QuickBooks callback invalid state parameter');
      res.redirect(`${redirectUrl}/settings/integrations?quickbooks=error&reason=invalid_state`);
      return;
    }

    const { agencyId } = stateData;

    // The full URL is needed for the OAuth library to parse
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Handle callback - tokens stored via Edge Function (service role internally)
    const tokens = await quickBooksService.handleCallback(fullUrl, agencyId);

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

      const connected = await quickBooksService.isConnected(agencyId);

      if (!connected) {
        res.json({
          connected: false,
          agencyId,
          message: 'QuickBooks not connected for this agency',
        });
        return;
      }

      // Check if we can refresh the token (validates it's still usable)
      const validTokens = await quickBooksService.refreshTokenIfNeeded(agencyId);

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

export default router;
