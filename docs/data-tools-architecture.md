# Data Tools Architecture — SEO, Paid, Reporting

How client marketing data reaches Compass chat (Ask Compass) and the MiD MCP. Decided 2026-10-17. Order of work: **SEO (Nightwatch) first, then paid (direct ad platforms).**

## Three layers, one job each

| Layer | Job | Not its job |
|---|---|---|
| **Databox** | Cross-channel **reporting metrics**: GA4, ad spend/conversions totals, custom datasets. The "how did we do this month" numbers | Rank history; ad-level detail or changes |
| **Nightwatch** | **SEO**: daily keyword rankings with 3-year history, AI-search visibility (ChatGPT, Claude, Gemini, Perplexity, AI Overviews), competitors | Traffic/conversions (Databox via GA4) |
| **Ad platforms direct** (Google Ads, Meta, LinkedIn) | **Depth and actions**: campaign/ad/keyword detail, search terms, creatives; later **changes** (budgets, pausing) | Reporting totals (Databox stays the source of truth) |

Supporting: **DataForSEO** for on-demand research (volumes, SERP snapshots, competitor gaps — already in Compass chat), **Google Search Console** for free 16-month query history.

**Single source for reporting totals:** when Databox and a platform disagree (time zones, attribution windows), reports use **Databox**. Platforms are for drill-down and actions.

The paused in-house rank tracker (`docs/spec-search-visibility-tracking.md`, migration 020) is **superseded by Nightwatch** for rank and AI-visibility tracking. Keep only the GSC ingest idea.

## Shared foundations (build once)

1. **`contract_integrations` table** instead of a column per provider: `contract_id`, `provider` (`databox`, `nightwatch`, `google_ads`, `meta_ads`, `linkedin_ads`, `gsc`), `external_id` (account / project / customer id), `label`, `status`, `connected_by`, `connected_at`. Migrate `contracts.databox_account_id` into it (keep the column until callers move). One settings screen per contract: "what's connected".
2. **One tool framework** used by both Compass chat and the MCP: a runner per provider (like `DataboxToolRunner`, `SeoToolRunner`), registered in both places.
3. **Scoping rules (same as MCP backlog B5), for every provider:** `contract_id` required; check the contract under the caller's RLS first; resolve the external account/project **server-side** from `contract_integrations` — tools have **no account/project input**; no mapping → explicit error, never a fallback; audit log records the contract.
4. **Auth per provider type:** Databox and Nightwatch use an agency API key (backend env). Ad platforms use OAuth (Google Ads manager account + developer token, Meta Business system user, LinkedIn ad-account access) with tokens stored/refreshed like QuickBooks (`pulse_sync_tokens`).
5. **Writes** (ad platforms only): read-only first; then approval step + audit before any change.

## Nightwatch — plan

**Plan:** Professional (€159/mo: 2,500 keywords, 25 sites, 150 AI prompts, API) to start; Agency (€399/mo: 7,500 keywords, 100 sites) if volume grows. 14-day trial first.

**API** (`https://api.nightwatch.io/api/v1`, `access_token` query param — <https://apidocs.nightwatch.io>): URLs (Nightwatch's "projects"), Keywords, Keyword results (**daily history**: `GET /urls/{url_id}/keywords/{keyword_id}/results?time_start=YYYY-MM-DD&time_end=YYYY-MM-DD` → position, result_url, organic / places / local-pack positions), Competitors, Data series, Data stats, SERPs.

**Trial checks (before committing):**
1. Keyword results return full history for the window requested.
2. Whether API keys can be scoped to a project (likely account-wide → backend-only, never handed to users).
3. AI-visibility data is available through the API (not documented on the keyword-results page).
4. Rate limits for daily use across all SEO clients.

**Build (after the trial checks):**
1. `contract_integrations` + migrate Databox; map each SEO contract to its Nightwatch URL id.
2. `NightwatchToolRunner` (backend): `get_rankings` (current positions for the contract's keywords, filters: keyword/tag/top-N), `get_ranking_history` (series per keyword for a window), `get_ranking_movers` (biggest gains/losses between two dates), `get_competitor_rankings`, `get_ai_visibility` (if available).
3. Register in Compass chat (guidance: rankings/history → Nightwatch; volumes/research → DataForSEO) and in the MCP (contract-scoped, per rules above).
4. Contract settings: pick the Nightwatch URL for the contract (list from the API).
5. Test against real trial projects; then the release note.

**Open from trial:** which clients get tracked first, keywords per client, and who owns keyword lists (strategist per account).
