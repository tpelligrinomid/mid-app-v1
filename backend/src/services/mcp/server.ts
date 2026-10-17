/**
 * MiD MCP v2 server. Built per request (stateless transport); every tool runs
 * as the authenticated caller under RLS.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext, ToolDefinition } from './define-tool.js';
import { recordToolCall } from './audit.js';

import listContracts from './tools/list-contracts.js';
import getContract from './tools/get-contract.js';
import listTechnologies from './tools/list-technologies.js';
import listTasks from './tools/list-tasks.js';
import portfolioTasks from './tools/portfolio-tasks.js';
import searchCompass from './tools/search-compass.js';
import getDeliverable from './tools/get-deliverable.js';
import getNoteOrMeeting from './tools/get-note.js';
import pulseMetrics from './tools/pulse-metrics.js';
import sentimentPulse from './tools/sentiment-pulse.js';
import sentimentQuotes from './tools/sentiment-quotes.js';
import pointsDelivery from './tools/points-delivery.js';
import createNote from './tools/create-note.js';
import createReleaseNote from './tools/create-release-note.js';
import listPeople from './tools/list-people.js';
import assigneeTasks from './tools/assignee-tasks.js';
import compassAsk from './tools/compass-ask.js';

const INSTRUCTIONS = [
  'Tools for the MiD platform (Pulse + Compass). Internal use only: Owner, Admin and Team Member accounts. Client accounts are denied on every tool and must use the MiD web app.',
  "CROSS-ACCOUNT QUESTIONS ('what is overdue across all accounts?', 'everything in working status this week') MUST use `list_portfolio_tasks` in a single call — never loop `list_tasks` over each contract; `list_tasks` is only for drilling into one known contract.",
  "For questions about a PERSON (e.g. 'what is Nathalia Braga working on next week?'), use `list_people` to resolve the name, then `list_assignee_tasks` with a due-date window — do not try to find people via `search_compass`.",
  '`search_compass` works across all visible contracts when contract_id is omitted, or scoped to one contract when supplied.',
  "DELIVERY/CONSUMPTION QUESTIONS ('how many points did we deliver for X in July?', 'what did we spend points on?') use `get_points_delivery` with a from/to window and group_by month | contract | service_category | assignee — never reconstruct this from `list_tasks`.",
  'For cross-client sentiment questions use `get_sentiment_pulse` (set trend=true for direction over time), then pull citable evidence with `get_sentiment_quotes` and drill into a single record with `get_note_or_meeting`.',
  "TECH STACK AUDITS: use `get_pulse_metrics` metric=tech_breakdown for one row per contract per tool (resolved cost, price, margin, card, dates) in a single call; `list_technologies` for the catalog/rate card; `get_contract` include_inactive=true to verify a canceled client's tools were switched off. Client-billable per-client tools are paid on the client's own card (not tracked).",
  "QUESTIONS NEEDING SYNTHESIS OR RESEARCH about one client (what was decided, how campaigns performed, competitors, market context) use `compass_ask` with that contract's id — it reads the client's notes/meetings/deliverables, the web, and the client's connected marketing and SEO data. Prefer the specific tools for plain lookups.",
  'Agency-wide metrics and release-note publishing require Owner or Admin. All data is additionally scoped by the signed-in user\'s role and assigned contracts.',
].join(' ');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: ToolDefinition<any>[] = [
  listContracts,
  getContract,
  listTechnologies,
  listTasks,
  portfolioTasks,
  searchCompass,
  getDeliverable,
  getNoteOrMeeting,
  pulseMetrics,
  sentimentPulse,
  sentimentQuotes,
  pointsDelivery,
  createNote,
  createReleaseNote,
  listPeople,
  assigneeTasks,
  compassAsk,
];

export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'mid', title: 'MiD Pulse & Compass', version: '2.0.0' }, { instructions: INSTRUCTIONS });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        const started = Date.now();
        try {
          const result = await tool.handler(args, ctx);
          const errorText = result.isError ? result.content.map((c) => ('text' in c ? c.text : '')).join(' ') : undefined;
          recordToolCall(ctx, { tool: tool.name, args, ok: !result.isError, durationMs: Date.now() - started, error: errorText });
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[MCP] ${tool.name} failed:`, err);
          recordToolCall(ctx, { tool: tool.name, args, ok: false, durationMs: Date.now() - started, error: message });
          return {
            content: [{ type: 'text' as const, text: `${tool.name} failed: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
