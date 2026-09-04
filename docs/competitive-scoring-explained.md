# Competitive Scoring & Benchmarking — how it works today

How the five-dimension competitive scores in the research report are produced, what
evidence they rest on, and what would need to change before they can carry a recurring
benchmarking product.

Source: `trigger/generate-research.ts`, `src/prompts/research.ts`,
`src/lib/gather-intelligence.ts`.

**The short version, stated up front:** the scores are a language model's editorial
judgment of a company's marketing maturity relative to the other companies in that
particular report. They are not computed from a formula, they are not validated after
generation, and they are not comparable across reports. That is fine for what they do now —
frame a conversation inside one document — and it is the central problem to solve before
they become a time series. Section 6 covers what to do about it.

---

## 1. The pipeline

Research generation runs in three phases.

**Phase 1 — intelligence gathering.** All companies (client + 1-10 competitors) are
gathered in parallel, three streams each, plus a parallel web-research stream. Every
individual source is wrapped in its own `catch`: a failure logs a warning and leaves that
field undefined rather than failing the company or the run.

**Phase 2 — document generation**, sequential, each call seeing summaries of prior
sections for coherence:

| Step | Section | Calls |
|---|---|---|
| 1-4 | Market Overview, Industry Dynamics, Technology & Innovation, Customer Insights | 4 |
| 5 | Competitive Landscape | 1 |
| 6 | Competitor Deep-Dives | 1 per competitor |
| 7 | **Competitive Scoring** | 1 |

**Phase 3 — assembly.** The scoring JSON is rendered into a markdown matrix and
justification list, appended as the final section, and also returned as a structured
`competitive_scores` object.

Scoring is the **last** call. It sees the intelligence data plus the first 1,500 characters
of every prior section, so the narrative sections influence the scores.

---

## 2. What gets gathered

Per company, three parallel streams:

### Social

| Source | Data | Requires |
|---|---|---|
| LinkedIn (Apify) | Followers, employee count, industry, description, specialties, recent posts with likes/comments | `linkedin_handle` on the company |
| YouTube (Data API) | Subscribers, video count, total views, recent videos with view counts | `youtube_channel_id` on the company |

Both are **opt-in per company**. A competitor without a `linkedin_handle` in the request
contributes no LinkedIn data — and nothing distinguishes that from a company with no
LinkedIn presence.

### Organic

| Source | Data | Limit |
|---|---|---|
| Moz — domain metrics | Domain Authority, Page Authority, Spam Score, external links, linking domains | — |
| Moz — keyword rankings | Keyword, position, search volume | 50 fetched |
| Moz — top pages | URL, page authority, external links | 50 fetched |
| Firecrawl (Apify fallback) | Scraped page markdown | varies |

### Paid

| Source | Data | Limit |
|---|---|---|
| SpyFu — PPC keywords | Keyword, position, CPC, monthly cost | — |
| SpyFu — ad history | Keyword, headline, description | — |
| LinkedIn Ad Library (Apify) | Headline, body, CTA | — |
| Google Ads Transparency (Apify) | Headline, description, format | — |
| Ad creative analysis | An **LLM summary** of the above: themes, messaging patterns, CTA patterns | Runs only if LinkedIn or Google ads returned rows |

Note the last row: ad creative analysis is itself a Claude call whose output becomes input
to the scoring call. One layer of judgment already sits under `paid_media` before scoring
begins.

### Web research

Exa.ai search across client, competitors, industry and solution category. Feeds the
narrative sections; not company-attributed.

---

## 3. What the scorer actually sees

This is the part most likely to surprise, and it matters for a benchmarking product.

`formatCompanyIntelligence(company, maxWebPages)` renders one company into text. The
`maxWebPages` argument caps how many scraped website pages are included at 2,000 characters
each. Different calls pass different depths:

