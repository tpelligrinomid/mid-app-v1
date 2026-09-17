# Spec: Search Visibility Tracking in Content Ops

**Type:** New Content Ops sub-module — keyword + prompt list management, periodic data collection, trends reporting
**Status:** Spec — ready for implementation
**Audience:** Three repos: **MiD App v1** (this repo, the backend), **Lovable** (frontend), **Master Marketer** (DataForSEO orchestration)

Tracks a curated set of **keywords** and **AI prompts** per contract, collects position and visibility data on a configurable cadence, and reports progress over time. Supersedes Phases 1–2 of `content-intelligence-engine.md`, which assumed a different collection layer. The ideation engine in Phases 3–5 of that doc is unchanged and sits downstream of these tables.

**Vendor position:** DataForSEO only. MM already holds the credentials and a working client in `src/lib/dataforseo/`. Its **AI Optimization API** (LLM Responses across ChatGPT, Claude, Gemini, Perplexity; brand mentions; citations) covers prompt tracking on the same account, same billing, same client code. Google Search Console is free and unlimited. No new subscription, and cost scales with keywords tracked rather than with client count.

---

## Work split — who builds what

| | Backend (this repo) | Lovable (frontend) | Master Marketer |
|---|---|---|---|
| **Schema** | Migration `020_search_visibility.sql` — 8 tables + 1 rollup | — | — |
| **Tracked list CRUD** | `/api/compass/content/queries/*` | Keyword & prompt list management UI | — |
| **Discovery triage** | `/api/compass/content/discoveries/*` | Review queue UI | — |
| **Cadence config** | `/api/compass/content/tracking-config` | Settings panel | — |
| **Collection cron** | `POST /api/cron/search-visibility` — due-query scheduler | — | — |
| **SERP ranks** | Typed client wrapper | — | `POST /api/v1/seo/rank-batch` |
| **GSC ingest** | Shared-account client + pull + trailing re-pull | Grant-access instructions + property picker (`sites.list`) | — |
| **Prompt sampling** | Sampler, mention detection, aggregation | — | `POST /api/v1/seo/llm-responses` |
| **Rollup refresh** | Post-run recompute of `content_query_current` | — | — |
| **Trends endpoints** | Series + summary endpoints | — | — |
| **Visualizations** | — | All charts per §7 | — |

---

## 1. The three lists

The most common way this design fails is trying to maintain one list. There are three, with different owners and different lifecycles.

| | Owner | Size | Changes | Purpose |
|---|---|---|---|---|
| **Target list** | Strategist | 50–300 | Rarely, deliberately | The reporting spine. Every "we improved X" measures against this. |
| **Discovered** | GSC | 1,000s | Weekly | An inbox of queries earning impressions that aren't yet targets. |
| **Universe** | DataForSEO | 10,000s | Continuous | Gap analysis and research. Queried on demand, never stored as history. |

### The rule: GSC never auto-adds to the target list

If discovery auto-promotes, the headline metric — *% of target keywords in the top 10* — becomes meaningless, because the denominator moves every week and list churn is indistinguishable from performance. Clients notice, and it destroys trust in the report.

Discovery is a **triage queue**. A strategist promotes, ignores, or defers each row. That queue is what makes this a strategy tool rather than a rank table.

### Provenance and honest deltas

Every tracked query carries `source` (`manual`, `gsc_discovery`, `dfs_gap`, `competitor_gap`, `dfs_suggestion`) and `added_at`. Period-over-period movement is reported **only against queries that were in the list at the start of the period**. Without this you flatter yourself every month by promoting keywords you already rank for.

---

## 2. What each source is good for

| Source | Covers | Cost | Blind spot |
|---|---|---|---|
| DataForSEO SERP | Any keyword, ranked or not | per call | A synthetic check, not real user experience |
| Google Search Console | Only queries already earning impressions | free, unlimited | Cannot see keywords you don't rank for at all |
| DataForSEO LLM Responses | Prompts we choose, sampled N times | per call + LLM pass-through | Proxied provider APIs with web search on — closer to the consumer product than bare completions, but not identical to it |
| DataForSEO LLM Mentions | Whatever their crawl covers | per call, ~20× cheaper | Unknown sample size; not our prompt list |

This split answers the 1,000-keyword question: **most of the volume comes free from GSC.** Paid rank tracking is reserved for target keywords the site does *not* yet rank for — the ones GSC is structurally blind to, because no impressions means no row. That list is small, and it's where the spend goes.

### DataForSEO rank and GSC position are different measurements

