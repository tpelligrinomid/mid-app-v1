## 1. Overview & Reporting Goals

### Purpose

This plan defines how EarthSafe's marketing performance will be measured, tracked, and reported. It establishes shared metric definitions, the data infrastructure behind them, and the reporting rhythm — culminating in a single Databox reporting dashboard, linked from the portal's Resources section, that covers website, Shopify, lead, and campaign metrics so nobody has to log into each platform separately.

### Why This Matters

**Clarity** — Everyone works from the same definitions. "A distributor lead," "a healthcare lead worth the sales team's time," and "a replacement-capture order" mean one specific thing each, measured one specific way.

**One view of the whole business** — EarthSafe's marketing footprint is bigger than the work MiD executes directly. Amazon marketplace advertising for Air Logic, the Stack Influence UGC program, partner content, and distributor sell-through all move the same numbers. This plan tracks the whole picture, not just MiD's slice, so decisions are made against total marketing performance.

**Optimization** — Clean baselines and consistent tracking let us see what's working within weeks (e.g., whether the EZ Bleach/BRUTABS replacement pages are producing orders) instead of debating it from anecdote.

**Accountability against real goals** — Reporting ladders up to the three agreed business goals, not vanity metrics.

### The Three Business Goals Everything Reports Against

1. **$300–500K annual Shopify run rate** (direct e-commerce)
2. **10–14 new distributors onboarded by year-end**
3. **One new large healthcare account per quarter**

Every dashboard, metric tier, and monthly report answers: are we pacing toward these three numbers, and which marketing activity is contributing?

### Key Reporting Principles

1. **Three revenue motions, three funnels.** EarthSafe sells three ways — direct e-commerce (Shopify), through distributors, and into healthcare systems. These have different buyers, cycle lengths, and success metrics. We report them separately and never blend them into one funnel average.
2. **Owned vs. observed.** MiD-executed channels (SEO, content, Klaviyo, resource center, site) get full-depth reporting. EarthSafe-executed channels (Amazon ads, Stack Influence UGC, tradeshows, direct sales activity) get tracked at the outcome level so the full picture stays visible — see Section 2.
3. **Revenue and orders over traffic.** Shopify revenue attribution is the anchor metric for the e-commerce motion. Traffic and rankings are leading indicators, reported as such.
4. **A lead is only a lead if it signals interest.** Especially for healthcare: nothing routes to the sales team on a page view or an email open. The bar is an explicit interest signal (form fill, sample/quote request, direct reply, pallet-offer response).
5. **Honest attribution.** With a distributor-heavy business, last-click attribution understates marketing. We report first-touch source on all leads and orders, flag distributor-influenced demand separately, and never claim credit we can't substantiate.

---

## 2. Full-Funnel Coverage: Owned vs. Observed Channels

This is the mechanism for tracking EarthSafe's marketing even where MiD isn't executing.

### Owned Channels (MiD executes — full-depth reporting)

| Channel | What MiD runs |
|---|---|
| Organic search / SEO / AEO | Technical SEO, content clusters, on-page, link building per the July 2026 SEO Plan |
| Website & Shopify storefront | Managed web (weekly fix motion), CWV remediation, landing pages, resource center |
| Email — Klaviyo | Flagship program (max 2 emails / 7 days), replacement-capture nurture, segment builds |
| Content & resource center | Claims hub, 17 vertical pages, education layer, comparison pages |
| Reporting infrastructure | Databox dashboard, GA4/GSC configuration, UTM governance |

### Observed Channels (EarthSafe or partners execute — outcome-level reporting)

| Channel | Who runs it | What we track | Data path |
|---|---|---|---|
| Amazon marketplace ads (Air Logic) | EarthSafe | Spend, sales, ACoS, units — monthly | Amazon Ads / Seller Central reporting |
| Stack Influence UGC / social | EarthSafe + agency | Posts live, reach/engagement, branded-search lift, UGC-tagged traffic | Platform reports + GA4 branded-search & referral trend |
| Partner content (CA Ireland) | Partner | Placements live, referral traffic, linking domains | GA4 referrals + Ahrefs |
| Distributor activity (Imperial Dade, Geriatric Medical, new onboards) | EarthSafe sales | New distributors onboarded, first orders, reorder signal | EarthSafe CRM/sales reporting (monthly pull) |
| Healthcare direct sales | EarthSafe | Leads routed → contacted → meetings → evaluations → accounts; feedback on lead quality | HubSpot + EarthSafe sales reporting |
| Tradeshows / conferences | EarthSafe | Events attended, contacts captured, pipeline sourced | EarthSafe provides per-event |