| Call | Client depth | Competitor depth |
|---|---|---|
| Competitive Landscape | 10 pages | 5 pages |
| Main sections | 5 pages | 5 pages |
| Competitor Deep-Dive | 3 pages | 10 pages |
| **Competitive Scoring** | **2 pages** | **2 pages** |

**Scoring runs on the shallowest view of website content in the entire pipeline.** The
deep-dive section reads ten pages of a competitor's site; the call that assigns the
`content_strategy` score reads two.

Everything else is capped inside the formatter regardless of depth:

- LinkedIn: 5 recent posts, descriptions truncated at 500 chars, post text at 200
- YouTube: 10 recent videos
- Moz: 20 keywords, 15 top pages (of the 50 fetched)
- SpyFu: 15 PPC keywords, 10 ad copy records
- LinkedIn / Google ads: 10 each

So the scorer sees a *sample*, not the dataset. The sample is deterministic — it is always
the first N — but it is a sample.

Data-collection errors are appended to each company's block as a visible
`### Data Collection Errors` list, so the model can see that a source failed. Whether it
distinguishes "no data" from "no presence" is up to the model; nothing enforces it.

---

## 4. The scoring call

**System prompt:**

> You are a senior marketing strategist scoring companies on their marketing maturity. You
> provide fair, data-driven scores backed by specific evidence. You output valid JSON only.

**Scale: 1-10 per dimension.** The criteria, verbatim:

| Dimension | Criteria given to the model |
|---|---|
| `organic_seo` | Domain authority, keyword rankings, content volume, organic visibility |
| `social_media` | Follower count, posting frequency, engagement quality, channel diversity |
| `content_strategy` | Content types, quality, consistency, thought leadership, SEO alignment |
| `paid_media` | Ad presence, spend signals, creative quality, keyword coverage, multi-channel approach |
| `brand_positioning` | Clarity of positioning, differentiation, messaging consistency, visual identity |

**Overall** is instructed as a weighted average:

| Dimension | Weight |
|---|---|
| Organic SEO | 25% |
| Content Strategy | 25% |
| Social Media | 20% |
| Paid Media | 15% |
| Brand Positioning | 15% |

The model returns, per company, the five scores, an `overall`, and a one-to-two sentence
`justification` per dimension. The client is scored in the same call, on the same scale, as
one company among the set.

### There is no rubric

This is the most important thing to understand. "Domain authority, keyword rankings,
content volume, organic visibility" names *what to look at*. It does not say what a 4 is
versus a 7. There is no band table, no threshold, no anchor — no statement that DA 40-49
is a 5, or that fewer than 10 ranking keywords caps the score at 3.

The model infers the scale from context, and the strongest context available is the other
companies in the same prompt. In practice the scores behave as **relative rankings within
the report**, presented on an absolute-looking 1-10 scale.

### Nothing validates the output

```ts
const competitiveScores = extractJson(scoringResponse) as Record<string, CompetitorScore>;
```

Parsed and cast. No Zod schema, no checks. Specifically, none of the following are
enforced:

- Scores fall within 1-10
- `overall` actually equals the weighted average of the five dimensions
- Every requested company is present in the response
- Company names in the response match the names in the request
- `justification` is populated for every dimension

The prompt asks for all of this. Nothing verifies it.

### Name-keyed, with a silent zero fallback

Scores are keyed by `company_name` string. When the roadmap generator consumes them:

```ts
scores: input.research.competitive_scores[comp.company_name] || FALLBACK_ZERO_SCORES
```

A competitor whose name differs by so much as a trailing "Inc." between the research
request and the roadmap gets **all five dimensions set to 0**, rendered into a client-facing
chart, with no error raised anywhere.

---

## 5. What the output looks like

Structured, returned as `competitive_scores`:

```jsonc
{
  "Acme Corp": {
    "organic_seo": 7, "social_media": 4, "content_strategy": 6,
    "paid_media": 8, "brand_positioning": 6, "overall": 6.4,
    "justification": {
      "organic_seo": "DA 52 with 1,400 linking domains and top-3 positions on...",
      "social_media": "..."
    }
  }
}
```

