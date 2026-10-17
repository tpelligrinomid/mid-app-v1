/**
 * MiD MCP v2 endpoint (streamable HTTP, stateless).
 *
 * Auth: Supabase's OAuth 2.1 server is the authorization server. Clients find
 * it through the protected-resource metadata below, sign the user in on the
 * app's consent page, and call /mcp with the resulting Supabase access token.
 * Tools run as that user under RLS (see services/mcp).
 */
import express, { Request, Response, Router } from 'express';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createUserClient } from '../utils/supabase.js';
import { buildMcpServer } from '../services/mcp/server.js';
import type { ToolContext } from '../services/mcp/define-tool.js';

const router = Router();

// MCP clients (claude.ai's servers, Claude Desktop/Code, MCP Inspector) are not
// the web app, so the MCP paths get their own permissive CORS and body parser.
// Applied per path (not router.use): this router is mounted at the app root,
// before the app-wide CORS allowlist, and must not touch other routes.
const MCP_PATHS = ['/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'];
const mcpCors = cors({
  origin: true,
  exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
});
router.use(MCP_PATHS, mcpCors);
router.use('/mcp', express.json({ limit: '4mb' }));

function resourceUrl(req: Request): string {
  return process.env.MCP_PUBLIC_URL?.replace(/\/+$/, '') || `https://${req.get('host')}/mcp`;
}

function metadataUrl(req: Request): string {
  return `${new URL(resourceUrl(req)).origin}/.well-known/oauth-protected-resource`;
}

// RFC 9728 protected-resource metadata (root and path-suffixed forms).
router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (req, res) => {
  res.json({
    resource: resourceUrl(req),
    authorization_servers: [`${process.env.SUPABASE_URL!.replace(/\/+$/, '')}/auth/v1`],
    bearer_methods_supported: ['header'],
    resource_name: 'MiD Pulse & Compass',
  });
});

function unauthorized(req: Request, res: Response, description: string): void {
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${metadataUrl(req)}"`)
    .json({ jsonrpc: '2.0', error: { code: -32001, message: description }, id: null });
}

router.post('/mcp', async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    unauthorized(req, res, 'Authentication required');
    return;
  }
  const token = header.slice(7).trim();

  const { data, error } = await createUserClient(token).auth.getUser();
  if (error || !data.user) {
    unauthorized(req, res, 'Invalid or expired token');
    return;
  }
  const userId = data.user.id;

  const ctx: ToolContext = {
    getToken: () => token,
    getUserId: () => userId,
    isAuthenticated: () => true,
  };

  const server = buildMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP] request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

// Stateless server: no SSE stream or session to resume or delete.
router.all('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
});

export default router;
