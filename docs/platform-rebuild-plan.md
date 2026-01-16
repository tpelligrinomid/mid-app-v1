# MiD Platform Rebuild Plan

**Marketers in Demand**
*January 2025*

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Assessment](#current-state-assessment)
3. [Platform Vision](#platform-vision)
4. [UI Shell Architecture](#ui-shell-architecture)
5. [Roles & Permissions](#roles--permissions)
6. [Backend Authentication](#backend-authentication)
7. [Module Architecture](#module-architecture)
8. [Compass Apps Framework](#compass-apps-framework)
9. [Database Schema Design](#database-schema-design)
10. [Third-Party Credentials Setup](#third-party-credentials-setup)
11. [QuickBooks Token Management](#quickbooks-token-management)
12. [Integration Sync Strategy](#integration-sync-strategy)
13. [Technology Stack](#technology-stack)
14. [Build Phases](#build-phases)
15. [Migration Strategy](#migration-strategy)
16. [Client Portal Strategy](#client-portal-strategy)
17. [Key Decisions](#key-decisions)
18. [Quick Reference: Tech Stack Summary](#quick-reference-tech-stack-summary)

---

## Executive Summary

We are rebuilding our internal tooling into a **unified, modular platform** that combines account monitoring (Pulse), strategy execution (Compass), and future capabilities (Content Management, SEO Agent) into a single system.

### The Two-View Architecture

| View | Scope | Purpose |
|------|-------|---------|
| **Pulse** | Global (Portfolio) | See all contracts, aggregate dashboards, sync monitoring, "preview as client" |
| **Compass** | Contract (Workspace) | Deep dive into one contract - notes, deliverables, and specialized apps |

**In simple terms:**
- **Pulse** answers: "How are all our accounts doing?"
- **Compass** answers: "What are we doing for this specific account?"

### Compass Apps: A Platform for Strategy Tools

Compass is more than a workspace - it's an **app platform**. We can enable specialized apps per contract:

| App | What It Does | Client Access |
|-----|--------------|---------------|
| **Content Hub** | Manage all content assets, ideas, calendar | Collaborative |
| **SEO Agent** | Keywords, rankings, competitor monitoring | View + Approve |
| **Podcast** | Episode planning, scripts, show notes | Collaborative |
| **ABM Campaigns** | Target accounts, touchpoints, engagement | Collaborative |
| **Paid Media** | Campaign performance, budget, optimization | View |
| **Events** | Webinars, conferences, promotion | Collaborative |
| **Reporting** | Automated reports and insights | View |

Apps can be **internal-only**, **client-viewable**, or **client-collaborative** - enabling true partnership with clients on strategy and execution.

### Why Rebuild vs. Refactor

The current Pulse v1 application has served us well, but has accumulated technical debt:

- Large, monolithic React components (some exceeding 170KB)
- No TypeScript (limits refactoring confidence)
- Duplicate data structures and routes
- Database schema evolved organically without cleanup
- Testing coverage below 20%

More importantly, our needs have expanded beyond what Pulse was designed for. We need:

- Modular features that can be enabled per contract
- A unified client portal experience
- AI-powered automation capabilities
- A foundation that supports future growth

**The recommendation:** Build a new platform with a clean database schema, unified backend API, and modular frontend architecture.

---

## Current State Assessment

### Pulse v1 Architecture

| Component | Technology | Status |
|-----------|------------|--------|
| Frontend | React 18 + Material-UI | Working, needs modernization |
| Backend | Node.js + Express | Working, some route duplication |
| Database | Supabase (PostgreSQL) | Schema needs refactoring |
| Auth | Supabase Auth + Google OAuth | Working well |
| Hosting | Render.com | Working well |

### Current Integrations

| Service | Purpose | Status |
|---------|---------|--------|
| ClickUp | Task and time tracking sync | Working |
| QuickBooks | Invoice and financial sync | Working |
| HubSpot | Account data sync | Working |
| Fireflies | Meeting transcripts | Partially implemented |

### Database Analysis

The current database has **50+ tables** including:

- **Core tables:** agencies, accounts, contracts, users
- **Integration tables:** 11 ClickUp tables, 5 QuickBooks tables
- **Compass tables (built, not in UI):** contract_notes, contract_deliverables, contract_assets, contract_knowledge, contract_meetings

**Key Issues:**
- Duplicate data structures (e.g., `tasks` vs `clickup_tasks`, `invoices` vs `quickbooks_invoices`)
- Inconsistent ID patterns (uuid vs bigint vs integer)
- Missing foreign key relationships
- Orphaned temporary tables
- Tables built for Compass but never exposed in UI

---

## Platform Vision

### Core Concept

A modular platform with two distinct interaction models, accessed through a **unified application shell**:

- **Pulse** = Portfolio View (global, across all contracts)
- **Compass** = Contract Workspace (scoped, one contract at a time)

This is similar to how HubSpot separates CRM (global contact/company view) from Marketing Hub (campaign-specific workspace).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MiD Platform                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  ┌─────────────┐  ┌─────────────┐                                 │  │
│  │  │   PULSE     │  │   COMPASS   │         Mode Toggle Buttons     │  │
│  │  └─────────────┘  └─────────────┘                                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─────────────┐  ┌───────────────────────────────────────────────────┐ │
│  │             │  │                                                    │ │
│  │   SIDEBAR   │  │              MAIN CONTENT AREA                    │ │
│  │   (changes  │  │                                                    │ │
│  │    based    │  │   ┌─────────────────────────────────────────┐     │ │
│  │    on mode) │  │   │  When PULSE active:                     │     │ │
│  │             │  │   │  • All contracts view                   │     │ │
│  │             │  │   │  • Global dashboards                    │     │ │
│  │             │  │   │  • Aggregate financials                 │     │ │
│  │             │  │   │  • Sync monitoring                      │     │ │
│  │             │  │   ├─────────────────────────────────────────┤     │ │
│  │             │  │   │  When COMPASS active:                   │     │ │
│  │             │  │   │  • Contract-specific views              │     │ │
│  │             │  │   │  • Notes, deliverables                  │     │ │
│  │             │  │   │  • Meetings, knowledge                  │     │ │
│  │             │  │   │  • Enabled Compass Apps                 │     │ │
│  │             │  │   └─────────────────────────────────────────┘     │ │
│  └─────────────┘  └───────────────────────────────────────────────────┘ │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                  LOVABLE (Frontend) + RENDER (Backend API)               │
├──────────────────────────────────────────────────────────────────────────┤
│                         SUPABASE (Database + Auth)                       │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            Client Portal                                  │
│         (Unified view: Pulse data + enabled Compass modules)              │
│                   Same shell, different permissions                       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Navigation Architecture

```
MiD Platform
│
├── PULSE (Global Portfolio View)
│   ├── Dashboard ─────────────── All contracts at a glance
│   ├── Contracts ─────────────── List, filter, search all contracts
│   │   └── Contract Detail ───── Single contract overview
│   │       └── "Preview as Client" ── See what client sees
│   ├── Financials ────────────── Aggregate invoices, payments, AR
│   ├── Tasks ─────────────────── All tasks (filterable by contract)
│   ├── Performance ───────────── Team/account metrics
│   └── Sync Status ───────────── Integration health monitoring
│
├── COMPASS (Contract Workspace) ← Must select contract to enter
│   ├── [Contract Selector] ───── Required before accessing workspace
│   │
│   └── Contract Workspace ────── Now scoped to selected contract
│       ├── Overview ──────────── Contract summary + module status
│       ├── Notes ─────────────── Weekly strategy notes
│       ├── Deliverables ──────── Plans, roadmaps, documents
│       ├── Meetings ──────────── Transcripts, action items
│       ├── Knowledge ─────────── AI-powered search across content
│       ├── Content (if enabled)─ Assets, ideas, calendar
│       └── SEO (if enabled) ──── Keywords, rankings, competitors
│
└── CLIENT PORTAL (External Users)
    ├── My Contracts ──────────── Contracts they have access to
    └── Contract View ─────────── Pulse data + enabled modules
```

### The HubSpot Analogy

| HubSpot | MiD Platform | Scope |
|---------|--------------|-------|
| CRM (Contacts, Companies, Deals) | Pulse | Global - see everything |
| Marketing Hub (Campaigns) | Compass | Scoped - pick a campaign/contract first |
| Sales Hub (Pipeline) | Future modules | Could be global or scoped |

### Guiding Principles

1. **Single source of truth** - One database, one API, consistent data
2. **Modular by design** - Features toggled per contract, not hardcoded
3. **Clear scope boundaries** - Pulse is global, Compass is contract-scoped
4. **Client-ready from day one** - Everything built with client visibility in mind
5. **AI-native architecture** - Knowledge storage and embeddings built into the schema

---

## UI Shell Architecture

### The Application Shell

The platform uses a **unified shell** with a mode-switching pattern. Users see one application with two distinct modes:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  HEADER                                                              │   │
│  │  ┌──────────────────┐  ┌──────────────────┐                         │   │
│  │  │   ◉ PULSE        │  │     COMPASS      │        [User Menu ▼]    │   │
│  │  │   (active)       │  │                  │                         │   │
│  │  └──────────────────┘  └──────────────────┘                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────┐  ┌───────────────────────────────────────────────────┐   │
│  │              │  │                                                    │   │
│  │   SIDEBAR    │  │                 MAIN CONTENT AREA                 │   │
│  │              │  │                                                    │   │
│  │  Navigation  │  │   Content changes based on selected sidebar item  │   │
│  │  changes     │  │                                                    │   │
│  │  based on    │  │                                                    │   │
│  │  which mode  │  │                                                    │   │
│  │  (Pulse or   │  │                                                    │   │
│  │  Compass)    │  │                                                    │   │
│  │  is active   │  │                                                    │   │
│  │              │  │                                                    │   │
│  │              │  │                                                    │   │
│  │              │  │                                                    │   │
│  └──────────────┘  └───────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Mode Toggle Behavior

The two prominent buttons at the top (Pulse / Compass) act as **mode toggles**:

| Active Mode | Sidebar Shows | Main Content | Scope |
|-------------|---------------|--------------|-------|
| **Pulse** | Dashboard, Contracts, Financials, Tasks, Performance, Sync Status | Global views across all contracts | Portfolio-wide |
| **Compass** | [Contract Selector], Overview, Notes, Deliverables, Meetings, Knowledge, Apps | Contract-specific views | Single contract |

### Pulse Mode (Active)

When Pulse is selected, the sidebar shows global navigation:

```
┌──────────────────┐
│  ◉ PULSE         │ ← Active mode indicator
├──────────────────┤
│                  │
│  📊 Dashboard    │ ← All contracts overview
│  📋 Contracts    │ ← List/search contracts
│  💰 Financials   │ ← Aggregate invoices, AR
│  ✓  Tasks        │ ← All tasks (filterable)
│  📈 Performance  │ ← Team metrics
│  🔄 Sync Status  │ ← Integration health
│                  │
│  ─────────────── │
│  👥 Users        │ ← Admin only
│  📝 Audit Log    │ ← Admin only
│                  │
└──────────────────┘
```

### Compass Mode (Active)

When Compass is selected, the user must first select a contract, then the sidebar shows contract-scoped navigation:

```
┌──────────────────┐
│  ◉ COMPASS       │ ← Active mode indicator
├──────────────────┤
│                  │
│  Acme Corp Q1 ▼  │ ← Contract selector dropdown
│                  │
│  ─────────────── │
│                  │
│  🏠 Overview     │ ← Contract summary
│  📝 Notes        │ ← Weekly strategy notes
│  📦 Deliverables │ ← Plans, roadmaps
│  🎤 Meetings     │ ← Transcripts, action items
│  🔍 Knowledge    │ ← AI-powered search
│                  │
│  ─────────────── │
│  APPS            │
│  📰 Content Hub  │ ← If enabled
│  📈 SEO Agent    │ ← If enabled
│  🎙️ Podcast      │ ← If enabled
│                  │
└──────────────────┘
```

### Mode Switching Flow

```
User in Pulse Dashboard
         │
         │ Clicks "Compass" button
         ▼
┌────────────────────────┐
│  Contract Selector     │ ← Modal or sidebar prompt
│  appears               │
│                        │
│  "Select a contract    │
│   to open Compass"     │
│                        │
│  [Search contracts...] │
│  • Acme Corp Q1        │
│  • Beta Inc Q4         │
│  • Gamma LLC Annual    │
└────────────────────────┘
         │
         │ User selects contract
         ▼
Now in Compass mode for "Acme Corp Q1"
- Sidebar updates to Compass navigation
- Main content shows contract Overview
- All views now scoped to this contract
         │
         │ User clicks "Pulse" button
         ▼
Back to Pulse mode
- Sidebar reverts to Pulse navigation
- Main content shows Dashboard (global)
- Contract context is cleared
```

### Design Guidelines for Lovable

When building in Lovable, implement these UI patterns:

1. **Shell Component**
   - Fixed header with mode toggle buttons
   - Sidebar component that accepts different navigation items
   - Main content area with router outlet

2. **Mode State**
   - Store active mode in app state (Zustand)
   - Store selected contract ID when in Compass mode
   - Clear contract context when switching to Pulse

3. **Sidebar Component**
   - Accept navigation items as props
   - Render based on current mode
   - Highlight active item
   - Support collapsible sections (for Apps)

4. **Route Structure**
   ```
   /pulse/dashboard
   /pulse/contracts
   /pulse/contracts/:id
   /pulse/financials
   /pulse/tasks
   /pulse/performance
   /pulse/sync

   /compass/:contractId/overview
   /compass/:contractId/notes
   /compass/:contractId/deliverables
   /compass/:contractId/meetings
   /compass/:contractId/knowledge
   /compass/:contractId/content  (if enabled)
   /compass/:contractId/seo      (if enabled)
   ```

5. **Visual Design**
   - Mode buttons should be prominent, clearly showing which is active
   - Use consistent iconography in sidebar
   - Compass mode should show contract name prominently
   - Consider color coding: Pulse = primary color, Compass = secondary color

---

## Roles & Permissions

### User Roles

The platform has three user roles with distinct access levels:

| Role | Description | Scope |
|------|-------------|-------|
| **admin** | MiD leadership/operations | Full platform access |
| **team_member** | MiD strategists and team | Most platform access |
| **client** | External client users | Read-only, limited to assigned contracts |

### Permission Matrix

| Action | Admin | Team Member | Client |
|--------|-------|-------------|--------|
| **Pulse Access** | ✓ Full | ✓ Full | ✗ None |
| **Compass Access** | ✓ All contracts | ✓ All contracts | ✓ Assigned contracts only |
| **View all contracts** | ✓ | ✓ | ✗ |
| **View assigned contracts** | ✓ | ✓ | ✓ |
| **Create/edit contracts** | ✓ | ✗ | ✗ |
| **Create/edit notes** | ✓ | ✓ | ✗ |
| **Create/edit deliverables** | ✓ | ✓ | ✗ |
| **View deliverables** | ✓ | ✓ | ✓ (if Compass enabled) |
| **View tasks** | ✓ | ✓ | ✓ (non-internal only) |
| **View financials** | ✓ | ✓ | ✓ |
| **Trigger manual sync** | ✓ | ✓ | ✗ |
| **Add admin users** | ✓ | ✗ | ✗ |
| **Add team member users** | ✓ | ✗ | ✗ |
| **Invite client users** | ✓ | ✓ | ✗ |
| **Manage user permissions** | ✓ | ✗ | ✗ |

### Client Access Model

Clients access the platform through the **same application shell** but with restricted visibility:

1. **No Pulse access** - Clients never see the global portfolio view
2. **Compass only** - Clients land directly in Compass mode
3. **Contract-scoped** - Clients only see contracts granted via `user_contract_access`
4. **Read-only by default** - Clients view data but don't write (except where Compass Apps allow collaboration)

```
Client logs in
      │
      ▼
┌─────────────────────────────┐
│  Do they have access to     │
│  multiple contracts?        │
└─────────────────────────────┘
      │
      ├── Yes ──► Show contract selector
      │           │
      │           ▼
      │    Select contract → Compass workspace
      │
      └── No (single contract) ──► Go directly to Compass workspace
```

### "Preview as Client" Feature

Admins and team members can preview what a client sees for any contract:

- Activates client-view mode for the selected contract
- Hides internal-only tasks
- Shows only client-visible Compass modules
- Useful for QA before inviting clients

---

## Backend Authentication

### Authentication Flow

The backend validates requests using Supabase JWT tokens. This approach is auth-provider agnostic - it works the same whether the user signed in with Google OAuth or email/password.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Lovable   │     │   Render    │     │  Supabase   │
│  Frontend   │     │   Backend   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │ 1. User signs in  │                   │
       │   (Google/Email)  │                   │
       │──────────────────────────────────────>│
       │                   │                   │
       │<──────────────────────────────────────│
       │   2. JWT token    │                   │
       │                   │                   │
       │ 3. API request    │                   │
       │   Authorization:  │                   │
       │   Bearer <token>  │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │ 4. Validate token │
       │                   │   getUser(token)  │
       │                   │──────────────────>│
       │                   │                   │
       │                   │<──────────────────│
       │                   │   5. User data    │
       │                   │                   │
       │                   │ 6. Fetch profile  │
       │                   │   from users      │
       │                   │──────────────────>│
       │                   │                   │
       │<──────────────────│                   │
       │   7. Response     │                   │
       │                   │                   │
```

### Middleware Implementation

The backend authentication middleware:

1. **Extracts token** from `Authorization: Bearer <token>` header
2. **Creates Supabase client** with the user's token (not service role key)
3. **Validates via `getUser()`** - Supabase verifies signature, expiration, revocation
4. **Fetches user profile** from `users` table using `auth_id`
5. **Checks role** - Rejects users with `status: 'pending'`
6. **Attaches to request** - `req.user` (profile) and `req.supabase` (authenticated client)

```typescript
// Pseudocode for auth middleware
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  // Validate token with Supabase (no service key needed)
  const userClient = createSupabaseClient(token);
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error) return res.status(401).json({ error: 'Invalid token' });

  // Fetch profile from users table
  const { data: profile } = await userClient
    .from('users')
    .select('*')
    .eq('auth_id', user.id)
    .single();

  if (!profile) return res.status(404).json({ error: 'User not found' });
  if (profile.status === 'pending') {
    return res.status(403).json({ error: 'Account pending authorization' });
  }

  // Attach to request for use in route handlers
  req.user = { id: user.id, email: user.email, ...profile };
  req.supabase = userClient;  // For RLS-protected queries
  next();
}
```

### Why This Works

- **No service role key needed** for token validation
- **RLS enforced** - The authenticated Supabase client respects Row Level Security
- **Provider agnostic** - Works with any Supabase auth method (Google, email, etc.)
- **Profile-based roles** - Role stored in `users` table, not in JWT claims

---

## Module Architecture

### Module Overview

| Module | Scope | Purpose | Default State |
|--------|-------|---------|---------------|
| **Pulse** | Global (portfolio) | Account monitoring, financials, task sync | Always enabled |
| **Compass** | Contract (workspace) | Strategy documentation, deliverables, knowledge | Per contract |
| **Content** | Contract (workspace) | Asset management, competitor analysis, content ideation | Per contract |
| **SEO Agent** | Contract (workspace) | Keyword tracking, competitor monitoring, automation | Per contract |

---

### Pulse Module (Global Portfolio View)

> **Scope:** Global - view and manage ALL contracts from one place

**What it does:**
- Syncs tasks and time entries from ClickUp
- Syncs invoices, credit memos, and payments from QuickBooks
- Syncs account data from HubSpot
- Provides operational dashboards for account health
- Tracks contract financials and points balance
- **"Preview as Client"** - see exactly what a client sees for any contract

**Key views (all global/aggregate):**
- **Dashboard** - All contracts overview, health indicators, alerts
- **Contracts List** - Browse, filter, search all contracts
- **Contract Detail** - Single contract summary (links to Compass workspace)
- **Financials** - Aggregate AR, invoices, payments across all contracts
- **Tasks** - All tasks across all contracts (filterable)
- **Performance** - Team metrics, account manager workload
- **Sync Status** - Integration health, last sync times, errors

**This is always enabled** - it's the operational foundation and entry point.

**User flow:**
```
User logs in → Lands in Pulse Dashboard → Sees all contracts
                    │
                    ├── Click contract → View detail in Pulse
                    │                        │
                    │                        └── "Open in Compass" → Enter workspace
                    │
                    └── Click "Compass" nav → Select contract → Enter workspace
```

---

### Compass Module (Contract Workspace)

> **Scope:** Contract-specific - must select a contract before entering

**What it does:**
- Weekly strategist notes (ABM, Paid, Content, Web, General)
- Deliverable tracking with version history
- Meeting transcript storage and analysis
- Knowledge base with AI-powered search
- Automated status report generation

**Key views (all scoped to selected contract):**
- **Overview** - Contract summary + which modules are enabled
- **Notes** - Weekly strategy notes with structured input
- **Deliverables** - Plans, roadmaps, research with version history
- **Meetings** - Transcripts, summaries, action items
- **Knowledge** - AI-powered search across all contract content
- **Reports** - Generate and view status reports

**Enabled per contract** based on service level.

**User flow:**
```
User clicks "Compass" → Contract selector appears → User picks contract
                                                          │
                                                          ▼
                                              Now in [Contract Name] Workspace
                                                          │
                                              ┌───────────┴───────────┐
                                              │ All navigation now    │
                                              │ scoped to this        │
                                              │ contract until user   │
                                              │ switches or exits     │
                                              └───────────────────────┘
```

---

## Compass Apps Framework

Compass is not just a workspace - it's an **app platform**. Beyond the core strategy features (Notes, Deliverables, Meetings, Knowledge), we can enable specialized **Compass Apps** for each contract.

### What Are Compass Apps?

Compass Apps are modular tools that:
- **Unlock per contract** based on service level or client needs
- **Live within the Compass workspace** - always scoped to the selected contract
- **Can be internal-only or client-collaborative** - some apps are just for the MiD team, others invite client participation
- **Are AI-powered** - leverage account context, notes, and knowledge for intelligent assistance
- **Integrate with core Compass** - share data with notes, deliverables, and knowledge base

### App Visibility Model

| Visibility | Description | Example |
|------------|-------------|---------|
| **Internal Only** | Only MiD team can access | Competitive intelligence, internal planning |
| **Client Collaborative** | Both MiD team and client work together | Podcast planning, content calendar approval |
| **Client View** | Client can see but not edit | SEO rankings, performance dashboards |

### Planned Compass Apps

#### Content Hub App
> **Visibility:** Client Collaborative

Centralized content management for all asset types.

**Capabilities:**
- Asset library (blog posts, ebooks, whitepapers, videos, podcasts, webinars)
- Competitor content monitoring and crawling
- AI-generated content ideas based on account context
- Content calendar with approval workflows
- Performance tracking per asset

**Client collaboration:**
- Review and approve content ideas
- View content calendar
- Access final deliverables
- Provide feedback on drafts

---

#### SEO Agent App
> **Visibility:** Client View + Some Collaboration

Keyword tracking, competitor monitoring, and SEO automation.

**Capabilities:**
- Keyword tracking and ranking history
- Competitor blog and content monitoring
- Competitor event tracking (webinars, conferences, launches)
- AI-powered SEO recommendations
- Automated reporting and alerts

**Client collaboration:**
- View keyword rankings and trends
- See competitor insights
- Review and approve SEO recommendations

---

#### Podcast App
> **Visibility:** Client Collaborative

End-to-end podcast production management for client podcasts.

**Capabilities:**
- Episode planning and scheduling
- AI-generated topic and title suggestions based on account strategy
- Guest research and outreach tracking
- Interview prep and script generation
- Show notes and transcript management
- Distribution tracking

**Client collaboration:**
- Brainstorm episode topics together
- Review and approve episode plans
- Prepare for interviews with AI-generated talking points
- Review show notes before publication

---

#### ABM Campaign App
> **Visibility:** Client Collaborative

Account-based marketing campaign planning and execution.

**Capabilities:**
- Target account list management
- Campaign planning and orchestration
- Multi-channel touchpoint tracking
- Personalization content generation
- Engagement scoring and analytics

**Client collaboration:**
- Review target account lists
- Approve campaign strategies
- View engagement metrics
- Provide account intelligence

---

#### Paid Media App
> **Visibility:** Client View + Reporting

Paid advertising management and optimization.

**Capabilities:**
- Campaign performance dashboards
- Budget tracking and pacing
- AI-powered optimization recommendations
- Creative asset management
- A/B test tracking

**Client collaboration:**
- View performance dashboards
- Review budget allocation
- Approve major strategy changes

---

#### Events App
> **Visibility:** Client Collaborative

Event planning and promotion for webinars, conferences, and virtual events.

**Capabilities:**
- Event calendar and planning
- Promotion campaign coordination
- Registration and attendee tracking
- Post-event follow-up automation
- Content repurposing from events

**Client collaboration:**
- Plan events together
- Review promotion strategy
- Access attendee data
- Approve follow-up sequences

---

#### Reporting App
> **Visibility:** Client View

Automated reporting and insights delivery.

**Capabilities:**
- Customizable report templates
- Scheduled report generation
- Multi-channel performance aggregation
- AI-generated insights and recommendations
- Historical trend analysis

**Client collaboration:**
- View and download reports
- Request custom reports
- Access historical data

---

### Future App Ideas

| App | Purpose | Visibility |
|-----|---------|------------|
| **Social Media** | Social content planning and scheduling | Client Collaborative |
| **Email Marketing** | Email campaign management | Client Collaborative |
| **Sales Enablement** | Sales collateral and battlecards | Client Collaborative |
| **Competitive Intel** | Deep competitive analysis | Internal Only |
| **Account Health** | Predictive account health scoring | Internal Only |
| **Creative Studio** | AI-assisted design and copy | Client Collaborative |

---

### How Apps Appear in the Platform

```
┌─────────────────────────────────────────────────────────────────────┐
│                           MiD PLATFORM                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PULSE (Always On - Global Portfolio View)                          │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  Dashboard │ Contracts │ Financials │ Tasks │ Sync Status  │     │
│  └────────────────────────────────────────────────────────────┘     │
│                              │                                       │
│                              │ "Open in Compass"                     │
│                              ▼                                       │
│  COMPASS WORKSPACE (Per Contract)                                   │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  Contract: [Acme Corp - Q1 2025]              [Switch ▼]   │     │
│  ├────────────────────────────────────────────────────────────┤     │
│  │                                                            │     │
│  │  CORE COMPASS (always available)                           │     │
│  │  ┌──────────────────────────────────────────────────────┐  │     │
│  │  │ Overview │ Notes │ Deliverables │ Meetings │ Search  │  │     │
│  │  └──────────────────────────────────────────────────────┘  │     │
│  │                                                            │     │
│  │  COMPASS APPS (enabled per contract)                       │     │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │     │
│  │  │ Content │ │   SEO   │ │ Podcast │ │   ABM   │  ...    │     │
│  │  │   Hub   │ │  Agent  │ │   App   │ │Campaign │         │     │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘         │     │
│  │       ✓           ✓           ✓           ○               │     │
│  │   (enabled)   (enabled)   (enabled)   (not enabled)       │     │
│  │                                                            │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

CLIENT PORTAL (What the client sees)
┌────────────────────────────────────────────────────────────────────┐
│  My Contracts: [Acme Corp - Q1 2025]                               │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  FROM PULSE (always visible)                                       │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │ Tasks │ Invoices │ Points Balance │ Deliverables          │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  FROM COMPASS APPS (based on what's enabled + visibility)          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                              │
│  │ Content │ │   SEO   │ │ Podcast │  ← Client can collaborate    │
│  │Calendar │ │Rankings │ │Planning │    on these apps              │
│  └─────────┘ └─────────┘ └─────────┘                              │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Database Support for Apps

```sql
-- Contract modules table (expanded for apps)
CREATE TABLE contract_modules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    module_type text NOT NULL,        -- 'core' or 'app'
    module_name text NOT NULL,        -- 'compass', 'content_hub', 'seo', 'podcast', etc.
    enabled boolean DEFAULT false,
    client_visible boolean DEFAULT false,  -- Can clients see this app?
    client_collaborative boolean DEFAULT false,  -- Can clients interact?
    enabled_at timestamptz,
    config jsonb,                      -- App-specific settings
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, module_name)
);
```

---

## Database Schema Design

### Two Systems, One Database

The database is organized into **two major systems** that share a common foundation:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SUPABASE DATABASE                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    CORE TABLES (Shared)                      │    │
│  │                                                              │    │
│  │  organizations • accounts • contracts • users                │    │
│  │  user_contract_access • user_invitations • contract_modules  │    │
│  │  audit_logs • system_config                                  │    │
│  │                                                              │    │
│  │  → These tables are accessed by BOTH Pulse and Compass       │    │
│  │  → They form the foundation of the entire platform           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│              ┌───────────────┴───────────────┐                      │
│              │                               │                       │
│              ▼                               ▼                       │
│  ┌───────────────────────┐      ┌───────────────────────┐          │
│  │    PULSE TABLES       │      │   COMPASS TABLES      │          │
│  │    (pulse_*)          │      │   (compass_*)         │          │
│  │                       │      │                       │          │
│  │  pulse_tasks          │      │  compass_notes        │          │
│  │  pulse_time_entries   │      │  compass_deliverables │          │
│  │  pulse_invoices       │      │  compass_assets       │          │
│  │  pulse_credit_memos   │      │  compass_meetings     │          │
│  │  pulse_payments       │      │  compass_knowledge    │          │
│  │  pulse_sync_tokens    │      │  compass_reports      │          │
│  │  pulse_sync_logs      │      │                       │          │
│  │                       │      │                       │          │
│  │  → Synced data from   │      │  → Strategy and       │          │
│  │    external systems   │      │    execution data     │          │
│  │  → ClickUp, QuickBooks│      │  → Notes, deliverables│          │
│  │    HubSpot            │      │    meetings, AI       │          │
│  └───────────────────────┘      └───────────────────────┘          │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                 FUTURE MODULE TABLES                         │    │
│  │                                                              │    │
│  │  content_*  (Content Hub App)                                │    │
│  │  seo_*      (SEO Agent App)                                  │    │
│  │  podcast_*  (Podcast App) - future                           │    │
│  │  abm_*      (ABM Campaign App) - future                      │    │
│  │                                                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Structure Matters

**The core advantage:** Both Pulse and Compass share the same foundation tables. This means:

1. **Contracts are the central entity** - Everything links back to contracts
2. **Users have unified access** - One user system across both applications
3. **Data flows naturally** - A task synced in Pulse is automatically available when viewing in Compass
4. **Modules are additive** - Enabling Compass for a contract doesn't duplicate data

**Table Prefixes:**
- `pulse_*` - Tables that store data synced from external systems (ClickUp, QuickBooks, HubSpot)
- `compass_*` - Tables that store strategy and execution data (notes, deliverables, meetings)
- `content_*` - Future tables for Content Hub app
- `seo_*` - Future tables for SEO Agent app
- No prefix - Core/shared tables that both systems use

### Design Principles

1. **Consistent naming:** `{module}_{entity}` pattern (e.g., `pulse_tasks`, `compass_notes`)
2. **UUID primary keys:** All tables use `uuid DEFAULT gen_random_uuid()`
3. **Proper foreign keys:** Explicit relationships, no string-based joins
4. **Timestamps everywhere:** `created_at` and `updated_at` on all tables
5. **Soft deletes where needed:** `deleted_at` instead of hard deletes for audit trail
6. **JSONB for flexibility:** Raw API responses and extensible metadata
7. **Contract-centric:** Most tables reference `contracts(contract_id)` as the primary relationship

### Core Tables (Shared by Pulse and Compass)

```sql
-- Organizations (renamed from agencies)
CREATE TABLE organizations (
    organization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    quickbooks_realm_id text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Accounts
CREATE TABLE accounts (
    account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid REFERENCES organizations(organization_id),
    name text NOT NULL,
    status text NOT NULL,
    hubspot_account_id text,
    hubspot_owner_id text,
    industry text,
    website text,
    -- Additional fields...
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Contracts
CREATE TABLE contracts (
    contract_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid REFERENCES accounts(account_id),
    external_id text UNIQUE, -- For external references (e.g., "MID-2025-001")
    contract_name text NOT NULL,
    contract_status text NOT NULL, -- 'pending', 'active', 'canceled', 'inactive'
    contract_type text NOT NULL, -- 'recurring', 'project'
    engagement_type text, -- 'strategic', 'tactical'
    -- Financial fields
    amount numeric, -- Monthly recurring revenue
    payment_type text, -- 'invoice', 'credit_card'
    monthly_points_allotment integer, -- For points burden calculation
    -- Date fields
    contract_start_date date NOT NULL,
    contract_end_date date,
    contract_renewal_date date,
    -- Assignment fields (references ClickUp users)
    account_manager text REFERENCES pulse_clickup_users(id),
    team_manager text REFERENCES pulse_clickup_users(id),
    -- Integration fields
    clickup_folder_id text,
    quickbooks_customer_id text,
    quickbooks_business_unit_id text,
    -- Display settings
    customer_display_type text, -- 'points', 'hours', 'none'
    hosting boolean DEFAULT false, -- Hosting-only contracts (excluded from some views)
    priority text, -- 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'
    -- Timestamps
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Contract Modules (feature toggles)
CREATE TABLE contract_modules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    module_name text NOT NULL, -- 'pulse', 'compass', 'content', 'seo'
    enabled boolean DEFAULT false,
    enabled_at timestamptz,
    config jsonb, -- Module-specific settings
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, module_name)
);
```

### User Tables

```sql
-- User profiles (for all users: admins, team members, clients)
CREATE TABLE users (
    user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id uuid UNIQUE, -- Links to Supabase auth.users
    email text NOT NULL UNIQUE,
    full_name text,
    role text NOT NULL, -- 'admin', 'team_member', 'client'
    status text NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'inactive'
    company_name text, -- For client users
    clickup_user_id text, -- For MiD team members, links to pulse_clickup_users
    invited_at timestamptz,
    invited_by uuid REFERENCES users(user_id),
    activated_at timestamptz,
    last_login timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- User contract access (for clients)
CREATE TABLE user_contract_access (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(user_id),
    contract_id uuid REFERENCES contracts(contract_id),
    access_level text DEFAULT 'view', -- 'view', 'edit', 'admin'
    granted_at timestamptz DEFAULT now(),
    granted_by uuid REFERENCES users(user_id),
    UNIQUE(user_id, contract_id)
);

-- User invitations
CREATE TABLE user_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    role text NOT NULL DEFAULT 'client',
    invited_by uuid REFERENCES users(user_id),
    token text,
    expires_at timestamptz,
    status text DEFAULT 'pending',
    created_at timestamptz DEFAULT now()
);
```

### Pulse Module Tables

```sql
-- ClickUp users (synced from ClickUp for manager assignment)
CREATE TABLE pulse_clickup_users (
    id text PRIMARY KEY, -- ClickUp user ID (not uuid, uses their ID)
    username text,
    email text,
    full_name text,
    profile_picture text,
    user_type text, -- 'member', 'owner', 'guest'
    is_assignable boolean DEFAULT true, -- Only member/owner should be true
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Sync state tracking (for incremental syncs)
CREATE TABLE pulse_sync_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL, -- 'clickup', 'quickbooks', 'hubspot'
    entity_type text NOT NULL, -- 'tasks', 'time_entries', 'invoices', 'users'
    sync_mode text NOT NULL DEFAULT 'incremental', -- 'full', 'incremental'
    status text DEFAULT 'idle', -- 'idle', 'running', 'failed'
    last_sync_at timestamptz,
    last_successful_sync_at timestamptz,
    last_full_sync_at timestamptz,
    last_modified_cursor timestamptz, -- For incremental: "changes since this time"
    next_full_sync_at timestamptz, -- Scheduled weekly full refresh
    records_processed integer,
    error_message text,
    retry_count integer DEFAULT 0,
    config jsonb, -- Sync-specific settings
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(service, entity_type)
);

-- Tasks (synced from ClickUp)
CREATE TABLE pulse_tasks (
    task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    clickup_task_id text UNIQUE NOT NULL,
    parent_task_id uuid REFERENCES pulse_tasks(task_id),
    name text NOT NULL,
    description text,
    status text,
    points numeric,
    due_date timestamptz,
    start_date timestamptz,
    date_done timestamptz,
    -- Flags
    is_internal_only boolean DEFAULT false,
    is_growth_task boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    -- ClickUp metadata
    clickup_list_id text,
    clickup_folder_id text,
    clickup_space_id text,
    assignees jsonb,
    custom_fields jsonb,
    raw_data jsonb,
    -- Sync tracking
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Time entries (synced from ClickUp)
CREATE TABLE pulse_time_entries (
    entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid REFERENCES pulse_tasks(task_id),
    clickup_entry_id text UNIQUE NOT NULL,
    user_id text,
    duration_ms integer NOT NULL,
    start_date timestamptz NOT NULL,
    end_date timestamptz,
    description text,
    billable boolean DEFAULT true,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- Invoices (synced from QuickBooks)
CREATE TABLE pulse_invoices (
    invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    quickbooks_id text NOT NULL,
    quickbooks_realm_id text NOT NULL,
    doc_number text,
    amount numeric NOT NULL,
    balance numeric,
    status text,
    invoice_date date,
    due_date date,
    points numeric,
    hours numeric,
    invoice_link text,
    memo text,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(quickbooks_id, quickbooks_realm_id)
);

-- Credit memos (synced from QuickBooks)
CREATE TABLE pulse_credit_memos (
    credit_memo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    quickbooks_id text NOT NULL,
    quickbooks_realm_id text NOT NULL,
    doc_number text,
    amount numeric,
    remaining_credit numeric,
    credit_date date,
    points numeric,
    memo text,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    UNIQUE(quickbooks_id, quickbooks_realm_id)
);

-- Payments (synced from QuickBooks)
CREATE TABLE pulse_payments (
    payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    quickbooks_id text NOT NULL,
    quickbooks_realm_id text NOT NULL,
    amount numeric NOT NULL,
    payment_date date,
    payment_method text,
    linked_invoices jsonb,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    UNIQUE(quickbooks_id, quickbooks_realm_id)
);

-- Sync tokens (OAuth for integrations)
CREATE TABLE pulse_sync_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL, -- 'clickup', 'quickbooks', 'hubspot'
    identifier text NOT NULL, -- realm_id, workspace_id, etc.
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamptz,
    is_active boolean DEFAULT true,
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(service, identifier)
);

-- Sync logs
CREATE TABLE pulse_sync_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL,
    entity_type text NOT NULL,
    status text NOT NULL,
    records_processed integer,
    error_message text,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz DEFAULT now()
);
```

### Compass Module Tables

```sql
-- Strategy notes
CREATE TABLE compass_notes (
    note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    note_type text NOT NULL, -- 'weekly', 'abm', 'paid', 'content', 'web'
    title text NOT NULL,
    content_raw text,
    content_structured jsonb, -- Normalized/parsed content
    note_date date NOT NULL,
    week_number integer,
    year integer,
    status text DEFAULT 'draft', -- 'draft', 'published', 'archived'
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Deliverables
CREATE TABLE compass_deliverables (
    deliverable_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    title text NOT NULL,
    description text,
    deliverable_type text, -- 'plan', 'roadmap', 'research', 'presentation', 'other'
    status text DEFAULT 'in_progress', -- 'planned', 'in_progress', 'review', 'delivered', 'archived'
    version text DEFAULT '1.0',
    drive_url text, -- Link to Google Drive
    due_date date,
    delivered_date date,
    tags text[],
    metadata jsonb,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Deliverable versions (history)
CREATE TABLE compass_deliverable_versions (
    version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deliverable_id uuid REFERENCES compass_deliverables(deliverable_id),
    version_number text NOT NULL,
    drive_url text,
    change_summary text,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now()
);

-- Assets (files, images, documents)
CREATE TABLE compass_assets (
    asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    asset_type text NOT NULL, -- 'image', 'document', 'video', 'audio', 'other'
    title text NOT NULL,
    description text,
    file_name text,
    file_path text, -- Supabase storage path
    file_size_bytes bigint,
    mime_type text,
    external_url text,
    thumbnail_url text,
    tags text[],
    metadata jsonb,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Meetings (from Fireflies or other sources)
CREATE TABLE compass_meetings (
    meeting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    meeting_date timestamptz NOT NULL,
    source text DEFAULT 'fireflies',
    title text,
    participants text[],
    duration_seconds integer,
    recording_url text,
    transcript jsonb,
    summary text,
    action_items jsonb,
    sentiment jsonb,
    raw_metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Knowledge chunks (for AI/RAG)
CREATE TABLE compass_knowledge (
    chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    source_type text NOT NULL, -- 'note', 'deliverable', 'meeting', 'document'
    source_id uuid, -- Reference to source record
    title text,
    content text NOT NULL,
    chunk_index integer DEFAULT 0,
    embedding vector(1536), -- OpenAI embeddings
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Status reports
CREATE TABLE compass_reports (
    report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    report_type text NOT NULL, -- 'weekly', 'monthly', 'leadership'
    period_start date,
    period_end date,
    subject text,
    content_html text,
    content_text text,
    payload jsonb, -- Structured report data
    recipients text[],
    send_status text DEFAULT 'draft', -- 'draft', 'queued', 'sent', 'failed'
    sent_at timestamptz,
    created_at timestamptz DEFAULT now()
);
```

### Content Module Tables (Future)

```sql
-- Content assets (separate from Compass assets - client-facing content)
CREATE TABLE content_assets (
    asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    asset_type text NOT NULL,
    title text NOT NULL,
    description text,
    file_path text,
    external_url text,
    status text DEFAULT 'active',
    tags text[],
    metadata jsonb,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Competitor tracking configuration
CREATE TABLE content_competitors (
    competitor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    name text NOT NULL,
    domain text,
    blog_url text,
    social_urls jsonb,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- Crawled competitor content
CREATE TABLE content_crawl_results (
    crawl_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id uuid REFERENCES content_competitors(competitor_id),
    url text NOT NULL,
    title text,
    content_preview text,
    content_full text,
    published_date date,
    crawled_at timestamptz DEFAULT now(),
    metadata jsonb
);

-- Content ideas
CREATE TABLE content_ideas (
    idea_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    title text NOT NULL,
    description text,
    content_type text, -- 'blog', 'social', 'email', 'whitepaper', etc.
    source text, -- 'ai_generated', 'competitor_inspired', 'manual'
    source_reference uuid, -- Link to crawl_result or other source
    status text DEFAULT 'idea', -- 'idea', 'approved', 'in_progress', 'published', 'rejected'
    priority integer,
    target_date date,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Content calendar
CREATE TABLE content_calendar (
    entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    idea_id uuid REFERENCES content_ideas(idea_id),
    title text NOT NULL,
    content_type text,
    scheduled_date date,
    status text DEFAULT 'scheduled',
    assignee uuid REFERENCES users(user_id),
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

### SEO Module Tables (Future)

```sql
-- Tracked keywords
CREATE TABLE seo_keywords (
    keyword_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    keyword text NOT NULL,
    search_volume integer,
    difficulty integer,
    intent text, -- 'informational', 'commercial', 'transactional', 'navigational'
    is_primary boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, keyword)
);

-- Ranking history
CREATE TABLE seo_rankings (
    ranking_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword_id uuid REFERENCES seo_keywords(keyword_id),
    rank_position integer,
    url text,
    check_date date NOT NULL,
    search_engine text DEFAULT 'google',
    location text,
    created_at timestamptz DEFAULT now()
);

-- SEO competitors
CREATE TABLE seo_competitors (
    competitor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    domain text NOT NULL,
    name text,
    blog_url text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, domain)
);

-- Competitor blog posts
CREATE TABLE seo_competitor_posts (
    post_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id uuid REFERENCES seo_competitors(competitor_id),
    url text NOT NULL UNIQUE,
    title text,
    published_date date,
    word_count integer,
    topics text[],
    summary text,
    crawled_at timestamptz DEFAULT now()
);

-- Competitor events
CREATE TABLE seo_competitor_events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id uuid REFERENCES seo_competitors(competitor_id),
    event_type text, -- 'webinar', 'conference', 'product_launch', etc.
    title text NOT NULL,
    event_date date,
    url text,
    description text,
    discovered_at timestamptz DEFAULT now()
);

-- AI recommendations
CREATE TABLE seo_recommendations (
    recommendation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    recommendation_type text, -- 'content_gap', 'keyword_opportunity', 'technical', 'competitor_insight'
    title text NOT NULL,
    description text,
    priority text DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    status text DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'completed'
    source_data jsonb,
    created_at timestamptz DEFAULT now(),
    resolved_at timestamptz
);
```

### Audit & System Tables

```sql
-- Audit logs
CREATE TABLE audit_logs (
    log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    action text NOT NULL, -- 'insert', 'update', 'delete'
    old_values jsonb,
    new_values jsonb,
    changed_by uuid REFERENCES users(user_id),
    changed_at timestamptz DEFAULT now(),
    ip_address text,
    user_agent text
);

-- System configuration
CREATE TABLE system_config (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    description text,
    updated_at timestamptz DEFAULT now(),
    updated_by uuid REFERENCES users(user_id)
);
```

### Materialized Views (Points System)

The platform uses **materialized views** to calculate complex points metrics. These views are refreshed after sync operations complete.

#### Points Calculation Logic

| Metric | Source | Calculation |
|--------|--------|-------------|
| `points_purchased` | QuickBooks invoices | Sum of points from all invoices for contract |
| `points_credited` | QuickBooks credit memos | Sum of points from credit memos |
| `points_delivered` | ClickUp tasks (status='delivered') | Sum of points from delivered tasks |
| `points_working` | ClickUp tasks (status='working') | Sum of points from in-progress tasks |
| `points_balance` | Calculated | `points_purchased + points_credited - points_delivered` |
| `points_burden` | Calculated | `points_balance - (1.5 × monthly_points_allotment)` |
| `delivery_status` | Calculated | `'on-track'` if burden ≤ 0, else `'off-track'` |

#### Key Materialized Views

```sql
-- Contract points summary (refreshed after ClickUp/QuickBooks sync)
CREATE MATERIALIZED VIEW contract_points_summary AS
SELECT
    c.contract_id,
    c.contract_name,
    c.monthly_points_allotment,
    COALESCE(inv.points_purchased, 0) as points_purchased,
    COALESCE(cm.points_credited, 0) as points_credited,
    COALESCE(delivered.points_delivered, 0) as points_delivered,
    COALESCE(working.points_working, 0) as points_working,
    (COALESCE(inv.points_purchased, 0) + COALESCE(cm.points_credited, 0)
     - COALESCE(delivered.points_delivered, 0)) as points_balance,
    (COALESCE(inv.points_purchased, 0) + COALESCE(cm.points_credited, 0)
     - COALESCE(delivered.points_delivered, 0)
     - (1.5 * COALESCE(c.monthly_points_allotment, 0))) as points_burden
FROM contracts c
LEFT JOIN (
    SELECT contract_id, SUM(points) as points_purchased
    FROM pulse_invoices GROUP BY contract_id
) inv ON c.contract_id = inv.contract_id
LEFT JOIN (
    SELECT contract_id, SUM(points) as points_credited
    FROM pulse_credit_memos GROUP BY contract_id
) cm ON c.contract_id = cm.contract_id
LEFT JOIN (
    SELECT contract_id, SUM(points) as points_delivered
    FROM pulse_tasks WHERE status = 'delivered' GROUP BY contract_id
) delivered ON c.contract_id = delivered.contract_id
LEFT JOIN (
    SELECT contract_id, SUM(points) as points_working
    FROM pulse_tasks WHERE status = 'working' GROUP BY contract_id
) working ON c.contract_id = working.contract_id
WHERE c.contract_status = 'active' AND c.hosting = false;

-- Contract performance view (used by dashboards)
CREATE MATERIALIZED VIEW contract_performance_view AS
SELECT
    c.contract_id,
    c.contract_name,
    c.external_id as contract_number,
    c.contract_type,
    c.engagement_type,
    c.priority,
    c.account_manager,
    c.team_manager,
    c.contract_status,
    c.amount as mrr,
    cps.*,
    CASE WHEN cps.points_burden <= 0 THEN 'on-track' ELSE 'off-track' END as delivery_status,
    am.username as account_manager_name,
    tm.username as team_manager_name
FROM contracts c
LEFT JOIN contract_points_summary cps ON c.contract_id = cps.contract_id
LEFT JOIN pulse_clickup_users am ON c.account_manager = am.id
LEFT JOIN pulse_clickup_users tm ON c.team_manager = tm.id
WHERE c.contract_status = 'active' AND c.hosting = false;
```

#### View Refresh Strategy

| View | Refresh Trigger | Frequency |
|------|-----------------|-----------|
| `contract_points_summary` | After ClickUp or QuickBooks sync | Every 15 min (incremental) or on-demand |
| `contract_performance_view` | After any sync completes | Every 15 min or on-demand |
| `contract_monthly_points_view` | After ClickUp sync | Every 15 min or on-demand |

```sql
-- Refresh views (called by backend after sync)
REFRESH MATERIALIZED VIEW CONCURRENTLY contract_points_summary;
REFRESH MATERIALIZED VIEW CONCURRENTLY contract_performance_view;
```

> **Note:** Using `CONCURRENTLY` allows queries to continue during refresh (requires unique index on each view).

---

## Third-Party Credentials Setup

### Credentials Strategy

When setting up the new platform, use this approach for API keys and OAuth apps:

| Service | Type | Action | Reason |
|---------|------|--------|--------|
| **Supabase** | Database + Auth | **New project** | Clean schema, no legacy tables |
| **ClickUp** | API Token | **Reuse existing** | Simple API token, no OAuth complexity |
| **QuickBooks** | OAuth 2.0 | **New OAuth app** | Different redirect URIs, clean separation |
| **HubSpot** | API Key | **Reuse existing** | API keys aren't tied to redirect URIs |
| **Fireflies** | API Key | **Reuse existing** | Just an API key |
| **OpenAI** | API Key | **Reuse existing** | Just an API key |

### Why New OAuth App for QuickBooks?

QuickBooks OAuth apps are registered with specific **redirect URIs**. The new platform will have a different URL:

```
Old Pulse v1:     https://pulse.marketersindemand.com/callback/quickbooks
New Platform:     https://[your-backend].onrender.com/api/auth/quickbooks/callback
```

Creating a new OAuth app provides:
- Clean separation during parallel operation
- No risk of breaking Pulse v1 while building
- Can sunset old app when migration is complete

### OAuth App Registration (QuickBooks Only)

#### QuickBooks OAuth App
1. Go to Intuit Developer Portal (developer.intuit.com)
2. Create new app (Production, not Sandbox for real data)
3. Set redirect URI to your new backend callback URL
4. Store Client ID and Client Secret in environment variables
5. Select required scopes: `com.intuit.quickbooks.accounting`

### ClickUp API Token

ClickUp uses a simple **personal API token** - no OAuth flow required:

1. Go to ClickUp Settings → Apps → API Token
2. Generate or copy existing token
3. Store in environment variables
4. Token doesn't expire (unless manually revoked)

This is much simpler than OAuth - just include the token in API request headers:
```
Authorization: pk_12345678_ABCDEFGHIJKLMNOP
```

### Environment Variables (Backend)

```env
# Supabase (new project)
SUPABASE_URL=https://[project-id].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Only for admin operations

# ClickUp (API token - reuse existing)
CLICKUP_API_TOKEN=pk_12345678_...  # Personal API token, no expiration

# QuickBooks (new OAuth app)
QUICKBOOKS_CLIENT_ID=...
QUICKBOOKS_CLIENT_SECRET=...
QUICKBOOKS_REDIRECT_URI=https://[backend-url]/api/auth/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=production  # or 'sandbox' for testing

# HubSpot (reuse)
HUBSPOT_API_KEY=...

# Fireflies (reuse)
FIREFLIES_API_KEY=...

# OpenAI (reuse)
OPENAI_API_KEY=...
```

### Re-Authorization After Setup

Once the new backend is deployed:

1. **ClickUp**: No authorization needed - just add the API token to environment variables
2. **QuickBooks**: Admin visits `/api/auth/quickbooks` → Authorizes company → Tokens stored in `pulse_sync_tokens`

QuickBooks is a one-time OAuth authorization per company.

---

## QuickBooks Token Management

### The Token Refresh Problem

QuickBooks OAuth has strict token expiration:

| Token Type | Expires After | Action Required |
|------------|---------------|-----------------|
| Access Token | **1 hour** | Must refresh before expiry |
| Refresh Token | **100 days** | Must use within 100 days or re-authorize |

If you don't refresh the access token before it expires, API calls will fail with 401. If the refresh token expires, the user must re-authorize the entire connection.

### Current Approach (Pulse v1)

A background worker runs every ~15 minutes to proactively refresh tokens before they expire. This works but:
- Adds infrastructure complexity
- Runs even when not needed
- Can still fail if worker is down

### Recommended Approach (New Platform)

Use **on-demand refresh with the Intuit OAuth library**. The `intuit-oauth` Node.js package can handle token refresh automatically:

```typescript
import OAuthClient from 'intuit-oauth';

class QuickBooksService {
  private oauthClient: OAuthClient;

  constructor() {
    this.oauthClient = new OAuthClient({
      clientId: process.env.QUICKBOOKS_CLIENT_ID,
      clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
      environment: process.env.QUICKBOOKS_ENVIRONMENT,
      redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
    });
  }

  async getValidToken(realmId: string): Promise<string> {
    // Load tokens from database
    const tokens = await this.loadTokens(realmId);

    // Set tokens on OAuth client
    this.oauthClient.setToken({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: 'Bearer',
      expires_in: tokens.expires_in,
      x_refresh_token_expires_in: tokens.refresh_token_expires_in,
    });

    // Check if access token is expired or expiring soon (within 5 min)
    if (this.oauthClient.isAccessTokenValid()) {
      return tokens.access_token;
    }

    // Refresh the token
    const newTokens = await this.oauthClient.refresh();

    // Save new tokens to database
    await this.saveTokens(realmId, newTokens.getJson());

    return newTokens.getJson().access_token;
  }

  private async loadTokens(realmId: string) {
    const { data } = await supabase
      .from('pulse_sync_tokens')
      .select('*')
      .eq('service', 'quickbooks')
      .eq('identifier', realmId)
      .single();
    return data;
  }

  private async saveTokens(realmId: string, tokens: any) {
    await supabase
      .from('pulse_sync_tokens')
      .upsert({
        service: 'quickbooks',
        identifier: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        metadata: {
          refresh_token_expires_at: new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString(),
        },
        updated_at: new Date().toISOString(),
      });
  }
}
```

### Benefits of On-Demand Refresh

| Aspect | Background Worker | On-Demand Refresh |
|--------|-------------------|-------------------|
| Complexity | Separate process to manage | Built into API calls |
| Reliability | Can fail silently | Fails visibly on API call |
| Efficiency | Runs even when not needed | Only refreshes when needed |
| Token freshness | May have stale tokens between runs | Always fresh before API call |

### Refresh Token Expiry (Rolling Tokens)

QuickBooks uses **rolling refresh tokens**:

- Refresh tokens expire after 100 days **if unused**
- Every time you refresh, you get a **new refresh token** with a fresh 100-day window
- As long as syncs run regularly, the token never expires

```
Day 0:   Get refresh token (expires Day 100)
Day 1:   Use refresh token → NEW refresh token (expires Day 101)
Day 2:   Use refresh token → NEW refresh token (expires Day 102)
...continues indefinitely with active usage
```

**In practice:** With regular syncing (every 15 minutes), the refresh token is constantly renewed. Pulse v1 has run for over a year without needing re-authorization.

**When re-auth IS needed:**
- Integration stopped syncing for 100+ days
- All refresh attempts failed for extended period
- Someone manually disconnected in QuickBooks

**Recommendation:** No need to build complex expiry monitoring. Just ensure:
1. Sync runs regularly (which it will)
2. Failed syncs retry and log errors
3. Dashboard shows last successful sync time (if it's been days, investigate)

### ClickUp Token Management

ClickUp uses a **personal API token** that does not expire. No refresh logic needed:

- Token is static (doesn't expire unless manually revoked)
- Just include in request headers: `Authorization: pk_...`
- If token stops working, generate a new one in ClickUp settings

This is significantly simpler than QuickBooks OAuth.

---

## Integration Sync Strategy

### Sync Architecture

The backend handles all integration syncs via scheduled jobs and manual triggers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     RENDER BACKEND                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  ClickUp Sync   │  │ QuickBooks Sync │  │  HubSpot Sync   │  │
│  │    Service      │  │    Service      │  │    Service      │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│           └────────────────────┼────────────────────┘           │
│                                │                                 │
│                                ▼                                 │
│                    ┌─────────────────────┐                      │
│                    │   Sync Orchestrator │                      │
│                    │   (handles retries, │                      │
│                    │    logging, state)  │                      │
│                    └─────────────────────┘                      │
│                                │                                 │
└────────────────────────────────┼────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────┐
                    │      SUPABASE       │
                    │  pulse_* tables     │
                    │  pulse_sync_state   │
                    │  pulse_sync_logs    │
                    └─────────────────────┘
```

### Sync Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Full** | Fetch all records, replace existing | Weekly refresh, initial setup, data repair |
| **Incremental** | Fetch only records modified since last sync | Regular updates (every 15 min) |
| **Manual** | User-triggered via UI | On-demand refresh, troubleshooting |

### ClickUp Sync Schedule

| Schedule | Mode | Description |
|----------|------|-------------|
| Every 15 minutes (weekdays) | Incremental | Fetch tasks modified since last run |
| Every hour (weekends) | Incremental | Lower frequency on weekends |
| Weekly (Sunday night) | Full | Complete refresh of all tasks |

### Failure Handling

1. **Retry Logic**
   - Failed syncs retry up to 3 times with exponential backoff
   - `pulse_sync_state.retry_count` tracks attempts
   - After max retries, status set to 'failed'

2. **Logging**
   - All sync operations logged to `pulse_sync_logs`
   - Captures: start time, end time, records processed, errors

3. **Alerting** (Future)
   - Notify admins when sync fails after retries
   - Dashboard shows sync health status

```sql
-- Example: Log a sync operation
INSERT INTO pulse_sync_logs (service, entity_type, status, records_processed, started_at, completed_at, error_message)
VALUES ('clickup', 'tasks', 'success', 150, now() - interval '30 seconds', now(), null);

-- Example: Update sync state after successful run
UPDATE pulse_sync_state
SET
    status = 'idle',
    last_sync_at = now(),
    last_successful_sync_at = now(),
    last_modified_cursor = now(),
    records_processed = 150,
    retry_count = 0,
    error_message = null,
    updated_at = now()
WHERE service = 'clickup' AND entity_type = 'tasks';
```

---

## Technology Stack

### Architecture Overview

This platform uses a **proven, stable stack** that separates concerns clearly:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Lovable)                          │
│                                                                      │
│  • Built entirely in Lovable                                        │
│  • React + TypeScript + Tailwind CSS (generated)                    │
│  • Native Supabase integration for auth                             │
│  • Connects to custom backend API for business logic                │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
┌───────────────────────────────┐  ┌───────────────────────────────┐
│     SUPABASE (Database)       │  │   RENDER (Custom Backend)     │
│                               │  │                               │
│  • PostgreSQL database        │  │  • Node.js + TypeScript       │
│  • Auth (Google OAuth +       │  │  • Express.js API             │
│    email/password)            │  │  • Integration sync services  │
│  • Row Level Security (RLS)   │  │  • Business logic             │
│  • File storage               │  │  • Cron jobs for syncing      │
│  • Realtime subscriptions     │  │                               │
└───────────────────────────────┘  └───────────────────────────────┘
```

### Frontend: Lovable

| Component | Technology | Notes |
|-----------|------------|-------|
| **Builder** | Lovable | All UI built in Lovable - rapid development, proven workflow |
| **Framework** | React + TypeScript | Generated by Lovable, fully typed |
| **Styling** | Tailwind CSS | Consistent with Lovable output |
| **State** | React Query + Zustand | Server state (React Query) + local state (Zustand) |
| **Routing** | React Router | Generated by Lovable |

**Authentication in Lovable:**
- Uses Lovable's **native Supabase integration**
- Google OAuth configured in Supabase Dashboard
- Email/password authentication for clients
- Session management handled by Supabase JS client
- Protected routes based on user role

### Backend: Render

| Component | Technology | Notes |
|-----------|------------|-------|
| **Runtime** | Node.js 20+ | LTS version |
| **Framework** | Express.js | RESTful API |
| **Language** | TypeScript | Type safety from day one |
| **Hosting** | Render.com | Web service with auto-deploy from GitHub |

**What the backend handles:**
- Integration sync services (ClickUp, QuickBooks, HubSpot)
- Complex business logic and aggregations
- Scheduled jobs (cron) for data syncing
- OAuth token management for third-party services
- API endpoints that require service-level database access

### Database: Supabase

| Component | Technology | Notes |
|-----------|------------|-------|
| **Database** | PostgreSQL | Managed by Supabase |
| **Auth** | Supabase Auth | Google OAuth + email/password |
| **Storage** | Supabase Storage | For file uploads and assets |
| **Realtime** | Supabase Realtime | Live updates where needed |
| **Security** | Row Level Security | Fine-grained access control |

### Integrations

| Service | Purpose | Auth Method | Managed By |
|---------|---------|-------------|------------|
| ClickUp | Tasks, time tracking | OAuth 2.0 | Backend |
| QuickBooks | Invoices, payments | OAuth 2.0 | Backend |
| HubSpot | Account data | API Key | Backend |
| Fireflies | Meeting transcripts | API Key | Backend |
| OpenAI | Embeddings, AI features | API Key | Backend |

### Infrastructure Summary

| Layer | Service | Purpose |
|-------|---------|---------|
| Frontend | Lovable → Deployed to Lovable hosting | User interface |
| Backend API | Render.com Web Service | Business logic, integrations |
| Database | Supabase | Data storage, auth, realtime |
| Auth | Supabase Auth (via Lovable native integration) | User authentication |
| File Storage | Supabase Storage | Documents, assets |
| Cron Jobs | Render Cron Jobs | Scheduled sync operations |

---

## Build Phases

### Phase 0: Foundation (Week 1-2)

**Objective:** Set up infrastructure and core schema

- [ ] Create new Supabase project
- [ ] Implement core schema (organizations, accounts, contracts, users)
- [ ] Set up contract_modules table
- [ ] Configure Supabase Auth (Google OAuth, email/password)
- [ ] Set up new backend project (TypeScript, Express)
- [ ] Deploy backend to Render
- [ ] Implement core API routes (auth, contracts, accounts)
- [ ] Test authentication flow end-to-end

**Deliverable:** Working API with auth and core CRUD operations

### Phase 1: Pulse Module (Week 3-5)

**Objective:** Rebuild Pulse functionality with new architecture

- [ ] Implement Pulse schema tables
- [ ] Port ClickUp sync service (preserve working logic)
- [ ] Port QuickBooks sync service
- [ ] Port HubSpot sync service
- [ ] Implement Pulse API routes
- [ ] Build Pulse frontend in Lovable
  - [ ] Dashboard view
  - [ ] Contract list and detail
  - [ ] Task views
  - [ ] Invoice/financial views
  - [ ] Sync status
- [ ] Test sync operations
- [ ] User acceptance testing

**Deliverable:** Fully functional Pulse replacement

### Phase 2: Data Migration (Week 5-6)

**Objective:** Migrate data from old system

- [ ] Write migration scripts for core data
- [ ] Migrate organizations/agencies
- [ ] Migrate accounts
- [ ] Migrate contracts (with new external_id mapping)
- [ ] Migrate users and invitations
- [ ] Migrate user_contract_access
- [ ] Re-sync integrations (ClickUp, QuickBooks, HubSpot)
- [ ] Validate data integrity
- [ ] Run parallel systems for validation

**Deliverable:** All data migrated, both systems running

### Phase 3: Client Portal (Week 6-7)

**Objective:** Build unified client experience

- [ ] Build client portal frontend in Lovable
  - [ ] Client dashboard
  - [ ] Task view (filtered for client)
  - [ ] Financial view (invoices, payments)
  - [ ] Deliverables view (when Compass enabled)
- [ ] Implement client-specific API permissions
- [ ] Test with sample client accounts
- [ ] Client user acceptance testing

**Deliverable:** Working client portal

### Phase 4: Compass Module (Week 8-10)

**Objective:** Build strategy workspace

- [ ] Implement Compass schema tables
- [ ] Implement Compass API routes
- [ ] Build Compass frontend in Lovable
  - [ ] Strategy dashboard
  - [ ] Weekly notes editor
  - [ ] Deliverables manager
  - [ ] Meeting viewer
  - [ ] Knowledge search (basic)
- [ ] Implement module toggle (enable Compass per contract)
- [ ] Update client portal for Compass visibility

**Deliverable:** Working Compass module

### Phase 5: AI Features (Week 10-12)

**Objective:** Enable AI-powered capabilities

- [ ] Set up OpenAI integration
- [ ] Implement embedding generation for knowledge
- [ ] Build vector search for knowledge base
- [ ] Implement AI summarization for notes/meetings
- [ ] Build report generation features
- [ ] Test AI features with real data

**Deliverable:** AI-powered search and summarization

### Phase 6: Cutover & Sunset (Week 12-13)

**Objective:** Complete migration

- [ ] Final data sync from old system
- [ ] DNS/domain cutover
- [ ] User communication and training
- [ ] Monitor for issues
- [ ] Sunset old Pulse v1
- [ ] Archive old database

**Deliverable:** New platform live, old system retired

### Future Phases

**Content Module**
- Asset management
- Competitor crawling
- Content ideation
- Content calendar

**SEO Agent Module**
- Keyword tracking
- Competitor monitoring
- Ranking history
- AI recommendations

---

## Migration Strategy

### Approach: Parallel Run with Cutover

```
Week 1-5:  Build new system
              │
Week 5-6:  Migrate data ─────► Run both systems in parallel
              │                        │
Week 6-12: Continue building      Validate new system
              │                        │
Week 12:   ───────────────────► Cutover to new system
              │
Week 13:   Sunset old Pulse v1
```

### Data Migration Details

| Source Table | Target Table | Notes |
|--------------|--------------|-------|
| agencies | organizations | Rename, clean data |
| accounts | accounts | Direct migration |
| contracts | contracts | Map to new schema |
| user_profiles | users | Consolidate with auth |
| user_invitations | user_invitations | Direct migration |
| user_contract_access | user_contract_access | Direct migration |
| clickup_tasks | pulse_tasks | Re-sync recommended |
| quickbooks_invoices | pulse_invoices | Re-sync recommended |
| contract_notes | compass_notes | Direct migration |
| contract_deliverables | compass_deliverables | Direct migration |

### User Migration

- Supabase Auth users need to be created in new project
- Option 1: Invite all users to re-register (cleanest)
- Option 2: Export/import auth users (complex)
- Option 3: Same Supabase project, new schema (keeps users)

**Recommendation:** Use same Supabase project if possible, or invite users to new system with clear communication.

---

## Client Portal Strategy

### Access Model

Clients see a unified view based on:
1. Their `user_contract_access` records (which contracts they can see)
2. The `contract_modules` settings (which modules are enabled)

### Visibility Matrix

| Data Type | Always Visible | Compass Enabled | Content Enabled | SEO Enabled |
|-----------|----------------|-----------------|-----------------|-------------|
| Contract summary | ✓ | ✓ | ✓ | ✓ |
| Tasks (non-internal) | ✓ | ✓ | ✓ | ✓ |
| Invoices | ✓ | ✓ | ✓ | ✓ |
| Points balance | ✓ | ✓ | ✓ | ✓ |
| Deliverables | - | ✓ | ✓ | ✓ |
| Status reports | - | ✓ | ✓ | ✓ |
| Content assets | - | - | ✓ | - |
| Content calendar | - | - | ✓ | - |
| SEO rankings | - | - | - | ✓ |
| SEO recommendations | - | - | - | ✓ |

### Client Portal Features

1. **Dashboard** - Overview of all accessible contracts
2. **Contract Detail** - Tasks, financials, deliverables (if enabled)
3. **Documents** - Access to shared files and deliverables
4. **Reports** - View generated status reports
5. **Notifications** - Updates on tasks, deliverables

---

## Key Decisions

### Decisions Needed Before Starting

| Decision | Options | Recommendation |
|----------|---------|----------------|
| **Same or new Supabase project?** | Same project (keep users) vs New project (clean start) | New project for clean schema, manage user migration |
| **Frontend framework for internal tools?** | Lovable vs React rebuild | Lovable (faster, proven) |
| **TypeScript for backend?** | Yes vs No | Yes (type safety critical for this scale) |
| **Module enable/disable approach?** | Database flag vs Feature flag service | Database flag (simpler, sufficient) |
| **AI provider?** | OpenAI vs Anthropic vs Both | OpenAI for embeddings, evaluate for generation |

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Run parallel systems, validate thoroughly |
| User disruption | Clear communication, training, gradual rollout |
| Integration failures | Port proven sync logic, extensive testing |
| Scope creep | Define MVP clearly, phase additional features |
| Timeline slip | Time-box each phase, cut scope if needed |

---

## Success Metrics

### Phase 1 Success (Pulse Rebuild)
- [ ] All existing Pulse features working
- [ ] Sync operations running reliably
- [ ] Performance equal or better than old system
- [ ] Zero data loss

### Phase 2 Success (Client Portal)
- [ ] Clients can log in and view their contracts
- [ ] Task and financial data visible
- [ ] No reported usability issues

### Phase 3 Success (Compass)
- [ ] Strategists can create weekly notes
- [ ] Deliverables tracked with versions
- [ ] Knowledge search returns relevant results

### Overall Success
- [ ] Old Pulse v1 sunset
- [ ] All users migrated
- [ ] No critical bugs in production
- [ ] Team adoption of new workflows

---

## Appendix: API Route Structure

```
/api
├── /auth
│   ├── POST /login
│   ├── POST /logout
│   ├── POST /register
│   └── POST /reset-password
│
├── /users
│   ├── GET /me
│   ├── GET /
│   ├── POST /
│   ├── PUT /:id
│   └── DELETE /:id
│
├── /organizations
│   ├── GET /
│   ├── POST /
│   ├── GET /:id
│   └── PUT /:id
│
├── /accounts
│   ├── GET /
│   ├── POST /
│   ├── GET /:id
│   └── PUT /:id
│
├── /contracts
│   ├── GET /
│   ├── POST /
│   ├── GET /:id
│   ├── PUT /:id
│   ├── GET /:id/modules
│   └── PUT /:id/modules/:module
│
├── /pulse
│   ├── /tasks
│   │   ├── GET /
│   │   └── GET /:contractId
│   ├── /invoices
│   │   ├── GET /
│   │   └── GET /:contractId
│   ├── /sync
│   │   ├── POST /clickup
│   │   ├── POST /quickbooks
│   │   └── POST /hubspot
│   └── /dashboard
│       └── GET /:contractId
│
├── /compass
│   ├── /notes
│   │   ├── GET /:contractId
│   │   ├── POST /
│   │   ├── PUT /:id
│   │   └── DELETE /:id
│   ├── /deliverables
│   │   ├── GET /:contractId
│   │   ├── POST /
│   │   ├── PUT /:id
│   │   └── GET /:id/versions
│   ├── /knowledge
│   │   ├── POST /index
│   │   └── GET /search
│   └── /reports
│       ├── GET /:contractId
│       └── POST /generate
│
├── /content (future)
│   ├── /assets
│   ├── /competitors
│   ├── /ideas
│   └── /calendar
│
└── /seo (future)
    ├── /keywords
    ├── /rankings
    ├── /competitors
    └── /recommendations
```

---

*Document created: January 2025*
*Last updated: January 2026*

---

## Quick Reference: Tech Stack Summary

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | Lovable | UI development and hosting |
| **Frontend Framework** | React + TypeScript + Tailwind | Generated by Lovable |
| **Authentication** | Supabase Auth (via Lovable native integration) | Google OAuth + email/password |
| **Database** | Supabase (PostgreSQL) | Data storage with RLS |
| **Backend API** | Node.js + TypeScript + Express | Business logic, integrations |
| **Backend Hosting** | Render.com | API deployment |
| **File Storage** | Supabase Storage | Documents and assets |
| **Integrations** | ClickUp, QuickBooks, HubSpot, Fireflies | External data sync |

**Database Table Prefixes:**
- Core tables (no prefix): `organizations`, `accounts`, `contracts`, `users`
- Pulse tables: `pulse_tasks`, `pulse_invoices`, `pulse_sync_logs`, etc.
- Compass tables: `compass_notes`, `compass_deliverables`, `compass_meetings`, etc.
- Future modules: `content_*`, `seo_*`, `podcast_*`, etc.