And rendered as markdown: a matrix with one row per dimension and one column per company,
`overall` bolded, followed by per-company justification bullets in the form
**Organic SEO (7/10)**: reasoning.

Downstream, the roadmap's Competition section passes these through untouched — the roadmap
generator is explicitly told *not* to generate scores, and they are injected during
assembly.

---

## 6. What this means for a benchmarking product

The scores work for what they currently do: anchor a conversation inside one document, at
one moment, against one named peer set. Recurring snapshots ask something different of
them, and four properties get in the way.

### 6a. The scores are peer-relative, so they cannot be a time series

This is the blocking issue.

With no absolute rubric, a 6 means "middling among *these* companies." Change the
competitor set between snapshots — add a competitor, drop one, rename one — and every
company's score can move without anything about that company changing. Even holding the set
fixed, the model has no memory of last quarter's calibration.

A chart showing a client's Organic SEO going 5 → 6 → 6 → 7 would be read as improvement.
It could equally be model variance, a shift in the peer set, or a competitor's site being
temporarily unscrapable.

**What to do:** separate the two layers.

- **The observable layer** — DA, linking domains, ranking keyword count, follower count,
  video count, PPC keyword count, estimated monthly ad spend. These are numbers from
  vendors. They are reproducible, they are comparable across time, and they are what a
  trend line should be drawn from.
- **The judgment layer** — the 1-10 scores. Keep them for narrative, but derive them from
  the observable layer through a **fixed, versioned rubric** rather than asking the model
  to intuit a scale. "DA 50-59 and 500+ linking domains → 7" is auditable, reproducible,
  and can be recomputed retroactively when the rubric changes.

If a rubric is too rigid, an intermediate step works: have the model score against
explicitly stated absolute anchors included in the prompt, and store the rubric version
alongside every score so a scale change is visible in the data rather than showing up as a
phantom trend.

### 6b. Missing data is indistinguishable from absence of activity

Every source failure degrades silently. A SpyFu timeout and a company that genuinely runs
no paid media both produce an empty `paid` block. The model scores what it sees, so both
land near the bottom of `paid_media`.

Over a time series this produces false movement: a competitor's `paid_media` drops from 7
to 2 because an Apify actor failed that week, and the chart says they exited paid.

**What to do:** record per-source collection status alongside the data — attempted,
succeeded, failed, not-configured — and carry a per-dimension confidence or coverage
figure into the database. A dimension whose sources failed should be stored as null and
rendered as a gap, never as a low score. `gather-intelligence.ts` already collects an
`errors` array per company; it just isn't structured or persisted.

### 6c. Only the scores are kept — the evidence is thrown away

The `IntelligencePackage` is assembled, rendered into prompt text, and discarded. What
persists is the score and a one-sentence justification.

That means you cannot ask, six months on, "what was their DA when we scored them a 6?" —
and you cannot recompute historical scores under an improved rubric, because the inputs are
gone.

**What to do:** persist the raw `IntelligencePackage` per snapshot. It is already a
well-shaped object with `gathered_at` on it. Storing it is the difference between a
benchmarking product you can improve and one whose history is frozen at whatever the rubric
was on the day.

### 6d. Identity is a display name

Keying on `company_name` is fragile within a single report and unworkable across a time
series, where the same company will be entered by different people over quarters.

**What to do:** key on normalized domain. `src/lib/domain.ts` already exists for
normalization, and the roadmap's zero-score fallback should be an error rather than a
silent default regardless.

### 6e. Two smaller things

**`overall` is model-computed.** It should be recomputed deterministically from the five
dimensions and the stored weights. Cheap to do, removes a class of arithmetic error, and
makes the weighting explicit and versionable rather than buried in prompt text.

