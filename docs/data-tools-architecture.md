# Data Tools Architecture — SEO, Paid, Reporting

How client marketing data reaches Compass chat (Ask Compass) and the MiD MCP. Decided 2026-10-17. Order of work: **SEO (Nightwatch) first, then paid (direct ad platforms).**

## Three layers, one job each

| Layer | Job | Not its job |
|---|---|---|
| **Databox** | Cross-channel **reporting metrics**: GA4, ad spend/conversions totals, custom datasets. The "how did we do this month" numbers | Rank history; ad-level detail or changes |
| **Nightwatch** | **SEO**: daily keyword rankings with 3-year history, AI-search visibility (ChatGPT, Claude, Gemini, Perplexity, AI Overviews), competitors | Traffic/conversions (Databox via GA4) |
| **Ad platforms direct** (Google Ads, Meta, LinkedIn) | **Depth and actions**: campaign/ad/keyword detail, search terms, creatives; later **changes** (budgets, pausing) | Reporting totals (Databox stays the source of truth) |

Supporting: **DataForSEO** for on-demand research (volumes, SERP snapshots, competitor gaps — already in Compass chat). **Google Search Console** is already connected in Databox, so it comes through the Databox layer — no separate GSC integration.

**Single source for reporting totals:** when Databox and a platform disagree (time zones, attribution windows), reports use **Databox**. Platforms are for drill-down and actions.

The paused in-house rank tracker (`docs/spec-search-visibility-tracking.md`, migration 020) is **superseded by Nightwatch** for rank and AI-visibility tracking (and its GSC ingest by Databox's GSC connection).

## Shared foundations (build once)

1. **`contract_integrations` table** instead of a column per provider: `contract_id`, `provider` (`databox`, `nightwatch`, `google_ads`, `meta_ads`, `linkedin_ads`), `external_id` (account / project / customer id), `label`, `status`, `connected_by`, `connected_at`. Migrate `contracts.databox_account_id` into it (keep the column until callers move). One settings screen per contract: "what's connected".
2. **One tool framework** used by both Compass chat and the MCP: a runner per provider (like `DataboxToolRunner`, `SeoToolRunner`), registered in both places.
3. **Scoping rules (same as MCP backlog B5), for every provider:** `contract_id` required; check the contract under the caller's RLS first; resolve the external account/project **server-side** from `contract_integrations` — tools have **no account/project input**; no mapping → explicit error, never a fallback; audit log records the contract.
4. **Agency-level connections, per-contract picks (every provider works like Databox).** Clients share their accounts to MiD's own business accounts; we connect **once per provider at the agency level**, then each contract picks its account from a dropdown:
   | Provider | One-time agency connection | Per-contract pick |
   |---|---|---|
   | Databox | Agency API key | Databox account |
   | Nightwatch | Agency API key | Nightwatch URL (project) |
   | Google Ads | MiD's **MCC** (one OAuth + developer token; calls use the MCC as login customer) | Client customer id under the MCC |
   | Meta | MiD's **Business Manager** (system-user token) | Client ad account shared to the BM |
   | LinkedIn | MiD's **Campaign Manager** access (one agency OAuth) | Client ad account MiD can access |
   No per-client sign-in. Agency tokens are stored and refreshed in the background like QuickBooks (`pulse_sync_tokens`). A client account becomes pickable as soon as it's shared to MiD's MCC / Business Manager / Campaign Manager.
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

### Status 2026-10-17 — built and live (backend `1af7dcb`, `83a5a77`; frontend `4a282f9`)

- **Read tools** (REST API): `get_seo_rankings`, `get_seo_ranking_history`, `get_seo_movers`, `get_seo_competitors`.
- **Management tools** (Nightwatch **MCP**, `https://mcp.nightwatch.io/mcp`, streamable HTTP): `add_seo_keywords`, `remove_seo_keywords`, `tag_seo_keywords`, `manage_seo_competitor` (two-step: preview, then `confirm=true` only after the user agrees), plus read-only `get_seo_serp` (full SERP incl. AI Overview citations), `suggest_seo_keywords`, `suggest_ai_prompts`.
- Available in Compass chat / Ask Compass (when the contract has a Nightwatch site) and the MiD MCP (contract-scoped; MCP calls audited).
- Contract settings: "Nightwatch site (SEO rankings)" picker; stored in `contract_integrations`.

**Gotchas learned:**
- One agency key (`NIGHTWATCH_API_KEY`) serves both REST (`access_token` query param) and MCP. The MCP wants it as **`x-auth-token: Bearer <key>`** — with the standard `Authorization` header it lists tools but refuses calls ("API token is required"). The SSE endpoint (`/sse`) is retired (404).
- Cloudflare blocks requests without a normal `User-Agent` (error 1010).
- REST `/user` returns the account's API token and a Google OAuth token — never proxy it.
- "Position" = best across result types (local pack, AI Overview, snippets); "organic position" can be far lower (e.g. 3 vs 33). Tools always show both.
- **Not available via API or MCP:** AI prompt (LLM) tracking setup and results — `add_keywords` only supports google/youtube/places/bing/yahoo/duckduckgo. Prompts are set up in the Nightwatch app (Settings → AI Tracking); `suggest_ai_prompts` helps choose them. Ask Nightwatch support for an endpoint.
- Not exposed (deliberately): `delete_url`, group management, `list_urls`/`list_groups` (cross-client). Site creation (`create_url`) is a candidate next step for no-login client setup.