They will disagree, permanently, often by several positions. DataForSEO is a single unpersonalized check from a fixed location and device. GSC average position is weighted across every impression — all locations, devices, personalization, SERP features.

**Never average them, never put them in one column, never draw them as one line.** Two sources on the same query, two series, both labeled. This is stated here because it will otherwise be filed as a bug every month.

---

## 3. Schema — `020_search_visibility.sql`

Conventions follow `010_content_module.sql`: `uuid` PKs named `<thing>_id`, `contract_id` FK, `timestamptz` timestamps, `IF NOT EXISTS`, RLS service-role policies on backend-internal tables.

### `content_tracked_queries` — the target list

One row per keyword or prompt. The canonical list.

| Column | Type | Notes |
|---|---|---|
| query_id | uuid PK | |
| contract_id | uuid NOT NULL | FK → contracts |
| query_type | text NOT NULL | `keyword` \| `prompt` |
| query_text | text NOT NULL | As entered |
| query_normalized | text NOT NULL | lowercase, trimmed, whitespace collapsed, punctuation stripped — the join key |
| asset_id | uuid | FK → content_assets; the page/post targeting this |
| priority | text | `high` \| `medium` \| `low` |
| status | text | `tracking` \| `paused` \| `archived` |
| source | text | `manual` \| `gsc_discovery` \| `dfs_gap` \| `competitor_gap` \| `dfs_suggestion` |
| cadence | text | `weekly` \| `monthly` \| null (inherit from config) |
| location_code | int | DataForSEO location; defaults from config |
| language_code | text | defaults from config |
| tags | text[] | Cluster/theme grouping — drives report filtering |
| next_run_at | timestamptz | Scheduler cursor |
| added_at | timestamptz | Provenance for honest deltas |
| created_at / updated_at | timestamptz | |

`UNIQUE (contract_id, query_type, query_normalized, location_code)`
Indexes on `(contract_id, status)`, `(next_run_at) WHERE status = 'tracking'`, `(contract_id, query_normalized)`.

### `content_rank_snapshots` — DataForSEO positions

| Column | Type | Notes |
|---|---|---|
| snapshot_id | uuid PK | |
| query_id | uuid NOT NULL | FK → content_tracked_queries |
| position | int | null = not in top 100 — **null is data, not missing** |
| ranking_url | text | Which page ranks |
| serp_features | text[] | `ai_overview`, `snippet`, `local_pack`, … |
| in_ai_overview | boolean | Broken out; it's the metric clients ask about |
| search_volume | int | |
| difficulty | int | |
| volume_method | text | Vendor methodology tag — see §6 |
| captured_at | timestamptz NOT NULL | |

`UNIQUE (query_id, captured_at)`. Index `(query_id, captured_at DESC)`.

### `content_gsc_snapshots` — Search Console, by query and date

Separate table: different grain (daily, not per-run), different revision semantics, and it exists for queries that aren't tracked.

| Column | Type | Notes |
|---|---|---|
| gsc_id | uuid PK | |
| contract_id | uuid NOT NULL | |
| query_id | uuid | FK, **nullable** — most GSC rows aren't tracked queries |
| query_normalized | text NOT NULL | Join key when query_id is null |
| date | date NOT NULL | |
| clicks / impressions | int | |
| ctr | numeric | |
| avg_position | numeric | Decimal — never an int |
| top_url | text | |

`UNIQUE (contract_id, query_normalized, date)` — upsert target for the trailing re-pull.
Index `(contract_id, date DESC)`, `(query_id, date DESC)`.

### `content_ai_visibility_snapshots` — aggregated prompt results

One row per (prompt, engine, run). Aggregated, because a single observation is noise — see §5.

| Column | Type | Notes |
|---|---|---|
| snapshot_id | uuid PK | |
| query_id | uuid NOT NULL | |
| method | text NOT NULL | `sampled` \| `mentions_db` — see §5.3. **Never mix in one series.** |
| engine | text NOT NULL | `chatgpt` \| `claude` \| `gemini` \| `perplexity` \| `all` (mentions_db) |
| samples_taken | int | Null for `mentions_db` — it has no sample count |
| samples_mentioned | int | Null for `mentions_db` |
| mention_rate | numeric | `samples_mentioned / samples_taken` — **the metric** for `sampled`, not a boolean. Null for `mentions_db`. |
| mention_count | int | Observed mentions. Populated for `mentions_db` only. |
| avg_mention_position | numeric | Ordinal position of first brand mention in response, averaged |
| cited | boolean | Client domain appeared in citations in any sample |
| citation_domains | jsonb | All cited domains + counts — feeds competitor SoV |
| competitor_mentions | jsonb | `{ "competitor.com": 3 }` |
| captured_at | timestamptz NOT NULL | |

