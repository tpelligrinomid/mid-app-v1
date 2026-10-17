/**
 * Minimal stand-in for @lovable.dev/mcp-js's defineTool, so the v1 tool
 * modules port over unchanged. server.ts registers each definition with the
 * MCP SDK and supplies a ToolContext for the authenticated caller.
 */
import type { z } from 'zod';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export interface ToolContext {
  /** The caller's Supabase access token (from the OAuth flow). */
  getToken(): string | null;
  /** The caller's Supabase auth user id. */
  getUserId(): string | null;
  isAuthenticated(): boolean;
}

export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title?: string;
  description: string;
  inputSchema: Shape;
  annotations?: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<CallToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(def: ToolDefinition<Shape>): ToolDefinition<Shape> {
  return def;
}
