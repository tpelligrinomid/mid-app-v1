/**
 * Shared helpers for MCP tools, ported from v1 (pulse-compass src/lib/mcp/supabase.ts).
 * Every query runs through a client bound to the caller's token, so RLS decides
 * what each person can see — contract permissions come from Pulse/Compass only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserClient } from '../../utils/supabase.js';
import type { ToolContext } from './define-tool.js';

type ErrorResult = ReturnType<typeof errorResult>;

// Explicit union so `"error" in auth` narrows cleanly in every tool (an
// inferred union of object literals gives the success shape `error?: undefined`).
export type InternalUserResult =
  | { error: ErrorResult }
  | {
      supabase: SupabaseClient;
      role: string;
      user: { user_id: string; email: string | null; full_name: string | null; status: string | null };
    };

/** Client bound to the verified OAuth user — RLS runs as that user. */
export function supabaseForUser(ctx: ToolContext) {
  const token = ctx.getToken();
  if (!token) throw new Error('supabaseForUser requires a verified OAuth token');
  return createUserClient(token);
}

export function notAuthenticated() {
  return {
    content: [{ type: 'text' as const, text: 'Not authenticated. Reconnect this MCP server and sign in to MiD.' }],
    isError: true,
  };
}

/**
 * Resolves the signed-in user's MiD profile and blocks client-role accounts.
 * The MCP server is an internal (Owner / Admin / Team Member) surface only.
 */
export async function requireInternalUser(ctx: ToolContext): Promise<InternalUserResult> {
  if (!ctx.isAuthenticated()) {
    return { error: notAuthenticated() };
  }
  const supabase = supabaseForUser(ctx);
  const authId = ctx.getUserId();

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('user_id, email, full_name, status')
    .eq('auth_id', authId)
    .maybeSingle();

  if (userErr) return { error: errorResult(userErr.message) };
  if (!userRow) {
    return { error: errorResult('No MiD account is linked to this login.') };
  }
  if (userRow.status === 'pending') {
    return { error: errorResult('This MiD account is still pending approval.') };
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userRow.user_id)
    .order('role')
    .limit(1)
    .maybeSingle();

  if (roleErr) return { error: errorResult(roleErr.message) };

  const role = (roleRow?.role as string) ?? 'client';
  if (role === 'client') {
    return {
      error: errorResult(
        'Access denied. The MiD agent integration is available to internal team accounts only. Client accounts should use the MiD web app.'
      ),
    };
  }

  return { supabase, role, user: userRow };
}

/** Owner/Admin-only surfaces (agency-wide financials, release notes). */
export function isAdminOrHigher(role: string) {
  return role === 'owner' || role === 'admin';
}

export function jsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

export function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