`UNIQUE (query_id, method, engine, captured_at)`.

### `content_ai_response_samples` — raw responses

Keep the text. A verbatim "here is what ChatGPT said about you in March vs. September" is the most persuasive artifact in the whole report, and it cannot be reconstructed from aggregates.

| Column | Type |
|---|---|
| sample_id | uuid PK |
| snapshot_id | uuid NOT NULL FK |
| response_text | text |
| citations | jsonb |
| brand_mentioned | boolean |
| sample_index | int |
| captured_at | timestamptz |

Retain 90 days of raw text, indefinitely for aggregates. Prune on the cron.

### `content_query_discoveries` — the GSC triage inbox

| Column | Type | Notes |
|---|---|---|
| discovery_id | uuid PK | |
| contract_id | uuid NOT NULL | |
| query_normalized | text NOT NULL | |
| query_text | text NOT NULL | |
| impressions_28d / clicks_28d | int | |
| avg_position | numeric | |
| opportunity_score | numeric | See below |
| status | text | `pending` \| `promoted` \| `ignored` |
| reviewed_by | uuid FK → users | |
| reviewed_at | timestamptz | |
| first_seen_at | timestamptz | |

`UNIQUE (contract_id, query_normalized)`.

**Opportunity score:** rank by impressions where `avg_position` is between 5 and 25 and the query is not already tracked. That band is where a rank improvement converts to traffic; above it you already win, below it the gap is too large to be a quick win. Ignored rows stay ignored — never resurface them.

### `content_tracking_config` — per-contract settings

| Column | Type | Notes |
|---|---|---|
| config_id | uuid PK | |
| contract_id | uuid NOT NULL UNIQUE | |
| domain | text NOT NULL | Target domain for rank checks |
| competitor_domains | text[] | Drives SoV and gap analysis |
| brand_terms | text[] | Mention detection — brand name plus variants/misspellings |
| keyword_cadence | text | `weekly` \| `monthly`, default `weekly` |
| prompt_cadence | text | `weekly` \| `monthly`, default `monthly` |
| prompt_samples_per_run | int | Default 5 |
| location_code / language_code | int / text | Defaults for new queries |
| gsc_property | text | The exact `siteUrl` from `sites.list` — never hand-typed. See §4.4. |
| gsc_property_type | text | `domain` \| `url_prefix` — drives the coverage warning |
| gsc_permission_level | text | As last reported by `sites.list`; detects revoked or downgraded access |
| gsc_access_verified_at | timestamptz | Last successful read. No per-contract token; access is via the shared service account. |
| enabled | boolean | Master switch |

### `content_tracking_runs` — run log

`run_id`, `contract_id`, `run_type` (`keywords` \| `gsc` \| `prompts` \| `full`), `queries_processed`, `snapshots_written`, `discoveries_found`, `api_calls`, `status` (`completed` \| `partial` \| `failed`), `error_detail`, `started_at`, `completed_at`.

### `content_query_current` — the rollup

A table refreshed at the end of each run, not a view. The trends table renders 1,000 rows with 7/30/90-day deltas; computing that live over the snapshot history on every page load is the one real performance trap here.

`query_id` PK, plus `current_position`, `position_7d_ago`, `position_30d_ago`, `position_90d_ago`, `position_delta_7d/30d/90d`, `best_position_ever`, `trend` (`climbing` \| `declining` \| `stable` \| `unranked`), `clicks_28d`, `impressions_28d`, `ctr_28d`, `gsc_avg_position`, `mention_rate_avg`, `sparkline` (jsonb — last 12 points), `updated_at`.

`trend` is computed from the 30-day delta with a ±2 position deadband, so ordinary SERP jitter doesn't get reported as movement.

---

## 4. Collection and cadence

### 4.1 The scheduler

**The cron runs daily and processes whatever is due.** Not separate weekly and monthly crons — a single due-work scheduler, so cadence becomes a data change rather than an infrastructure change, and a per-query override costs nothing.

```
POST /api/cron/search-visibility   (Render daily, 06:00 UTC, verifyCronSecret)

  for each contract where enabled:
    1. GSC pull       — always; daily, cheap, free
    2. Rank checks    — queries where next_run_at <= now() and query_type='keyword'
    3. Prompt samples — queries where next_run_at <= now() and query_type='prompt'
    4. Discovery      — recompute inbox from trailing 28d GSC
    5. Rollup         — refresh content_query_current
    6. Log            — content_tracking_runs
```

