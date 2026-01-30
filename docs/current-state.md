# MiD Platform — Current State of the System

**Last updated: January 29, 2026**

---

## Overview

The MiD Platform is a modular business operations system built for Marketers in Demand (MiD). It connects project management, accounting, CRM, and AI-powered content generation into a single platform used by the internal team and their clients.

The system is made up of five major pieces:

| Piece | What It Is | Where It Runs |
|-------|-----------|---------------|
| **Lovable** | Frontend application (React + TypeScript + Tailwind) | Lovable-hosted |
| **MiD App v1** | Backend API — the orchestrator | Render (Node.js + Express) |
| **Supabase** | Database, auth, edge functions | Supabase-hosted (managed by Lovable) |
| **Master Marketer** | AI intelligence service — the brain | Render (Node.js + Express) |
| **External Services** | ClickUp, QuickBooks, HubSpot, n8n | Third-party SaaS |

---

## How the Pieces Connect

```
                    ┌─────────────────────┐
                    │      Lovable         │
                    │  (Frontend / UI)     │
                    │                      │
                    │  Pulse Mode          │
                    │  Compass Mode        │
                    │  Client Portal       │
                    └──────────┬───────────┘
                               │
                          JWT auth
                               │
                    ┌──────────▼───────────┐
                    │    MiD App v1        │
                    │  (Backend API)       │◄──── Render Cron Jobs
                    │                      │
                    │  Orchestrator        │
                    │  Context packager    │
                    │  Sync engine         │
                    └──┬─────┬─────┬───┬───┘
                       │     │     │   │
              ┌────────┘     │     │   └──────────┐
              │              │     │               │
     ┌────────▼───┐  ┌──────▼──┐  │    ┌──────────▼──────────┐
     │  Supabase  │  │ClickUp  │  │    │  Master Marketer    │
     │  Database  │  │  API     │  │    │  (AI Service)       │
     │  Auth      │  └─────────┘  │    │                     │
     │  Edge Fns  │         ┌─────▼──┐ │  Intake / Generate  │
     └────────────┘         │QuickBks│ │  Analyze / Export   │
                            │  API   │ └─────────────────────┘
                            └────────┘

     Lovable NEVER talks to Master Marketer directly.
     All AI requests flow through MiD App v1.
```

### Communication Patterns

| From | To | Auth Method | Protocol |
|------|----|-------------|----------|
| Lovable | MiD App v1 | Supabase JWT (`Authorization: Bearer`) | HTTPS JSON |
| Lovable | Supabase | Supabase JWT (direct client) | HTTPS |
| MiD App v1 | Supabase Edge Functions | Shared secret (`x-backend-key`) | HTTPS JSON |
| MiD App v1 | Master Marketer | API key (`x-api-key`) | HTTPS JSON |
| MiD App v1 | ClickUp | API token / OAuth token | HTTPS JSON |
| MiD App v1 | QuickBooks | OAuth 2.0 bearer token | HTTPS JSON |
| MiD App v1 | HubSpot | API key | HTTPS JSON |
| Render Cron | MiD App v1 | Shared secret (`CRON_SECRET`) | HTTPS |
| Edge Function (send-email) | n8n | Webhook URL | HTTPS JSON |

---

## The Two Modes: Pulse and Compass

The Lovable frontend is a single application shell with two primary modes.

### Pulse — Portfolio View

Pulse is the global operations dashboard. It shows the entire portfolio of contracts across all clients. Only admins and team members have access.

**What Pulse does today:**
- Contract list with status, type, engagement model, and financial summary
- ClickUp task sync — tasks, time entries, deliverables, goals
- QuickBooks sync — invoices, credit memos, payments
- Points balance tracking (purchased via invoices, credited via credit memos, consumed via completed tasks)
- Sync status monitoring and manual sync triggers
- QuickBooks OAuth connection management
- Invoice and credit memo PDF viewing

**Data sources:** ClickUp (tasks, time), QuickBooks (financials), Supabase (contracts, users)

### Compass — Contract Workspace

