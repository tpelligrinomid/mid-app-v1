# MiD Platform - Technical Decisions Document

**Last Updated:** January 2025

This document captures key architectural and development decisions made during the platform rebuild. Reference this alongside `platform-rebuild-plan.md` for full context.

---

## Table of Contents

1. [Backend Architecture](#backend-architecture)
2. [Authentication Strategy](#authentication-strategy)
3. [Multi-Agency Integration Pattern](#multi-agency-integration-pattern)
4. [Third-Party Integrations](#third-party-integrations)
5. [Database Patterns](#database-patterns)
6. [Deployment Architecture](#deployment-architecture)
7. [API Design Conventions](#api-design-conventions)

---

## Backend Architecture

### Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js 20+ | LTS version, modern ES features, team familiarity |
| Language | TypeScript | Type safety, better IDE support, refactoring confidence |
| Framework | Express.js | Lightweight, well-documented, large ecosystem |
| Database Client | Supabase JS | Native RLS support, auth integration |
| Package Manager | npm | Standard, works well with Render |

### Project Structure

```
backend/
├── src/
│   ├── index.ts              # Express app entry point
│   ├── types/                # TypeScript declarations
│   │   ├── express.d.ts      # Request extensions (user, supabase)
│   │   └── intuit-oauth.d.ts # QuickBooks OAuth types
│   ├── utils/
│   │   └── supabase.ts       # Client factory (user client vs service client)
│   ├── middleware/
│   │   └── auth.ts           # JWT validation + role-based access
│   ├── routes/
│   │   ├── users.ts          # User profile endpoints
│   │   ├── auth/             # OAuth flows (QuickBooks, etc.)
│   │   └── pulse/            # Pulse module endpoints
│   └── services/
│       ├── clickup/          # ClickUp API integration
│       ├── quickbooks/       # QuickBooks OAuth + API
│       └── hubspot/          # HubSpot API integration
```

### Decision: Separate Backend vs. Supabase Edge Functions

**Choice:** Standalone Express backend on Render

**Rationale:**
- Complex OAuth flows (QuickBooks) need persistent token management
- Third-party API integrations require more control than Edge Functions allow
- Easier debugging and logging
- Can run scheduled sync jobs via Render Cron
- Team familiarity with Express patterns

**Trade-off:** Additional infrastructure to manage, but worth it for flexibility.

---

## Authentication Strategy

### Flow Overview

```
Frontend (Lovable)          Backend (Render)           Supabase
       │                          │                        │
       │ 1. User signs in         │                        │
       │   (Google OAuth)         │                        │
       │─────────────────────────────────────────────────>│
       │                          │                        │
       │<─────────────────────────────────────────────────│
       │   2. JWT token           │                        │
       │                          │                        │
       │ 3. API request           │                        │
       │   Authorization:         │                        │
       │   Bearer <token>         │                        │
       │─────────────────────────>│                        │
       │                          │                        │
       │                          │ 4. Validate via        │
       │                          │    getUser(token)      │
       │                          │───────────────────────>│
       │                          │                        │
       │                          │<───────────────────────│
       │                          │   5. Auth user data    │
       │                          │                        │
       │                          │ 6. Fetch user profile  │
       │                          │    from users table    │
       │                          │───────────────────────>│
       │                          │                        │
       │<─────────────────────────│                        │
       │   7. Response            │                        │
```

### Decision: Supabase JWT Validation (Not Custom JWT)

**Choice:** Use Supabase's `getUser()` to validate tokens

**Rationale:**
- Supabase handles JWT signature verification and expiry
- No need to manage JWT secrets in backend
- Works regardless of auth provider (Google, email/password, etc.)
- User's token creates an authenticated Supabase client that respects RLS

### Decision: User Profile in Separate Table

**Choice:** Store user profiles in `users` table, linked by `auth_id`

**Rationale:**
- Supabase Auth stores minimal data (email, auth metadata)
- We need additional fields: role, status, name, avatar
- Allows "pending" status for users awaiting approval
- RLS policies can reference user role from this table

### Auth Middleware Behavior

1. Extract token from `Authorization: Bearer <token>`
2. Create Supabase client with user's token
3. Call `getUser()` to validate (Supabase verifies signature/expiry)
4. Fetch user profile from `users` table using `auth_id`
5. **Reject if user status is "pending"**
6. Attach `req.user` (profile) and `req.supabase` (authenticated client) to request

---

## Multi-Agency Integration Pattern

### The Problem

MiD operates multiple agencies, each with their own:
- QuickBooks company (different Realm IDs)
- Potentially different ClickUp workspaces
- Separate financial data

### Decision: Single App, Multiple Connections

**Choice:** One OAuth app registration per service, multiple stored token sets

```
┌─────────────────────────────────────────────────────────────────┐
│              QuickBooks Developer App (ONE)                      │
│  Client ID: [single]     Client Secret: [single]                │
│  Redirect URI: https://api.mid.com/api/auth/quickbooks/callback │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   ┌───────────┐        ┌───────────┐        ┌───────────┐
   │ Agency A  │        │ Agency B  │        │ Agency C  │
   │ Realm:111 │        │ Realm:222 │        │ Realm:333 │
   │ Tokens:A  │        │ Tokens:B  │        │ Tokens:C  │
   └───────────┘        └───────────┘        └───────────┘
```

**Rationale:**
- Intuit allows one app to connect multiple companies
- Simpler credential management (one client ID/secret)
- Each agency admin authorizes their own QuickBooks company
- Tokens stored separately per agency

### Token Storage Pattern

**Table:** `pulse_sync_tokens`

| Column | Type | Description |
|--------|------|-------------|
| service | text (PK) | Key like `quickbooks:agency_<id>` |
| tokens | jsonb | Access token, refresh token, realm_id, expiry |
| updated_at | timestamp | Last token refresh |

**Agency Table Addition:**
- `agencies.quickbooks_realm_id` - Stores the connected QuickBooks company ID

### OAuth Flow for Multi-Agency

1. Admin initiates: `GET /api/auth/quickbooks?agencyId=abc123`
2. Backend generates auth URL with `state=agency_abc123`
3. User authorizes in QuickBooks (selects their company)
4. QuickBooks redirects to callback with `state=agency_abc123`
5. Backend extracts agency ID from state
6. Tokens stored as `quickbooks:agency_abc123`
7. Agency record updated with `quickbooks_realm_id`

---

## Third-Party Integrations

### QuickBooks Online

| Aspect | Details |
|--------|---------|
| Auth Method | OAuth 2.0 |
| Token Storage | `pulse_sync_tokens` table (per agency) |
| Token Refresh | On-demand before API calls (5-min buffer) |
| Package | `intuit-oauth` |
| Data Synced | Invoices, payments, customers |

### ClickUp

| Aspect | Details |
|--------|---------|
| Auth Method | API Token (not OAuth) |
| Token Storage | Environment variable `CLICKUP_API_TOKEN` |
| Data Synced | Tasks, time entries, folders/lists |

**Note:** If agencies have separate ClickUp workspaces, we may need to extend this to per-agency tokens similar to QuickBooks.

### HubSpot

| Aspect | Details |
|--------|---------|
| Auth Method | API Key / Private App Token |
| Token Storage | Environment variable `HUBSPOT_API_KEY` |
| Data Synced | Companies, deals |

---

## Database Patterns

### Constraint: No Service Role Key

**Lovable manages Supabase and does not expose the service role key.** This requires a hybrid approach:

1. **RLS Policies** - For user-scoped operations (reading profiles, contracts, etc.)
2. **Edge Functions** - For privileged operations (sync, OAuth tokens, cross-agency queries)

### Architecture: Hybrid RLS + Edge Functions

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Render Backend                                  │
└─────────────────────────────────────────────────────────────────────┘
                    │                           │
                    ▼                           ▼
    ┌───────────────────────────┐   ┌───────────────────────────────┐
    │   User's Supabase Client  │   │   Supabase Edge Functions     │
    │   (RLS enforced)          │   │   (service role internally)   │
    └───────────────────────────┘   └───────────────────────────────┘
                    │                           │
                    ▼                           ▼
    ┌───────────────────────────┐   ┌───────────────────────────────┐
    │  User-scoped reads:       │   │  Privileged operations:       │
    │  • Own profile            │   │  • Store OAuth tokens         │
    │  • Contracts (filtered)   │   │  • Sync data writes           │
    │  • Notes, deliverables    │   │  • Cross-agency queries       │
    └───────────────────────────┘   └───────────────────────────────┘
```

### Decision: RLS for User Operations

**Choice:** Pass user's JWT to Supabase client for user-scoped queries

**Implementation:**
```typescript
// In auth middleware
req.supabase = createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${token}` } }
});

// In route handlers - RLS filters based on user's role
const { data } = await req.supabase.from('contracts').select('*');
```

### Decision: Edge Functions for Privileged Operations

**Choice:** Call Supabase Edge Functions for operations requiring service role

Edge Functions run inside Supabase and have access to the service role key internally. The Render backend calls them via HTTP.

**Use Cases:**
- Storing/retrieving OAuth tokens (QuickBooks, etc.)
- Writing sync data (ClickUp tasks, QuickBooks invoices)
- Cross-agency queries for admin dashboards
- Any operation that needs to bypass RLS

**Implementation:**
```typescript
// Backend calls Edge Function
const response = await fetch(
  `${SUPABASE_URL}/functions/v1/store-oauth-tokens`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ agencyId, tokens }),
  }
);
```

### Required RLS Policies

For user-scoped operations:

| Table | Policy | Who |
|-------|--------|-----|
| `users` | SELECT own profile | `auth.uid() = auth_id` |
| `contracts` | SELECT | admin/team_member: all; client: via user_contract_access |
| `agencies` | SELECT | admin/team_member |
| `user_contract_access` | SELECT | all authenticated users |

**Note:** Tables like `pulse_sync_tokens` don't need user RLS policies - they're accessed only via Edge Functions.

### Edge Functions Required

| Function | Purpose | Called By |
|----------|---------|-----------|
| `store-oauth-tokens` | Store QuickBooks/OAuth tokens | OAuth callback |
| `get-oauth-tokens` | Retrieve tokens for sync | Sync operations |
| `sync-clickup-data` | Write ClickUp tasks/time | ClickUp sync |
| `sync-quickbooks-data` | Write invoices/payments | QuickBooks sync |
| `sync-hubspot-data` | Write company data | HubSpot sync |

### OAuth Callback Flow (Updated)

OAuth callbacks use Edge Functions to store tokens:

```typescript
// 1. OAuth callback receives tokens from provider
const tokens = await oauthClient.createToken(callbackUrl);

// 2. Call Edge Function to store (has service role access)
await fetch(`${SUPABASE_URL}/functions/v1/store-oauth-tokens`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    service: 'quickbooks',
    agencyId,
    tokens,
  }),
});

// 3. Redirect to frontend
res.redirect(`${FRONTEND_URL}/settings/integrations?success=true`);
```

---

## Deployment Architecture

### Development Workflow

**No local development environment.** All changes are committed directly to `main` and deployed via Render.

```
Code Changes → Push to main → Render Auto-Deploys
```

**Rationale:**
- Simplifies setup (no local Supabase, no local env management)
- Render's fast builds make iteration quick
- Single source of truth - what's on main is what's deployed

**Git Repository:** `https://github.com/tpelligrinomid/mid-app-v1.git`

### Render Configuration

| Setting | Value |
|---------|-------|
| Service Type | Web Service |
| Root Directory | `backend` |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Region | Ohio (US East) |
| Instance | Starter ($7/mo) recommended for production |

### Environment Variables

| Variable | Description | Scope |
|----------|-------------|-------|
| `SUPABASE_URL` | Supabase project URL | Required |
| `SUPABASE_ANON_KEY` | Public anon key | Required |
| `QUICKBOOKS_CLIENT_ID` | QB app client ID | Required for QB |
| `QUICKBOOKS_CLIENT_SECRET` | QB app secret | Required for QB |
| `QUICKBOOKS_REDIRECT_URI` | OAuth callback URL | Required for QB |
| `QUICKBOOKS_ENVIRONMENT` | `sandbox` or `production` | Required for QB |
| `CLICKUP_API_TOKEN` | ClickUp API token | Required for ClickUp |
| `HUBSPOT_API_KEY` | HubSpot private app token | Required for HubSpot |
| `PORT` | Server port (default 3001) | Optional |
| `FRONTEND_URL` | Lovable app URL (for CORS) | Required |

**Note:** We do NOT use `SUPABASE_SERVICE_ROLE_KEY` - Lovable manages Supabase and doesn't expose it. All operations go through authenticated user clients.

### Future: Scheduled Sync Jobs

Render Cron Jobs can trigger sync endpoints:
- `POST /api/sync/clickup` - Daily task/time sync
- `POST /api/sync/quickbooks` - Daily invoice sync

---

## API Design Conventions

### Authentication

- All routes except `/health` and `/api/auth/*/callback` require auth
- Use `Authorization: Bearer <token>` header
- Middleware attaches `req.user` and `req.supabase`

### Response Format

**Success:**
```json
{
  "contracts": [...],
  "count": 10
}
```

**Error:**
```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

### Role-Based Access

| Role | Pulse Access | Compass Access | Sync Access |
|------|--------------|----------------|-------------|
| admin | Full | All contracts | Yes |
| team_member | Full | All contracts | Yes |
| client | None | Assigned contracts only | No |

### Endpoint Patterns

| Pattern | Example | Description |
|---------|---------|-------------|
| List | `GET /api/contracts` | Returns `{ contracts: [], count: n }` |
| Detail | `GET /api/contracts/:id` | Returns `{ contract: {} }` |
| Action | `POST /api/sync/clickup` | Returns `{ success: true, ... }` |
| OAuth Start | `GET /api/auth/quickbooks?agencyId=x` | Redirects to provider |
| OAuth Callback | `GET /api/auth/quickbooks/callback` | Redirects to frontend |

---

## Open Decisions / Future Considerations

### To Be Decided

1. **ClickUp Multi-Workspace:** Do agencies have separate ClickUp workspaces? If so, extend the multi-agency pattern.

2. **Sync Frequency:** How often should scheduled syncs run? (Hourly? Daily?)

3. **Webhook Support:** Should we accept webhooks from QuickBooks/ClickUp for real-time updates?

4. **Error Monitoring:** Sentry, LogRocket, or built-in Render logging?

5. **Rate Limiting:** Do we need rate limiting on the API?

---

## Revision History

| Date | Changes |
|------|---------|
| Jan 2025 | Initial document - backend architecture, multi-agency QuickBooks |