**Scoring reads the shallowest data in the pipeline** — 2 website pages, against 10 for a
deep-dive. If `content_strategy` and `brand_positioning` are going to be tracked
quantitatively, that depth is worth revisiting; those two dimensions rest almost entirely
on scraped site content.

---

## 7. A snapshot schema

A sketch, not a migration. It assumes the split from §6a: evidence, metrics and judgment
as three separate layers, each with a different lifetime and a different reason to change.

### The three layers

| Layer | What it is | Changes when |
|---|---|---|
| **Evidence** | The raw `IntelligencePackage` for one company at one moment | Never — it is what the vendors said that day |
| **Metrics** | Flattened numbers extracted from the evidence | The extractor improves, or a new source is added |
| **Scores** | 1-10 judgments derived from metrics under a rubric | The rubric is revised |

Keeping them separate is what makes the product improvable: a better rubric recomputes
every historical score without recollecting anything, and a better extractor backfills
every historical metric from evidence you already hold.

### Tables

```sql
-- The companies being tracked. Domain is the identity, not the name.
create table benchmark_entities (
  id              uuid primary key,
  domain          text not null unique,        -- normalized via src/lib/domain.ts
  display_name    text not null,               -- may drift; never used for joins
  linkedin_handle text,                        -- gathering is opt-in per company
  youtube_channel_id text,
  created_at      timestamptz not null default now()
);

-- One collection pass. Groups the entities gathered together so a peer set is
-- reconstructable even though scores no longer depend on it.
create table benchmark_runs (
  id            uuid primary key,
  contract_id   uuid references contracts(id),  -- null for agency-wide tracking
  subject_id    uuid not null references benchmark_entities(id),  -- the client
  period        date not null,                  -- normalized bucket, e.g. month start
  gathered_at   timestamptz not null,           -- IntelligencePackage.gathered_at
  trigger       text not null,                  -- 'scheduled' | 'manual' | 'research_report'
  research_deliverable_id uuid,                 -- when it came from a research run
  unique (subject_id, period, trigger)
);

-- Evidence. One row per entity per run. Never updated.
create table benchmark_evidence (
  id          uuid primary key,
  run_id      uuid not null references benchmark_runs(id),
  entity_id   uuid not null references benchmark_entities(id),
  payload     jsonb not null,                   -- the CompanyIntelligence object verbatim
  unique (run_id, entity_id)
);

-- Per-source outcome. This is what stops a failed scrape reading as a low score.
create table benchmark_source_status (
  run_id      uuid not null references benchmark_runs(id),
  entity_id   uuid not null references benchmark_entities(id),
  source      text not null,      -- 'moz_metrics' | 'moz_keywords' | 'linkedin' | 'youtube'
                                  -- | 'firecrawl' | 'spyfu_ppc' | 'spyfu_ad_history'
                                  -- | 'linkedin_ads' | 'google_ads'
  status      text not null,      -- 'ok' | 'failed' | 'not_configured' | 'empty'
  detail      text,               -- the error string from CompanyIntelligence.errors
  primary key (run_id, entity_id, source)
);

-- Metrics. Extracted from evidence; regenerable.
create table benchmark_metrics (
  run_id          uuid not null references benchmark_runs(id),
  entity_id       uuid not null references benchmark_entities(id),
  extractor_version int not null,
  metrics         jsonb not null,   -- see the mapping below; nulls where uncollected
  primary key (run_id, entity_id, extractor_version)
);

-- Scores. Derived from metrics under a versioned rubric; regenerable.
create table benchmark_scores (
  run_id           uuid not null references benchmark_runs(id),
  entity_id        uuid not null references benchmark_entities(id),
  rubric_version   int not null references benchmark_rubrics(version),
  organic_seo      numeric(3,1),    -- null, never 0, when coverage is insufficient
  social_media     numeric(3,1),
  content_strategy numeric(3,1),
  paid_media       numeric(3,1),
  brand_positioning numeric(3,1),
  overall          numeric(3,1) not null,   -- RECOMPUTED, never model-reported
  coverage         jsonb not null,  -- per-dimension: 'full' | 'partial' | 'none'
  justification    jsonb,           -- narrative, from the model
  primary key (run_id, entity_id, rubric_version)
);

-- The rubric itself, versioned, so a scale change is visible as data.
create table benchmark_rubrics (
  version     int primary key,
  weights     jsonb not null,   -- {organic_seo: 0.25, content_strategy: 0.25, ...}
  bands       jsonb not null,   -- per dimension: ordered thresholds -> score
  notes       text,
  created_at  timestamptz not null default now()
);
```