Compass is a per-contract workspace for strategy and execution. Admins, team members, and clients (assigned contracts only) can access it.

**What Compass will do:**
- Weekly strategy notes
- Deliverable tracking with version history
- Meeting transcripts (Fireflies integration planned)
- Knowledge base (AI-powered RAG chunks)
- Status reports
- Compass Apps — modular tools per contract (see below)

**Current state:** Database schema is defined. Lovable UI is in progress. Backend routes for Compass-specific data are not yet built in MiD App v1.

### Compass Apps

Compass Apps are modular features that can be enabled per contract. Each app has its own visibility model (internal only, client view, or client collaborative).

| App | Purpose | Master Marketer Endpoints | Status |
|-----|---------|--------------------------|--------|
| **Paid Media** | Ad generation, performance dashboards | `/intake/campaign`, `/generate/ads`, `/generate/creative-brief`, `/export/creative-brief` | Master Marketer pipeline working (CLI). MiD integration not started. |
| **ABM Campaigns** | Target accounts, touchpoints | `/intake/plan`, `/generate/plan`, `/generate/ads`, `/analyze/channel-effectiveness` | Not started |
| **Content Hub** | Content calendar, asset management | `/intake/plan`, `/generate/content`, `/export/client-report` | Not started |
| **SEO Agent** | Keywords, rankings, competitors | `/analyze/competitive`, `/generate/plan`, `/export/client-report` | Not started |
| **Reporting** | Automated insights and reports | `/analyze/weekly-performance`, `/export/client-report`, `/export/slide-deck` | Not started |
| **Podcast** | Episode planning, scripts, guests | TBD | Not started |
| **Events** | Webinars, conferences | TBD | Not started |

---

## MiD App v1 — Backend API (Detail)

**Stack:** Node.js 20+, TypeScript, Express.js, deployed on Render

### Endpoints

#### Auth (Public)
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/auth/quickbooks` | Start QuickBooks OAuth flow |
| `GET` | `/api/auth/quickbooks/callback` | OAuth callback |
| `GET` | `/api/auth/quickbooks/status` | Check QB connection status |

#### Users (Protected)
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/users/me` | Current user profile |

#### Contracts (Protected)
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/contracts` | List contracts (role-filtered) |
| `GET` | `/api/contracts/:id` | Contract detail |
| `POST` | `/api/contracts` | Create contract |
| `POST` | `/api/contracts/import` | Bulk import/upsert |
| `PUT` | `/api/contracts/:id` | Update contract |
| `DELETE` | `/api/contracts/:id` | Delete contract (admin only) |

#### Sync (Protected)
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sync/status` | All sync statuses |
| `POST` | `/api/sync/clickup` | Manual ClickUp sync |
| `GET` | `/api/sync/clickup/status` | ClickUp sync status |
| `GET` | `/api/sync/clickup/status/:syncId` | Specific sync log |
| `GET` | `/api/sync/clickup/logs` | Recent sync logs |
| `POST` | `/api/sync/quickbooks` | Manual QB sync |
| `POST` | `/api/sync/hubspot` | Manual HubSpot sync |