**Rule:** observed channels appear on the monthly report and executive dashboard even when the data is a manual monthly entry. A channel with no data feed still gets a line — marked "no data available" — so gaps are visible instead of invisible.

**Interaction effects we specifically watch:** Amazon ads and UGC drive branded search and direct traffic to the site; organic content captures demand the influencer program creates. Branded search volume trend is the cross-channel health metric that ties them together.

---

## 3. Funnels & Stage Definitions

### Funnel A — Direct E-Commerce (Shopify)

Buyer: facility managers, small operators, direct B2B buyers. Cycle: short.

| Stage | Definition | Measured in |
|---|---|---|
| Visitor | Site session | GA4 |
| Engaged visitor | Product/collection page view, 2+ pages | GA4 |
| Add to cart | Item carted | Shopify |
| Checkout started | Checkout initiated | Shopify |
| Order | Completed purchase | Shopify |
| Repeat customer | 2nd+ order | Shopify |

**Special segment — replacement capture:** orders landing via the EZ Bleach / BRUTABS replacement pages (page-path + UTM attribution) get their own tracked line. This is the month-one SEO play and the fastest proof of content → revenue. Replacement orders received to date establish the baseline.

**Targets:** conversion rate benchmarked after 60 days of clean data (no invented targets before baseline); revenue pacing vs. the $300–500K run-rate goal reported monthly.

### Funnel B — Distributor Acquisition

Buyer: jan-san distributors, packaging/facility supply houses. Cycle: weeks to months. **Preferred route to revenue.**

| Stage | Definition |
|---|---|
| Distributor inquiry | Form fill, email, or call identifying as a distributor/reseller |
| Qualified conversation | Call or meeting held; fit confirmed (line coverage, territory, volume) |
| Onboarding | Agreement in motion — pricing, first stock order being placed |
| Active distributor | First order shipped |
| Producing distributor | Reorder within the expected window |

**Marketing's contribution:** inbound distributor inquiries (source-attributed), the Klaviyo vendor/distributor segment (built from the TUG membership list, existing customers excluded), and the gated distributor resource kit (hospital EVS posters — planned lead-capture asset). The **pallet free-freight offer** targets new distributors and is a named campaign with its own response tracking.

**Target:** pace against 10–14 new distributors by year-end; report marketing-sourced vs. sales-sourced.

### Funnel C — Healthcare (Enterprise)

Buyer: EVS management, infection preventionists, contract firms (ABM, Crothall, Aramark, Sodexo). Cycle: long for hospitals; nursing homes move faster via Geriatric Medical. Motion: **inbound** — pose the clinical question, establish need, let them contact EarthSafe.

| Stage | Definition |
|---|---|
| Healthcare lead | Contact at a healthcare org **with an explicit interest signal** — form fill, Publication Repository download, sample/quote request, pallet-offer reply, direct question. A page view or email open is NOT a lead. |
| Routed to sales | Passed to the healthcare sales team with full context (source, content engaged, org, role), via direct notification |
| Meeting / conversation | Sales team engaged the contact |
| Evaluation | Product under review (infection preventionist approval process, trial) |
| Account | Purchasing — direct or via distributor |

**Named plays feeding this funnel:** PurOne toilet tablets (the revenue priority — C. diff toilet-plume angle, framed as **study data, never a claim**), the Publication Repository PDF as a gated asset, pallet free-freight for 400–500+ bed hospitals, nursing homes via Geriatric Medical, and (when live) the podcast.

**Target:** pace against one new large healthcare account per quarter; leads routed to sales per month; sales lead-quality feedback reported monthly — if quality slips, the routing bar tightens.

---

## 4. Key Metrics by Area

### Reporting Priority Tiers

**Tier 1 — weekly (the Data slide):**
- Shopify: orders, revenue, revenue by source, replacement-capture orders
- New leads by funnel (e-commerce inquiries / distributor / healthcare) and source
- Healthcare leads routed to sales
- Organic sessions + week's ranking movements on priority terms
- Klaviyo sends, campaign performance vs. cadence guardrail
- Pages shipped / in regulatory review

**Tier 2 — monthly:**
- Full channel detail (Sections below), funnel conversion rates, goal pacing (all three goals)
- Observed-channel roll-up (Amazon, UGC, partner, distributor, healthcare pipeline)
- SEO deep dive vs. July baseline; AEO citation spot-checks
- Email list growth & segment health

**Tier 3 — quarterly (full audit):**
- Full site re-crawl + technical audit
- Content effectiveness by cluster (traffic, conversions, revenue per cluster)
- Link profile review; DR/referring-domain progress
- Win/loss on distributor and healthcare pipeline; sales-cycle observations
- Roadmap refresh