The `unique (run_id, entity_id)` constraints and the version columns are what make
recomputation idempotent: rerunning extractor v3 over the whole history writes one new row
per entity-run and leaves v2 intact for comparison.

### Dimension → metric mapping

Every field below already exists on `CompanyIntelligence`. The **True total?** column is
the one to read carefully: several are fetch-capped, so a growing company's number
saturates and the trend line flattens for a reason that has nothing to do with them.

#### `organic_seo` — good coverage

| Metric | Source field | True total? |
|---|---|---|
| `domain_authority` | `organic.moz_metrics.domain_authority` | yes |
| `page_authority` | `organic.moz_metrics.page_authority` | yes |
| `spam_score` | `organic.moz_metrics.spam_score` | yes |
| `external_links` | `organic.moz_metrics.external_links` | yes |
| `linking_domains` | `organic.moz_metrics.linking_domains` | yes |
| `ranking_keywords` | `organic.moz_keywords.length` | **no — capped at 50** |
| `keywords_top_3` / `keywords_top_10` | derived from `ranking_position` | **no — within the capped 50** |
| `tracked_search_volume` | sum of `search_volume` | **no — within the capped 50** |
| `top_pages` / `avg_page_authority` | `organic.moz_top_pages` | **no — capped at 50** |

Raise the Moz `limit` (currently defaulted to 50 in `src/lib/moz.ts`) or store a saturation
flag. A competitor sitting at exactly 50 ranking keywords for four quarters running is an
artifact, and it will get read as a plateau.

#### `paid_media` — good coverage

| Metric | Source field | True total? |
|---|---|---|
| `ppc_keywords` | `paid.spyfu_ppc_keywords.length` | yes — no fetch cap |
| `estimated_monthly_spend` | sum of `monthly_cost` | yes |
| `avg_cpc` | mean of `cost_per_click` | yes |
| `linkedin_ads_active` | `paid.linkedin_ads.length` | yes |
| `google_ads_active` | `paid.google_ads.length` | yes |
| `paid_channels_active` | count of non-empty ad sources | yes |
| `creative_recency_days` | `google_ads.last_shown`, `spyfu_ad_history.last_seen` | yes |

`creative_recency_days` is the most interesting one you are not capturing today — it
separates "runs ads" from "refreshes creative", which is a genuine maturity signal and
moves quarter to quarter.

#### `social_media` — good coverage, one normalization needed

| Metric | Source field | True total? |
|---|---|---|
| `linkedin_followers` | `social.linkedin.followers` | yes |
| `linkedin_employees` | `social.linkedin.employee_count` | yes, but **a string** ("11-50") — parse to a midpoint or a band |
| `linkedin_post_cadence_days` | derived from `recent_posts[].posted_at` | from a sample |
| `linkedin_avg_engagement` | mean of `likes + comments` | from a sample |
| `youtube_subscribers` | `social.youtube.subscriber_count` | yes |
| `youtube_videos` | `social.youtube.video_count` | yes — channel total |
| `youtube_views` | `social.youtube.view_count` | yes — channel total |
| `youtube_recent_cadence_days` | derived from `recent_videos[].published_at` | from a sample |
| `social_channels_active` | count of present channels | yes, **but opt-in** |