#### QuickBooks PDF (Protected)
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/quickbooks/invoices/:id/pdf` | Stream invoice PDF |
| `GET` | `/api/quickbooks/credit-memos/:id/pdf` | Stream credit memo PDF |

#### Cron (CRON_SECRET auth)
| Method | Path | Schedule | Purpose |
|--------|------|----------|---------|
| `POST` | `/api/cron/clickup-sync` | Every 15 min (weekdays) | Incremental ClickUp sync |
| `POST` | `/api/cron/clickup-full-sync` | Sunday 8 PM UTC | Full ClickUp sync |
| `POST` | `/api/cron/quickbooks-sync` | Every 15 min (weekdays) | Incremental QB sync |
| `POST` | `/api/cron/quickbooks-full-sync` | Sunday 10 PM UTC | Full QB sync |
| `GET` | `/api/cron/health` | — | Cron health check |

### Middleware
- **authMiddleware** — validates Supabase JWT, attaches `req.user` and `req.supabase`
- **requireRole(...roles)** — role-based gate (`admin`, `team_member`, `client`)

### Key Backend Services

| Service | Location | What It Does |
|---------|----------|-------------|
| ClickUp client | `src/services/clickup/client.ts` | API wrapper with retry/backoff |
| ClickUp sync | `src/services/clickup/sync.ts` | User-triggered sync (uses Supabase client) |
| ClickUp cron sync | `src/services/clickup/cron-sync.ts` | Automated sync (uses db-proxy) |
| QuickBooks client | `src/services/quickbooks/client.ts` | API wrapper with pagination |
| QuickBooks OAuth | `src/services/quickbooks/index.ts` | Token management, OAuth flow |
| QuickBooks cron sync | `src/services/quickbooks/cron-sync.ts` | Automated sync of invoices, credit memos, payments |
| Memo parser | `src/services/quickbooks/memo-parser.ts` | Extracts contract numbers and points from QB memos |
| HubSpot | `src/services/hubspot/index.ts` | Basic integration (companies, deals). Sync not implemented. |
| DB Proxy | `src/utils/db-proxy.ts` | Client for backend-proxy edge function |
| Edge function helpers | `src/utils/edge-functions.ts` | Typed wrappers for edge function operations |

---

## Supabase — Database and Auth

Supabase is managed through Lovable. The backend does not have a service role key; privileged operations go through the `backend-proxy` edge function.

### Edge Functions

| Function | Purpose | Auth |
|----------|---------|------|
| `backend-proxy` | All privileged DB operations (select, insert, update, upsert, delete, rpc). Used by cron jobs and sync. | `x-backend-key` shared secret |
| `send-email` | Forwards email requests to n8n for template-based sending | JWT or `x-backend-key` |

### Database Tables

#### Core (Shared Foundation)
| Table | Purpose |
|-------|---------|
| `organizations` | Business entities |
| `accounts` | Client accounts |
| `contracts` | Service agreements — the central entity everything links to |
| `users` | All platform users with roles |
| `user_contract_access` | Client-to-contract permission grants |
| `contract_modules` | Feature toggles per contract (which Compass Apps are enabled) |

#### Pulse Tables (Integration Sync)
| Table | Source | Purpose |
|-------|--------|---------|
| `pulse_tasks` | ClickUp | Synced tasks with status, assignee, points, dates |
| `pulse_time_entries` | ClickUp | Billable hours |
| `pulse_clickup_users` | ClickUp | Team members for assignment display |
| `pulse_invoice_tasks` | ClickUp | Special invoicing list tasks |
| `pulse_invoices` | QuickBooks | Invoices with contract linking and points |
| `pulse_credit_memos` | QuickBooks | Credit memos with points |
| `pulse_payments` | QuickBooks | Payments linked to invoices |
| `pulse_sync_state` | Internal | Current sync status per service |
| `pulse_sync_logs` | Internal | Audit trail of all sync operations |
| `pulse_sync_tokens` | Internal | OAuth tokens (QB) stored per realm |

#### Compass Tables (Strategy Execution)
| Table | Purpose |
|-------|---------|
| `compass_notes` | Weekly strategy notes per contract |
| `compass_deliverables` | Plans, roadmaps, documents |
| `compass_deliverable_versions` | Version history for deliverables |
| `compass_assets` | Files and media |
| `compass_meetings` | Meeting transcripts (Fireflies) |
| `compass_knowledge` | AI knowledge chunks for RAG |
| `compass_reports` | Status reports |

#### Materialized Views
| View | Purpose |
|------|---------|
| `contract_points_summary` | Aggregated points purchased, credited, delivered, balance |
| `contract_performance_view` | Combined performance metrics per contract |

### Key Schema Patterns
- UUID primary keys everywhere
- JSONB columns for raw API data and flexible metadata
- Soft deletes via `is_deleted` flag
- `created_at` / `updated_at` / `last_synced_at` timestamps
- Row Level Security (RLS) on all tables

---

## Master Marketer — AI Intelligence Service

Master Marketer is a separate Node.js + Express service deployed on Render. It is stateless — it receives structured JSON and returns structured JSON. It does not access Supabase, does not know about users or contracts, and does not manage any state.

### Endpoint Categories

| Category | Pattern | Purpose |
|----------|---------|---------|
| **Intake** | `POST /intake/*` | Convert unstructured documents (PDF, DOCX, markdown, transcripts) into standardized JSON |
| **Generate** | `POST /generate/*` | Produce new content from structured input |
| **Analyze** | `POST /analyze/*` | Interpret performance data, produce recommendations |
| **Export** | `POST /export/*` | Format structured data into presentation-ready output |

### Document Hierarchy

Master Marketer operates on a four-tier content hierarchy:

```
Research (foundational, refreshed quarterly)
    → Roadmap (strategic direction, built from research)
        → Plan (tactical execution, per campaign/channel)
            → Creative Brief / Execution (ad copy, content, landing pages)

Meeting Notes feed decisions back into any layer.
```

### What's Built Today

The **Paid Media ad generation pipeline** works end-to-end as a CLI:

1. **Intake** — Reads PDFs/DOCX/markdown, calls Claude, produces structured campaign JSON
2. **Generate** — Takes campaign JSON, generates ads per platform (LinkedIn, display) per ad type (pain point, statement, question, comparison, numbers, testimonial, social proof, how-to)
3. **Export** — Converts JSON output to designer-ready markdown creative brief

**Key components:**
- Campaign input Zod schema (`src/types/campaign-input.ts`)
- Document intake (`src/intake.ts`)
- Ad generation (`src/generate.ts`)
- Markdown export (`src/export-markdown.ts`)
- Platform-specific prompt builders (LinkedIn, display)
- Ad reference library (28 curated B2B examples)
- Visual styles library (12 proven formats)
- Express scaffolding with auth middleware and validation (API not yet serving traffic)

**AI model:** Claude Opus 4 for generation, Sonnet for intake
**Async:** Trigger.dev planned for generation tasks exceeding 30 seconds

### What's Not Built Yet

- HTTP API endpoints (Express routes exist as scaffolding only)
- Trigger.dev integration for async jobs
- Research, roadmap, plan intake endpoints
- All analyze endpoints
- All export endpoints beyond markdown
- Integration with MiD App v1 (no client service exists in MiD yet)

---

## Integration Status Summary

| Integration | Status | What Works |
|-------------|--------|-----------|
| **ClickUp** | Production | Full sync — tasks, time entries, users, invoice tasks. Incremental + full. Cron running. |
| **QuickBooks** | Production | Full sync — invoices, credit memos, payments. OAuth flow. PDF streaming. Memo parsing. Cron running. |
| **HubSpot** | Stubbed | Basic client (get companies, get deals). Sync logic not implemented. |
| **Master Marketer** | Not connected | CLI pipeline works standalone. No HTTP API, no MiD client service, no integration. |
| **n8n (Email)** | Working | Email forwarding via `send-email` edge function. Templates for invitations, reports, etc. |
| **Fireflies** | Not started | Compass meetings table exists. No integration built. |

---

## What Needs to Be Built Next

This is a summary of the gaps between the current state and the architecture described in `architecture-summary.md`.

### In MiD App v1

1. **Master Marketer client service** — HTTP client that calls Master Marketer endpoints, handles API key auth, and manages async job responses (polling or webhook callbacks).

2. **Context packaging functions** — Logic that gathers contract data, research, roadmaps, plans, campaign history, and performance metrics from Supabase and assembles them into the JSON payloads Master Marketer expects.

3. **Compass App routes** — New API endpoints for each Compass App that the Lovable frontend will call to trigger generation, view results, and manage the document hierarchy.

4. **Result storage** — After Master Marketer returns output, write it to the appropriate Compass tables (deliverables, versions, reports, etc.).

5. **Async job tracking** — Pattern for kicking off Trigger.dev jobs, tracking status, and returning results to the frontend (polling or WebSocket).

6. **Reference library CRUD** — Endpoints for managing ad examples and visual styles once they move from JSON files to Supabase tables.

7. **Compass data routes** — CRUD for notes, deliverables, meetings, knowledge, reports (the Compass tables exist but have no backend routes).

8. **HubSpot sync** — Complete the sync logic for companies and deals.

### In Master Marketer

1. **HTTP API** — Convert the CLI pipeline into live Express endpoints.
2. **Trigger.dev integration** — Wire up long-running tasks.
3. **Remaining endpoints** — Research/roadmap/plan intake, all analyze endpoints, export endpoints.

### In Lovable

1. **Compass mode UI** — Contract workspace with notes, deliverables, meetings.
2. **Compass App UIs** — Per-app interfaces (Paid Media first).
3. **Generation triggers** — Buttons/forms that call MiD App v1 to start AI generation.
4. **Async status display** — Show progress for long-running generation jobs.
5. **Reference library management UI** — For curating ad examples and visual styles.

---

## Environment and Deployment

| Component | Hosting | Deploy Method |
|-----------|---------|---------------|
| Lovable frontend | Lovable | Lovable managed (push to deploy) |
| MiD App v1 backend | Render | Auto-deploy from main branch |
| Supabase | Supabase | Lovable managed |
| Master Marketer | Render | Auto-deploy from main branch (separate repo) |
| Cron jobs | Render Cron | HTTP calls to MiD App v1 endpoints |

**Development workflow:** No local dev server. Direct commits to main, Render auto-deploys. Render region: Ohio (US East).

### Environment Variables (MiD App v1)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase public anon key |
| `EDGE_FUNCTION_SECRET` | Shared secret for edge function auth |
| `BACKEND_API_KEY` | Backend-to-backend auth |
| `CLICKUP_API_TOKEN` | ClickUp API token |
| `CLICKUP_TEAM_ID` | ClickUp team ID |
| `CLICKUP_INVOICE_LIST_ID` | ClickUp invoicing list |
| `QUICKBOOKS_CLIENT_ID` | QB OAuth client ID |
| `QUICKBOOKS_CLIENT_SECRET` | QB OAuth client secret |
| `QUICKBOOKS_REDIRECT_URI` | QB OAuth callback URL |
| `QUICKBOOKS_ENVIRONMENT` | `sandbox` or `production` |
| `HUBSPOT_API_KEY` | HubSpot API key |
| `PORT` | Server port (default 3001) |
| `FRONTEND_URL` | Frontend URL(s) for CORS |
| `CRON_SECRET` | Cron job authentication |

---

## User Roles and Access

| Role | Pulse | Compass | Compass Apps | Admin Functions |
|------|-------|---------|-------------|-----------------|
| **admin** | Full access | All contracts | All apps | User management, sync, config |
| **team_member** | Full access | All contracts | All apps | Sync triggers, contract management |
| **client** | No access | Assigned contracts only | Apps marked `client_visible` | None |

---

## Key Business Concepts

### Points System
MiD uses a points-based model for tracking deliverables and billing:

- **Points purchased** — from QuickBooks invoices (parsed from memo field)
- **Points credited** — from QuickBooks credit memos (can be negative)
- **Points delivered** — from completed ClickUp tasks (custom field)
- **Points balance** — purchased + credited - delivered
- **Points burden** — balance - (1.5 x monthly allotment). Positive = client is ahead; negative = MiD owes work.

### Contract as Central Entity
Everything in the platform links back to a contract:
- Tasks link via `contract_id` (matched by ClickUp folder)
- Invoices link via `contract_id` (matched by memo field parsing)
- Compass notes, deliverables, meetings all scope to a contract
- Compass Apps are enabled per contract via `contract_modules`

### Memo Field Format (QuickBooks)
```
ContractNumber:MID20250001;Points:600;
```
Parsing priority: PrivateNote → CustomerMemo → fallback patterns.