### Website & Organic Search

**Baseline (July 20, 2026):** DR 26 · 421 live referring domains · 187 US keywords · 581 US organic visits/mo (Ahrefs) · 955/mo all-tools · 59 top-3 rankings · Core Web Vitals 38/100 · AEO readiness 12/100.

**12-month goal:** 5,000+ monthly organic visits with the mix shifted toward B2B buyers (healthcare, education, commercial facilities).

- Organic sessions + trend; **branded vs. non-branded split** (branded = cross-channel signal from Amazon/UGC/PR)
- Rankings on priority cluster terms (A–F per the SEO plan); top-3 count vs. 59 baseline
- Indexation: commercial pages indexed vs. inventory (crawl fix is the month-1 gate)
- Core Web Vitals: 38 → 70+
- Referring domains: +15–20/month, toward 600+ by mid-2027
- AEO: AI-citation checks across the 20 tracked commercial queries, quarterly baseline report
- High-intent page views: claims hub, replacement pages, vertical pages, contact

**Sources:** GA4, Google Search Console, Ahrefs, Shopify. **Cadence:** weekly rankings/sessions; monthly Ahrefs pull vs. baseline; quarterly re-crawl.

### Shopify / E-Commerce

- Revenue, orders, AOV; run-rate pacing vs. $300–500K goal
- Revenue by channel (organic, email, direct, referral, paid if launched)
- Conversion funnel: sessions → ATC → checkout → order (leak identification)
- Replacement-capture orders (dedicated line)
- New vs. returning customer revenue; repeat rate
- Product mix: PurTabs / PurOne / FlashDry / Air Logic / equipment — flag when a content cluster ships so movement is attributable

**Sources:** Shopify, GA4. **Cadence:** weekly headline; monthly full.

### Email — Klaviyo

- List growth by segment: **vendors/distributors vs. direct buyers** (TUG-list based; existing customers excluded from campaigns; legacy healthcare list enters only after bounce cleanup)
- Per-campaign: delivered, open, click, revenue (Klaviyo-attributed)
- Flows: replacement-capture nurture and any launched sequences — conversion per flow
- Deliverability: bounce <2%, spam <0.1%
- **Cadence compliance:** flagship program ≤ 2 emails per rolling 7 days — reported weekly

**Sources:** Klaviyo, Shopify. **Cadence:** weekly campaign results; monthly aggregate + list health.

### Content & Resource Center

- Pages shipped vs. plan (claims hub, 17 vertical pages, education layer, comparisons)
- Regulatory pipeline: pages in EarthSafe regulatory review against the EPA master labels — **time-in-review reported**, since the claims gate is the throughput constraint
- Per-page once live: entrances, engagement, assisted conversions
- Gated assets: Publication Repository and EVS poster kit downloads → leads by segment
- Content → revenue: cluster-level attribution (which clusters produce orders and leads)

**Sources:** GA4, Shopify, Klaviyo, ClickUp. **Cadence:** weekly ship-status; monthly performance; quarterly cluster effectiveness.

### Healthcare Motion

- Healthcare leads captured (interest-signal bar) and source
- Routed to sales; disposition and quality feedback
- Meetings, evaluations, accounts (from HubSpot / EarthSafe sales reporting)
- Named-play tracking: toilet-tablet content engagement, Publication Repository downloads, pallet-offer responses, podcast metrics when live
- Pace vs. one large account/quarter

**Sources:** HubSpot, GA4, EarthSafe sales reporting. **Cadence:** weekly lead counts; monthly pipeline.

### Distributor Motion

- Inbound distributor inquiries by source
- Distributor-segment email engagement
- Gated distributor-kit leads
- New distributors onboarded (marketing-sourced vs. sales-sourced), first orders, reorders — EarthSafe monthly pull
- Pace vs. 10–14 by year-end

**Sources:** forms/GA4, Klaviyo, EarthSafe sales data. **Cadence:** monthly.

### Observed Channels (monthly roll-up)

- **Amazon (Air Logic):** spend, sales, ACoS, units; Air Logic branded-search trend on Google as the halo metric
- **UGC / social:** posts live, reach, engagement; site traffic from social; branded-search lift during pushes
- **Partner content:** placements, referral sessions, links gained
- **Tradeshows/events:** per-event contacts and pipeline, as provided

---

## 5. Reporting Cadence

The agreed rhythm: **weekly metrics on calls, monthly deeper dive, quarterly full audit.**

### Weekly — the Data slide (Wednesdays 12:00 ET)