The opt-in caveat is important for trends: a competitor gains a LinkedIn score the quarter
someone remembers to add their `linkedin_handle` to the request. Store handles on
`benchmark_entities` once, rather than per request, so the tracked set is stable.

#### `content_strategy` and `brand_positioning` — weak to no coverage

This is the finding that most shapes the product, so it is worth stating plainly.

| Dimension | Observable today | Weight |
|---|---|---|
| `content_strategy` | `website_pages.length` (scrape breadth, **not site size**), `moz_top_pages`, YouTube video count, LinkedIn cadence | 25% |
| `brand_positioning` | nothing quantitative — it is read off scraped page copy | 15% |

**40% of the `overall` weight rests on dimensions with almost no measurable input.** Charted
over time they will mostly show model variance.

Three options, in increasing order of cost:

1. **Chart only the three measurable dimensions**, and present content and brand as
   point-in-time qualitative assessments rather than trends. Honest, cheap, and probably
   right for v1.
2. **Add sources that make content measurable** — sitemap or blog-index crawl for true page
   counts and publish cadence, which turns `content_strategy` into a real metric. This is a
   modest addition to the gathering layer and the highest-value one.
3. **Leave `brand_positioning` as a judgment permanently.** It probably is one. Store it
   with a rubric version and expect it to move in steps when the rubric changes, not
   smoothly.

### Coverage, and never scoring an absence

The rule that makes the whole thing trustworthy:

```
if every source behind a dimension is 'failed' or 'not_configured':
    score = null, coverage = 'none'        -- renders as a gap in the chart
elif some sources are missing:
    score computed, coverage = 'partial'   -- renders with a marker
else:
    score computed, coverage = 'full'
```

A dimension is never scored low because collection failed. `overall` is then computed over
the dimensions that have scores, with the weights renormalized, and `coverage` records
which ones contributed.

### Cadence

Monthly is the natural bucket. Domain Authority updates roughly monthly, ad libraries
change continuously, follower counts drift slowly. Weekly would mostly sample noise;
quarterly would miss the ad-creative signal entirely.

Run collection on a fixed day of the month so `period` buckets are comparable, and store
`gathered_at` separately from `period` — a run that slips three days should still land in
its month rather than creating a gap.

### Order of work

1. **Persist `IntelligencePackage` from the existing research runs.** One insert into
   `benchmark_evidence` at the end of `generate-research.ts`, keyed on normalized domain.
   Starts accumulating history immediately, changes no behaviour, and is worth doing before
   anything else is designed.
2. Backfill `benchmark_entities` from past research inputs.
3. Extractor v1 → `benchmark_metrics`, over whatever evidence exists.
4. Rubric v1 → `benchmark_scores`, recomputing `overall` deterministically.
5. Scheduled collection independent of research generation.
6. Trend surfaces in the app.

Step 1 is the one with a deadline attached: every research run that completes before it
ships is a snapshot you cannot get back.

---

## 8. Summary for the product decision

| | Today | Needed for recurring benchmarking |
|---|---|---|
| Scale | 1-10, no rubric | Versioned absolute rubric, or stated anchors |
| Comparability | Within one report only | Across time and peer sets |
| Reproducibility | None — LLM judgment | Deterministic from stored metrics |
| Validation | None | Range, completeness, recomputed `overall` |
| Missing data | Silently scores low | Stored null with coverage flags |
| Evidence | Discarded | Persisted per snapshot |
| Identity | Company name string | Normalized domain |
| Trend safety | Not safe to chart | Safe |

The good news is that the gathering layer is already the hard part and it already works —
nine sources across three streams, per-source failure isolation, and a structured package
with a timestamp. A benchmarking product mostly needs that package **persisted and keyed
properly**, with the scoring layer rebuilt on top of it as a versioned rubric rather than
an unanchored judgment.

Rebuilding scoring without persisting the evidence would be the expensive order to do this
in.