After processing, `next_run_at = now() + cadence`. Resolution order for cadence: query override → contract config → `weekly` for keywords, `monthly` for prompts.

Prompts default to monthly because each run costs `samples_per_run × engines` API calls — a weekly 5-sample 4-engine run on 50 prompts is 4,000 calls/month per client. Weekly is available and supported; it should be a deliberate choice. See §4.2 for what that actually costs.

### 4.2 What this costs

No subscription is required anywhere in this design. DataForSEO is pay-as-you-go against a prepaid balance (a $50 minimum funds an account — MM's is already past it), and GSC is free. Cost scales with queries tracked, not with client count, which is the structural reason this beats a per-seat platform for an agency.

| Line item | Rate | Monthly, typical contract |
|---|---|---|
| SERP rank checks | $0.0006–0.002 per SERP by queue | 200 keywords weekly ≈ 800 calls ≈ **$0.50–1.60** |
| GSC | free | **$0** |
| LLM Responses (sampled) | $0.0006/task **+ LLM provider pass-through** | 50 prompts × 4 engines × 5 samples ≈ 1,000 responses ≈ **$3–10** |
| LLM Mentions (database sweep) | $0.10/request + $0.001/row | one monthly sweep ≈ **$0.15–0.50** |

Call it **$5–15 per contract per month** at these volumes. For comparison, the managed alternatives run $89–399/mo *per account*.

**The number to watch is the LLM provider pass-through, not DataForSEO's fee.** The $0.0006 task charge is noise; you are really paying for ChatGPT/Claude/Gemini/Perplexity tokens, which vary by model and response length. The band above is an estimate — **measure one real client's prompt set before extrapolating across the portfolio**, and re-measure if the sampler's models change.

Sampling is therefore the cost lever. `prompt_samples_per_run` and `prompt_cadence` are the two dials; both are per-contract config, and `samples_per_run` should not drop below 3 (see §5).

### 4.3 GSC has a lag and gets revised

Two rules, both non-optional:

1. **Pull with a 3-day lag.** Data for the last 2–3 days is incomplete.
2. **Re-pull a trailing 7-day window every run and upsert.** Google revises recent data. Insert-once bakes in numbers that were wrong when you took them.

Also: **GSC withholds anonymized low-volume queries.** Per-query rows will never sum to the property totals. Surface this as a footnote in the report or you will answer the question every month.

### 4.4 GSC access: the existing shared MiD account

Access uses the **single MiD/NewNorth Google account that already holds verified
access to the client portfolio** — the same credential Master Marketer runs on
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_GSC_REFRESH_TOKEN`), one
long-lived refresh token, no per-contract OAuth and no token storage. A contract
carries only `gsc_property` and a `gsc_access_verified_at` timestamp.

A GCP service account was considered and rejected. On its own merits it is the
better shape for unattended server access — no refresh token to be revoked, no
dependency on a human account. But it is a *different identity*, and roughly
fifteen client properties have already granted the existing account. Re-granting
all of them to gain a marginally sturdier credential is not a trade worth making.

**Consequences of the shared refresh token**, which are the real cost here:

- It is a single point of failure for **every** contract at once. A revocation —
  password change, a Google security event, removing the account from the
  workspace — takes all collection down simultaneously, not one property.
- The token error is surfaced explicitly as "the shared refresh token may have
  been revoked" rather than as a per-property access failure, because the
  symptom otherwise looks like fifteen clients revoking access on the same day.
- Whoever owns that Google account effectively owns the pipeline. It should be a
  role account, not a person's login.

**Permission level.** Restricted is sufficient — Google's permission table grants
Restricted users "View Performance reports," which is exactly and only what this
module reads. Ask for it on *new* grants; existing grants at Full or Owner work
unchanged and are not worth downgrading.

Do **not** ask for Owner on new properties. Owner is an Indexing API
requirement; this module does not index.

*(The permission table documents UI rights. `siteRestrictedUser` is a
first-class value in the API's own `permissionLevel` enum, but confirm
empirically on the first new property before making it the standard ask.)*

### Binding a property to a contract

`gsc_property` is **never hand-typed.** A typo or the wrong property format yields an empty or partial dataset that reads as poor SEO performance rather than as a misconfiguration — the worst class of bug this module can have.

Instead, `GET /sites` (Search Console API `sites.list`), called with the shared account, returns every property it has been granted:

```json
{ "siteEntry": [
  { "siteUrl": "sc-domain:example.com",     "permissionLevel": "siteRestrictedUser" },
  { "siteUrl": "https://www.example.com/",  "permissionLevel": "siteFullUser" },
  { "siteUrl": "https://newnorth.com/",     "permissionLevel": "siteUnverifiedUser" }
]}
```

Onboarding flow:

1. Client adds the MiD account's address in Settings → Users and permissions → Add user, at Restricted. *(For most existing contracts this is already done.)*
2. Strategist opens the contract's tracking settings and clicks **Refresh properties** → backend calls `sites.list` → dropdown of available properties.
3. Strategist selects one. Backend stores `siteUrl`, derives `gsc_property_type`, records `permissionLevel`, stamps `gsc_access_verified_at`.

The same call validates access, so the picker and the permission check are one request. A property absent from the list, or returning `siteUnverifiedUser`, means the grant hasn't landed — surface that as "not yet granted," not as an error.

**Two different failures, two different fixes.** The bind endpoint returns a
`remediation` field because collapsing these into one "no access" error sends
strategists somewhere with nothing to do:

| State | What it means | Who fixes it |
|---|---|---|
| Property absent from `sites.list` | No grant exists | **Client** adds the MiD account as a Restricted user |
| `siteUnverifiedUser` | A property we hold directly whose **ownership verification lapsed** | **MiD** re-verifies in Search Console |

The second is already present in the portfolio — several properties, including
`newnorth.com`, currently sit in Search Console's "Not verified" group. Nothing
is wrong with the client relationship there; the usual cause is a site rebuild
removing the verification HTML file. Asking the client to re-grant would not fix
it.

**Verify by DNS, not by HTML file.** The file method is what lapses: it survives
until the next deploy that doesn't carry it, which is why these properties drift
back to unverified. A DNS TXT record persists across rebuilds. Where the domain
is ours to configure, adding a **domain property** (`sc-domain:example.com`)
solves both problems at once — DNS-verified so it stays verified, and covering
every subdomain and both protocols so the URL-prefix gap below disappears too.

**Warn on URL-prefix selection when a domain property is available for the same host.** The two are not equivalent:

```
sc-domain:example.com       → every subdomain, both protocols
https://www.example.com/    → that exact prefix only
```

Choosing the URL-prefix form silently drops apex, other subdomains, and http traffic. Totals look plausible, just low, and nothing surfaces the omission. Prefer the domain property whenever one exists.

This is not hypothetical for this portfolio. The shared account's existing
properties are overwhelmingly URL-prefix, and at least one host is registered
**twice — once as `http://` and once as `https://`** — so neither entry alone
sees that site's full traffic. A strategist picking one from a dropdown has no
way to know that. Hence the warning, and hence recording `gsc_property_type` on
the contract rather than inferring it at read time.

**Re-check `permissionLevel` on every run.** Client-side user changes are invisible to us otherwise; a revoked grant should appear in the UI as lost access rather than as a flat line in the trend chart.

**Quota.** Search Analytics allows 1,200 QPM per user and 30M QPD per project. The shared account is one user, so every contract draws on that same 1,200 QPM — comfortable for daily pulls at any client count this business will reach, but note that Master Marketer's SEO audits draw on the same budget. Revisit only if pulls become continuous rather than scheduled.

**The tradeoff to accept knowingly:** one credential fronts every client property, and it is now load-bearing for two systems. A revocation takes down both this module and MM's audit enrichment at once. Keep it on a role account, and treat rotation as a coordinated change across both repos.

### 4.5 Failure handling

A failed rank check writes **no row** — it does not write `position: null`. Null means *checked and not ranking*, which is real data; a gap means *not checked*. Conflating them puts a false cliff in the chart. Leave `next_run_at` unchanged on failure so the next daily run retries.

---

## 5. Prompt sampling

**LLM responses are non-deterministic.** Same prompt, same model, same day, different answer. A single observation per period produces a "trend" that is mostly sampling variance — and a client-facing report built on it will eventually show a dramatic decline that is pure noise.

Because we generate the responses ourselves through DataForSEO rather than accepting a vendor's fixed crawl, we control the sampling. That is the main advantage of this approach over a managed tool, not just the cost.

**Run each prompt N times per engine per run (default 5) and store the rate.** The metric is `mention_rate` — "mentioned in 4 of 5" — never a boolean.

```
for each prompt × engine:
  responses = await mm.llmResponses({ prompt, engine, n: samples_per_run })
  for each response:
    mentioned = detectBrandMention(response.text, config.brand_terms)
    store raw sample
  write aggregate snapshot { samples_taken, samples_mentioned, mention_rate, ... }
```

**Mention detection** matches against `brand_terms` case-insensitively on word boundaries, covering the brand name plus known variants and misspellings. Store the matched span alongside the sample so a strategist can audit a false positive rather than just distrust the number.

### 5.1 `web_search: true` is mandatory — not optional

DataForSEO's LLM Responses endpoints are a **proxy to the official provider APIs** (OpenAI, Anthropic, Google, Perplexity). We supply no provider keys; DataForSEO routes the call and passes the token cost through.

Every request **must** set `web_search: true`. With it off, the model answers from training recall and the `annotations` array returns **null** — no citations, no sources, no live grounding. That measures what a model memorized, not what it retrieves and cites, and it is useless for this purpose.

With it on, `annotations` returns source URLs and titles mapped to spans in the response text. That array is what populates `citation_domains` and `citations`, and it drives chart 9. **A sample that comes back with null annotations is a misconfigured call, not a zero-citation result** — the sampler should treat it as a failure and not write a snapshot, for the same reason §4.5 distinguishes "not checked" from "checked and not ranking."

Note that `web_search` increases output tokens beyond any configured limit, so the per-sample provider cost is higher than a bare completion. That is already reflected in the §4.2 estimate.

With fewer than 3 samples, do not display a rate — show "insufficient samples." A 1-of-1 result rendered as 100% is worse than no number.

### 5.2 What this is and isn't

These are generated responses, not observed user sessions. This is sound for **trend** reporting — the same method applied consistently over time — and it must not be described to a client as "your ChatGPT ranking." The report wording should be *"brand mentioned in N% of sampled AI responses."* Put that caveat in the UI, not just in this doc.

### 5.3 Two collection methods, never one series

DataForSEO offers a second path: the **LLM Mentions API**, which queries their existing database of observed brand mentions instead of generating fresh responses. It is roughly 20× cheaper per run and has no provider pass-through. Run both — they answer different questions.

| | `sampled` (LLM Responses) | `mentions_db` (LLM Mentions) |
|---|---|---|
| Source | Responses we generate, N per engine | DataForSEO's own crawl database |
| Metric | `mention_rate` — mentioned in 4 of 5 | `mention_count` — observed occurrences |
| Sample size | Ours, known, tunable | Theirs, unknown |
| Prompt set | Exactly our tracked list | Whatever they crawled |
| Cost | $3–10/contract/month | ~$0.15–0.50/contract/month |
| Good for | Trend on the prompts we chose | Broad sweep, discovery, cheap corroboration |

**These are different measurements and must not be averaged, summed, or drawn as one line.** Same rule as DataForSEO rank vs. GSC position in §2, and it fails the same way: a rate and a count share no unit, and their sample sizes are not comparable. The `method` column on `content_ai_visibility_snapshots` exists to keep them apart, and every chart and table filters on it explicitly.

**How each is used:**

- **`sampled`** is the reporting spine for prompts — the series that appears in the trends chart and the client deck.
- **`mentions_db`** runs monthly as a cheap sweep, and feeds two things: corroboration (a sampled decline that the database also shows is a real signal; one it contradicts is probably sampling noise worth investigating before it reaches a client), and **prompt discovery** — mentions found against prompts we do *not* track become candidates for the target list, the same triage pattern as GSC discovery in §1.

A prompt promoted from that sweep gets `source = 'dfs_suggestion'` on its `content_tracked_queries` row, so prompt provenance works exactly like keyword provenance and the honest-delta rule in §1 applies unchanged.

---

## 6. The vendor methodology trap

`content_rank_snapshots.volume_method` exists because search volume methodologies change — Ahrefs moves to AI-adjusted volume on 2026-09-30, and DataForSEO will make comparable changes. A methodology change mid-series produces a step change in the chart that looks exactly like performance and isn't.

Tag every snapshot with the method that produced it. When a series spans a change, the chart draws an annotation rule at the boundary and the table footnotes it. Never silently redraw across a discontinuity.

---

## 7. Visualizations

Charts live in Content Ops → **Search Visibility**, with three tabs: **Keywords**, **Prompts**, **Discovery**.

### Non-negotiables

- **No dual-axis charts, ever.** Clicks (0–5,000) against position (1–100) on one plot invents a correlation that isn't in the data. Two measures of different scale → two stacked charts sharing an x-axis, or index both to 100 at t0 on one axis. This is the single most likely mistake in this module.
- **Position axis is inverted** — 1 at the top. A rank chart where improvement goes down is misread by everyone, every time.
- **Color follows the entity, never its rank.** Filtering the keyword list must not repaint the survivors; a strategist who learned "this cluster is blue" stays right.
- **A legend is present for ≥2 series**; ≤4 series are also direct-labeled. One series needs no legend — the title names it.
- **Run `validate_palette.js` on any categorical palette before shipping**, in both light and dark. Dark mode is its own set of validated steps, not an automatic flip.
- Thin marks, hairline solid gridlines (never dashed), no value label on every point, table view available for every chart.

### Keywords tab

**1 · KPI row — stat tiles, not charts.** Avg position · keywords in top 10 · keywords in top 3 · clicks (28d) · impressions (28d). Each tile: value, delta vs. previous period, sparkline. A one-bar bar chart for a single number is wrong; the number is the chart.

**2 · Rank distribution over time — stacked area.** Buckets `1–3 / 4–10 / 11–20 / 21–50 / 51–100 / not ranking`. These are **ordered**, so they use a single-hue ordinal ramp light→dark — not categorical hues. This is the headline chart: it shows the whole portfolio moving, which a line-per-keyword chart cannot. 2px surface gap between segments.

**3 · Top movers — dumbbell chart.** Top 10 gains and top 10 losses, before → after per keyword, one hue in two shades. The exact form for before/after per item, and far more readable than 20 overlapping lines.

**4 · The keyword table.** 1,000 rows, server-paginated from `content_query_current`, with a sparkline column. Columns: keyword · current position · Δ7d · Δ30d · GSC avg position · clicks · impressions · trend · tags. Sortable and filterable by tag, priority, trend, source. **This table is the primary artifact** — past ~7 meaningful classes a table beats a chart, and a strategist scanning 1,000 keywords wants rows.

**5 · Single keyword detail — line chart, one series per source.** DataForSEO position and GSC avg position as two labeled series on one inverted axis (same unit, so one axis is correct here). Content publish/update events for the linked asset drawn as annotation rules. Crosshair + tooltip.

**6 · Opportunity scatter.** Impressions (x) vs. avg position (y, inverted) for tracked keywords, with the 5–25 position band shaded. Upper-right is the work. Cap at three categorical series — facet rather than seat a fourth.

### Prompts tab

**7 · Mention rate over time — line per engine.** Filtered to `method = 'sampled'`. Four engines is within the safe band but at the point where direct labels become mandatory. Y-axis is 0–100% and **fixed**, not auto-scaled: auto-scaling a rate makes a 3-point wobble look like a collapse. If the `mentions_db` sweep is shown at all, it is a **separate chart below** with its own count axis — never a second line here (§5.3).

**8 · Share of voice vs. competitors — emphasis form.** Client in the accent hue, every competitor in de-emphasis gray. The story is "us vs. the field," not eight distinct identities. Categorical hues here would bury the one line that matters.

**9 · Citation sources — horizontal bar.** Which domains AI engines cite when answering the tracked prompts. Long domain names; horizontal. Single series → one hue for every bar, not a value ramp.

**10 · Response evidence panel.** Not a chart. Raw sampled responses with brand mentions highlighted, filterable by engine and date, oldest vs. newest side by side. This is what goes in the client deck.

**Sample-count honesty:** every prompt metric displays `n` alongside it. A rate without its sample size is not a finding.

### Discovery tab

**11 · Triage queue.** A table, not a chart: query · impressions 28d · clicks · avg position · opportunity score · [Promote] [Ignore]. Sorted by opportunity score. Bulk-select for promote/ignore. Promotion creates a `content_tracked_queries` row with `source = 'gsc_discovery'` and `added_at = now()`.

**12 · Coverage stat tile.** "Tracking 180 of 2,340 queries earning impressions — 62% of clicks covered." One number that tells a strategist whether the target list is representative or has drifted.

---

## 8. API surface

```
# Tracked queries
GET    /api/compass/content/queries?contract_id&query_type&status&tag&search
POST   /api/compass/content/queries                 # single
POST   /api/compass/content/queries/bulk            # CSV/paste import
PUT    /api/compass/content/queries/:id
DELETE /api/compass/content/queries/:id
POST   /api/compass/content/queries/:id/run-now     # ad-hoc refresh

# Trends
GET    /api/compass/content/visibility/summary?contract_id&period
GET    /api/compass/content/visibility/table?contract_id&page&sort&filter
GET    /api/compass/content/visibility/series/:query_id?from&to
GET    /api/compass/content/visibility/distribution?contract_id&from&to
GET    /api/compass/content/visibility/movers?contract_id&period&limit

# Prompts
GET    /api/compass/content/visibility/prompts?contract_id&period
GET    /api/compass/content/visibility/prompts/:query_id/samples?engine&from&to

# Discovery
GET    /api/compass/content/discoveries?contract_id&status
POST   /api/compass/content/discoveries/:id/promote
POST   /api/compass/content/discoveries/:id/ignore
POST   /api/compass/content/discoveries/bulk

# Config
GET    /api/compass/content/tracking-config?contract_id
PUT    /api/compass/content/tracking-config
GET    /api/compass/content/tracking-config/gsc/properties   # sites.list — populates the picker
POST   /api/compass/content/tracking-config/gsc/bind          # select property, verify, stamp
```

Series endpoints read snapshot tables; table and summary endpoints read `content_query_current` only.

### Master Marketer endpoints

**`POST /api/v1/seo/rank-batch`** — batch SERP positions.

```json
{ "domain": "example.com", "keywords": ["..."], "location_code": 2840, "language_code": "en" }
```
```json
{ "results": [{ "keyword": "...", "position": 12, "ranking_url": "...",
                "serp_features": ["ai_overview"], "search_volume": 1200,
                "difficulty": 35, "volume_method": "dfs_2026_09" }] }
```

**`POST /api/v1/seo/llm-responses`** — N sampled responses per prompt. Writes `method = 'sampled'`. MM sets `web_search: true` on every upstream call (§5.1) and returns the `annotations` array as `citations`.

```json
{ "prompt": "best B2B loyalty platforms", "engine": "chatgpt", "samples": 5 }
```
```json
{ "responses": [{ "text": "...", "citations": [{ "url": "...", "title": "..." }] }] }
```

**`POST /api/v1/seo/llm-mentions`** — database sweep. Writes `method = 'mentions_db'`.

```json
{ "brand_terms": ["Acme", "Acme Inc"], "competitor_domains": ["rival.com"], "limit": 1000 }
```
```json
{ "mentions": [{ "prompt": "...", "engine": "chatgpt", "mention_count": 3,
                 "citations": ["..."], "observed_at": "2026-09-01" }] }
```

Both are stateless. MM gathers and returns; this repo owns all history. Consistent with the position established in `spec-content-optimization.md`.

---

## 9. Phases

**Phase 1 — Collect (ship first, alone).** Migration, tracked-query CRUD, GSC OAuth + daily pull, MM `rank-batch`, cron scheduler, rollup, run log. No UI beyond list management and config.

Ship this before the report. **Rank history cannot be backfilled** — every week without the collector is a week of data that is permanently gone. The snapshot tables are the asset; the charts are a view of them and can follow a month later.

**Phase 2 — Report.** Keywords tab: KPI row, distribution, movers, table, keyword detail.

**Phase 3 — Discovery.** Inbox computation, triage queue, promote/ignore, coverage tile.

**Phase 4 — Prompts.** Prompt list management, sampler, MM `llm-responses`, mention detection, prompts tab. Then the `mentions_db` sweep (MM `llm-mentions`) as a second pass — it is cheap, corroborating, and supplies prompt-list candidates, but it is not the reporting spine and should not be built first.

**Phase 5 — Ideation.** Hands off to `content-intelligence-engine.md` Phases 3–5, which now read real tables instead of proposed ones.

---

## 10. Open questions

1. ~~**GSC OAuth ownership.**~~ **Resolved:** the existing shared MiD Google account (the one already granted on ~15 client properties), with properties bound via `sites.list` rather than hand-entry (§4.4). One shared refresh token, no per-contract tokens. Confirm Restricted empirically on the first *new* property grant.
2. **Location granularity.** One location per query is assumed. Clients with multi-region or local-pack strategies will want several, which multiplies both cost and row count. Deferred, but `location_code` on the query row leaves the door open.
3. **Prompt list seeding.** Manual entry in v1; the `mentions_db` sweep (§5.3) supplies candidates from Phase 4 onward via `source = 'dfs_suggestion'`. Whether that sweep gets its own triage queue in the Discovery tab, or just surfaces inline on the Prompts tab, is a UI call for Phase 4.
4. **Cost ceiling per contract.** Costed in §4.1 at roughly $5–15/contract/month, so no metering in v1 — consistent with `spec-content-optimization.md`. Revisit if `prompt_cadence` goes weekly across the portfolio or `samples_per_run` rises; the LLM provider pass-through is the only line item that can move fast. Folds into the platform-level API observability workstream.
5. **Client-facing exposure.** This spec assumes internal/strategist use. Whether clients see the trends report directly, and with what caveats on the AI sampling wording, is a separate decision.