The standing five-part deck (worked on / working on / waiting on you / **data** / what's next) carries a Data slide from the dashboard: Shopify headline, new leads by funnel, ranking movements, email results, content ship-status. Two minutes, trends not tables. Anything anomalous moves to the discussion agenda.

### Monthly — deeper dive

Written summary + dashboard walk-through on the first weekly of the month:

- Executive summary: pacing vs. all three business goals
- Funnel A/B/C detail with conversion rates
- Channel deep dives (SEO vs. baseline, email, content)
- Observed-channel roll-up — the full-footprint view
- Insights, recommendations, next month's priorities

### Quarterly — full audit

- Full technical/SEO re-crawl and link review
- Content effectiveness by cluster; kill/scale decisions
- Funnel analysis and bottleneck identification across all three motions
- Goal progress and any re-forecast
- Roadmap refresh for the next quarter, delivered through the portal

### How the Data Flows

MiD builds and maintains the dashboards, owns GA4/GSC/UTM governance, and produces all owned-channel reporting, the weekly Data slide, the monthly report, and the quarterly audit. Owned-channel metrics update automatically through platform connectors. Observed-channel figures (Amazon, distributor activity, healthcare pipeline, UGC program, events) refresh monthly from EarthSafe's own platform reporting.

---

## 6. Databox Dashboard Structure

One dashboard link in the portal's Resources section, broken into boards ("slides") by category. Client checks one place; the weekly Data slide screenshots from it.

**Board 1 — Executive Overview**
Pacing vs. the three goals (Shopify run rate, distributors YTD, healthcare accounts) · month's revenue, orders, leads by funnel · organic traffic trend · one owned-vs-observed contribution view. *Auto where connected; monthly manual entries for observed channels.*

**Board 2 — Website & SEO**
Sessions (branded/non-branded) · top pages · priority-keyword positions & top-3 count · referring domains · CWV score · indexed-page count · GSC impressions/clicks. *GA4 + GSC live; Ahrefs monthly.*

**Board 3 — Shopify Revenue**
Revenue, orders, AOV, conversion funnel · revenue by source · replacement-capture line · new vs. returning · product mix. *Shopify connector, daily.*

**Board 4 — Email (Klaviyo)**
List size by segment · campaign table (sent/open/click/revenue) · flow performance · deliverability · 7-day cadence check. *Klaviyo connector, daily.*

**Board 5 — Leads & Pipeline (Distributor + Healthcare)**
Leads by funnel and source · healthcare leads routed to sales and dispositions · distributor inquiries → onboarded · gated-asset downloads. *Forms/HubSpot live; sales-side monthly.*

**Board 6 — Observed Channels**
Amazon spend/sales/ACoS · UGC reach & branded-search lift · partner placements & referrals · event lines. *Monthly manual/API where available.*

**Build order:** Boards 2–4 first (connectors exist today), Board 1 same week, Boards 5–6 as the remaining data feeds come online.

---

## 7. Baselines & Targets Summary

| Metric | Baseline (Jul 2026) | Target | Horizon |
|---|---|---|---|
| Shopify annual run rate | TBD — first clean month | $300–500K | 12 mo |
| New distributors | 0 (count from 7/1) | 10–14 | Year-end |
| New large healthcare accounts | 0 | 1 / quarter | Ongoing |
| Organic traffic | 955/mo (581 US, Ahrefs) | 5,000+/mo | 12 mo |
| Top-3 keyword rankings (US) | 59 | Growth vs. baseline, checkpoint at 90 days | Quarterly |
| Referring domains (live) | 421 | 600+ | Mid-2027 |
| Core Web Vitals | 38/100 | 70+ | 90 days |
| AEO readiness / citations | 12/100 · 20-query baseline | Citation presence on core queries | Quarterly |
| Replacement-capture orders | Baseline being established | Tracked from week 1 | Monthly |
| Email cadence compliance | — | 100% within 2-per-7-days | Weekly |

Funnel conversion-rate targets are deliberately **not** set up front: we baseline 60 days of clean data first, then set improvement targets in the month-3 report. Targets grounded in EarthSafe's own historicals will be more useful than industry benchmarks.

---

## 8. Data Infrastructure

**Tools:** Shopify (store of record for revenue) · GA4 + GSC · Ahrefs · Klaviyo · HubSpot (contacts/leads) · Databox (reporting layer) · Portal (delivery — dashboard link in Resources, metrics posted to Notes).

**UTM governance:** every MiD-created link (email, gated asset, partner placement, any future paid) carries UTMs under one naming convention MiD maintains; a link without UTMs reports as direct and undercounts marketing — treated as a defect and fixed when found.