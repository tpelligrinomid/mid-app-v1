/**
 * Records MCP tool calls in public.mcp_tool_calls, written with the caller's
 * token so RLS applies. Fire-and-forget: a failed audit write is logged but
 * never affects the tool result.
 */
import { createUserClient } from '../../utils/supabase.js';
import type { ToolContext } from './define-tool.js';

const MAX_STRING = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keeps arguments readable in the log without storing long note bodies or questions in full. */
function trimArgs(value: unknown): unknown {
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(trimArgs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimArgs(v)]));
  }
  return value;
}

export function recordToolCall(
  ctx: ToolContext,
  call: { tool: string; args: Record<string, unknown>; ok: boolean; durationMs: number; error?: string }
): void {
  const token = ctx.getToken();
  const authId = ctx.getUserId();
  if (!token || !authId) return;

  const contractId = typeof call.args.contract_id === 'string' && UUID.test(call.args.contract_id) ? call.args.contract_id : null;

  void (async () => {
    const { error } = await createUserClient(token)
      .from('mcp_tool_calls')
      .insert({
        auth_id: authId,
        tool: call.tool,
        contract_id: contractId,
        arguments: trimArgs(call.args),
        status: call.ok ? 'ok' : 'error',
        duration_ms: call.durationMs,
        error: call.error?.slice(0, 1000) ?? null,
      });
    if (error) console.warn(`[MCP] audit write failed for ${call.tool}:`, error.message);
  })().catch((err) => console.warn('[MCP] audit write failed:', err));
}
