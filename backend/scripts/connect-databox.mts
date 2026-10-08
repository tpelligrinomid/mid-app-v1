// One-time Databox connection for Compass. Databox's metric data is only
// readable through its MCP server, which takes OAuth (not API keys). This
// registers an OAuth client, opens the Databox login in the browser, and
// stores the resulting refresh token in pulse_sync_tokens (service
// "databox_mcp"), where src/services/databox/mcp.ts picks it up and keeps it
// refreshed. Rerun it if the token is ever revoked.
//
// Run from backend/:  npx tsx scripts/connect-databox.mts
import 'dotenv/config';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
// The backend compiles to CommonJS, so its named exports arrive on `default`
// when imported from this ES module.
const mcpModule = await import('../src/services/databox/mcp.js');
const { saveDataboxTokens, DATABOX_AUTH_SERVER, DATABOX_MCP_URL, DATABOX_SCOPES } =
  ('default' in mcpModule ? mcpModule.default : mcpModule) as typeof import('../src/services/databox/mcp.js');

const PORT = 8765;
// Gitignored fallback for tokens when Supabase can't be reached.
const LOCAL_TOKEN_FILE = '.databox-tokens.local.json';

if (process.argv.includes('--from-file')) {
  await saveDataboxTokens(JSON.parse(readFileSync(LOCAL_TOKEN_FILE, 'utf8')));
  unlinkSync(LOCAL_TOKEN_FILE);
  console.log('Databox tokens stored in pulse_sync_tokens (databox_mcp); local file removed.');
  process.exit(0);
}
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// 1. Register a public OAuth client (dynamic client registration).
const registration = await fetch(`${DATABOX_AUTH_SERVER}/oauth2/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'MiD Compass',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: DATABOX_SCOPES,
  }),
});
if (!registration.ok) throw new Error(`Client registration failed (${registration.status}): ${await registration.text()}`);
const { client_id: clientId } = (await registration.json()) as { client_id: string };

// 2. Send the user through the authorization-code flow with PKCE.
const verifier = base64url(randomBytes(32));
const challenge = base64url(createHash('sha256').update(verifier).digest());
const state = base64url(randomBytes(16));
const authorizeUrl = new URL(`${DATABOX_AUTH_SERVER}/oauth2/authorize`);
authorizeUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  scope: DATABOX_SCOPES,
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  resource: DATABOX_MCP_URL,
}).toString();

const code = await new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', REDIRECT_URI);
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const returnedCode = url.searchParams.get('code');
    const ok = !error && returnedCode && url.searchParams.get('state') === state;
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html' });
    res.end(ok ? '<h2>Databox connected to Compass. You can close this tab.</h2>' : `<h2>Databox connection failed: ${error ?? 'bad state'}</h2>`);
    server.close();
    if (ok) resolve(returnedCode!);
    else reject(new Error(`Authorization failed: ${error ?? 'state mismatch'}`));
  });
  server.listen(PORT, () => {
    console.log(`Opening the Databox login. If no browser opens, visit:\n${authorizeUrl}\n`);
    const opener = process.platform === 'win32' ? `start "" "${authorizeUrl}"` : process.platform === 'darwin' ? `open "${authorizeUrl}"` : `xdg-open "${authorizeUrl}"`;
    exec(opener);
  });
});

// 3. Exchange the code for tokens and store them.
const tokenResponse = await fetch(`${DATABOX_AUTH_SERVER}/oauth2/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
    resource: DATABOX_MCP_URL,
  }),
});
if (!tokenResponse.ok) throw new Error(`Token exchange failed (${tokenResponse.status}): ${await tokenResponse.text()}`);
const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token?: string; expires_in: number };
if (!tokens.refresh_token) throw new Error('Databox returned no refresh token, so Compass could not stay connected.');

const databoxTokens = {
  client_id: clientId,
  access_token: tokens.access_token,
  refresh_token: tokens.refresh_token,
  expires_at: Date.now() + tokens.expires_in * 1000,
};
try {
  await saveDataboxTokens(databoxTokens);
  console.log('Databox connected. Refresh token stored in pulse_sync_tokens (databox_mcp).');
} catch (err) {
  // Keep the login rather than losing it; --from-file stores it later.
  writeFileSync(LOCAL_TOKEN_FILE, JSON.stringify(databoxTokens, null, 2));
  console.error(`Could not store the tokens in Supabase (${err instanceof Error ? err.message : err}).`);
  console.error(`Saved them to ${LOCAL_TOKEN_FILE} instead. Fix the Supabase settings in .env, then run:
  npx tsx scripts/connect-databox.mts --from-file`);
  process.exit(1);
}
