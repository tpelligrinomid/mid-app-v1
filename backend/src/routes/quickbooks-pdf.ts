/**
 * QuickBooks PDF Routes
 *
 * Fetches and streams PDF documents from QuickBooks API.
 * Handles invoice and credit memo PDFs.
 */

import { Router, Request, Response } from 'express';
import OAuthClient from 'intuit-oauth';
import { dbProxy } from '../utils/db-proxy.js';

const router = Router();

const QUICKBOOKS_BASE_URL = process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

interface StoredToken {
  id: string;
  service: string;
  identifier: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  is_active: boolean;
}

interface InvoiceRecord {
  quickbooks_id: string;
  quickbooks_realm_id: string;
  doc_number: string | null;
}

interface CreditMemoRecord {
  quickbooks_id: string;
  quickbooks_realm_id: string;
  doc_number: string | null;
}

/**
 * Create a fresh OAuth client instance for token refresh
 */
function createOAuthClient(): OAuthClient {
  return new OAuthClient({
    clientId: process.env.QUICKBOOKS_CLIENT_ID!,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
    environment: (process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production') || 'production',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
  });
}

/**
 * Get OAuth tokens for a realm, refreshing if expired
 */
async function getTokensForRealm(realmId: string): Promise<StoredToken | null> {
  const { data, error } = await dbProxy.select<StoredToken[]>('pulse_sync_tokens', {
    columns: 'id, service, identifier, access_token, refresh_token, expires_at, is_active',
    filters: { service: 'quickbooks', identifier: realmId, is_active: true },
  });

  if (error) {
    console.error(`[QuickBooks PDF] Error fetching tokens for realm ${realmId}:`, error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  let token = data[0];

  // Check if token is expired (with 5 minute buffer)
  const expiresAt = new Date(token.expires_at);
  const bufferTime = 5 * 60 * 1000;
  if (expiresAt.getTime() - bufferTime <= Date.now()) {
    console.log(`[QuickBooks PDF] Token expired for realm ${realmId}, refreshing...`);
    const refreshedToken = await refreshToken(token, realmId);
    if (refreshedToken) {
      token = refreshedToken;
    } else {
      console.error(`[QuickBooks PDF] Failed to refresh token for realm ${realmId}`);
      return null;
    }
  }

  return token;
}

/**
 * Refresh an expired OAuth token
 */
async function refreshToken(token: StoredToken, realmId: string): Promise<StoredToken | null> {
  try {
    const oauthClient = createOAuthClient();
    oauthClient.setToken({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_type: 'Bearer',
      expires_in: 3600,
      x_refresh_token_expires_in: 0,
      realmId: realmId,
    });

    const refreshResponse = await oauthClient.refresh();
    const newTokens = refreshResponse.getJson();
    const expiresAt = new Date(Date.now() + (newTokens.expires_in * 1000));

    const { error } = await dbProxy.update('pulse_sync_tokens', {
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, { id: token.id });

    if (error) {
      console.error(`[QuickBooks PDF] Error updating refreshed token:`, error);
      return null;
    }

    return {
      ...token,
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      expires_at: expiresAt.toISOString(),
    };
  } catch (err) {
    console.error(`[QuickBooks PDF] Error refreshing token for realm ${realmId}:`, err);
    return null;
  }
}

/**
 * GET /invoices/:id/pdf
 *
 * Fetches an invoice PDF from QuickBooks and streams it to the browser.
 * The :id parameter is the QuickBooks invoice ID (not the UUID).
 */
router.get('/invoices/:id/pdf', async (req: Request, res: Response) => {
  const invoiceId = req.params.id;

  try {
    // 1. Look up the invoice to get the realm_id
    const { data: invoices, error: lookupError } = await dbProxy.select<InvoiceRecord[]>(
      'pulse_invoices',
      {
        columns: 'quickbooks_id, quickbooks_realm_id, doc_number',
        filters: { quickbooks_id: invoiceId },
      }
    );

    if (lookupError) {
      console.error(`[QuickBooks PDF] Error looking up invoice ${invoiceId}:`, lookupError);
      return res.status(500).json({ error: 'Failed to look up invoice' });
    }

    if (!invoices || invoices.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoices[0];
    const realmId = invoice.quickbooks_realm_id;

    // 2. Get OAuth token for this realm
    const token = await getTokensForRealm(realmId);
    if (!token) {
      return res.status(401).json({ error: 'QuickBooks authentication required. Please reconnect QuickBooks.' });
    }

    // 3. Fetch PDF from QuickBooks
    const qboUrl = `${QUICKBOOKS_BASE_URL}/v3/company/${realmId}/invoice/${invoiceId}/pdf`;

    const qboResponse = await fetch(qboUrl, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/pdf',
      },
    });

    if (!qboResponse.ok) {
      const errorText = await qboResponse.text();
      console.error(`[QuickBooks PDF] QuickBooks API error for invoice ${invoiceId}:`, qboResponse.status, errorText);
      return res.status(qboResponse.status).json({
        error: 'Failed to fetch PDF from QuickBooks',
        details: errorText
      });
    }

    // 4. Stream the PDF to the browser
    const docNumber = invoice.doc_number || invoiceId;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${docNumber}.pdf"`);

    // Get the response as an array buffer and send it
    const pdfBuffer = await qboResponse.arrayBuffer();
    res.send(Buffer.from(pdfBuffer));

  } catch (err) {
    console.error(`[QuickBooks PDF] Unexpected error fetching invoice PDF ${invoiceId}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /credit-memos/:id/pdf
 *
 * Fetches a credit memo PDF from QuickBooks and streams it to the browser.
 */
router.get('/credit-memos/:id/pdf', async (req: Request, res: Response) => {
  const creditMemoId = req.params.id;

  try {
    // 1. Look up the credit memo to get the realm_id
    const { data: creditMemos, error: lookupError } = await dbProxy.select<CreditMemoRecord[]>(
      'pulse_credit_memos',
      {
        columns: 'quickbooks_id, quickbooks_realm_id, doc_number',
        filters: { quickbooks_id: creditMemoId },
      }
    );

    if (lookupError) {
      console.error(`[QuickBooks PDF] Error looking up credit memo ${creditMemoId}:`, lookupError);
      return res.status(500).json({ error: 'Failed to look up credit memo' });
    }

    if (!creditMemos || creditMemos.length === 0) {
      return res.status(404).json({ error: 'Credit memo not found' });
    }

    const creditMemo = creditMemos[0];
    const realmId = creditMemo.quickbooks_realm_id;

    // 2. Get OAuth token for this realm
    const token = await getTokensForRealm(realmId);
    if (!token) {
      return res.status(401).json({ error: 'QuickBooks authentication required. Please reconnect QuickBooks.' });
    }

    // 3. Fetch PDF from QuickBooks
    const qboUrl = `${QUICKBOOKS_BASE_URL}/v3/company/${realmId}/creditmemo/${creditMemoId}/pdf`;

    const qboResponse = await fetch(qboUrl, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/pdf',
      },
    });

    if (!qboResponse.ok) {
      const errorText = await qboResponse.text();
      console.error(`[QuickBooks PDF] QuickBooks API error for credit memo ${creditMemoId}:`, qboResponse.status, errorText);
      return res.status(qboResponse.status).json({
        error: 'Failed to fetch PDF from QuickBooks',
        details: errorText
      });
    }

    // 4. Stream the PDF to the browser
    const docNumber = creditMemo.doc_number || creditMemoId;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="credit-memo-${docNumber}.pdf"`);

    const pdfBuffer = await qboResponse.arrayBuffer();
    res.send(Buffer.from(pdfBuffer));

  } catch (err) {
    console.error(`[QuickBooks PDF] Unexpected error fetching credit memo PDF ${creditMemoId}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
