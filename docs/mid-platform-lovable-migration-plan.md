# MiD Platform — Lovable Migration Plan

Two parts:
- **Part A (§1–§11): the migration.** Lovable Cloud → our own Supabase + Vercel. Replaces Lovable's draft runbook. Built from an inspection of all three repos and of the real Lovable Cloud export taken 2026-10-10 (`growth-pulse-grid_261010.backup`).
- **Part B (§12–§13): the team and agent operating model.** Which coding agents we use, and how agents monitor and maintain the platform.

The team-facing overview, including Step 2 (Ocean, the Hermes-based company agent architecture) and the MCP v2 scope, is the doc **MiD Platform & Ocean Plan**: https://claude.ai/code/artifact/a1494ff7-e3ed-4114-8226-894a3cb02a2e. This file is the command-level runbook.

```text
Vercel (frontend, pulse-compass)  ──►  New Supabase project (DB, Auth, Storage, Edge Functions, pg_cron)
        │                                        ▲
        └──► Render backend (mid-app-v1) ────────┘  (via backend-proxy edge function + user JWTs)
                     └──► Master Marketer (Render + trigger.dev)  — no changes needed
```

---

## 1. What we know (facts, not assumptions)

**Export file** — pg_dump custom format, zstd, 934 MB compressed / ~8.7 GB of row data. Source Postgres 17.6; dumped with pg_dump 18.6 (use `pg_restore` ≥ 18 — installed locally via scoop at `~/scoop/apps/postgresql/current/bin`).

| Contents | Detail |
|---|---|
| `public` | 87 tables/views (incl. 2 materialized views), 76 tables with data, ~273k rows, 32 functions, 185 RLS policies |
| Big tables | `pulse_tasks` 72k rows / 5.3 GB (97% is the `raw_data` + `custom_fields` ClickUp JSON); `compass_knowledge` 142k rows / 3.0 GB (embeddings). Everything else < 100 MB each |
| `auth` | **Included.** 137 users, 93 email + 71 Google identities, 11 OAuth clients (MCP connectors). Passwords and Google links survive |
| `storage` | Metadata only (no files). 263 objects: 257 in `content-assets`, 6 in `deliverable-uploads`, 0 in `deliverable-images`. Plus Lovable's `database_export_10_10_26` bucket — skip it |
| `cron` | 2 jobs, both hard-coded to the old project — **do not restore; recreate** (§6) |
| `vault` | Empty |
| Extensions | `vector`, `pg_net`, `pg_cron`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault` |
| Not in any migration file | `public.log_contract_changes()` (created by hand). Everything else exists somewhere in `pulse-compass/supabase/migrations`, `pulse-compass/drizzle/migrations` or `mid-app-v1/backend/migrations` |
| No vector index | `compass_knowledge.embedding` has no HNSW/IVFFlat index (seq scan today) — makes restore faster; add one after cutover |
| No triggers on `auth.users` | User ↔ `public.users` linking happens in the frontend by email on login |

**How each system reaches the database**

- **Frontend** — supabase-js directly (~288 `.from()` calls, 15 RPCs, 16 `functions.invoke`) with `VITE_SUPABASE_URL` + publishable key; Render API for the rest.
- **Render backend** — **no service-role key, no DB URL.** User-token clients (RLS) + the `backend-proxy` edge function (~1,000 calls/hour). Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EDGE_FUNCTION_SECRET`, `BACKEND_API_KEY` (both secrets are sent as `x-backend-key` and must equal the function's `BACKEND_API_KEY` secret).
- **Master Marketer** — never touches Supabase. Callback URL comes per-request from the backend. No change.
- **pg_cron** (inside the DB) — `quickbooks-token-refresh` (`*/30 * * * *` → `quickbooks-auth/refresh`) and `weekly-invoice-audit` (`0 12 * * 1` → Mondays 12:00 UTC). Both send the old anon key.
- **DB trigger** — `notify_release_note_inserted()` posts to the hard-coded old `notify-release-note` URL.

**Things the old runbook got wrong:** no `SYNC_PAUSED` flag exists (pause = suspend Render cron jobs); there is no service-role key or DB URL on Render; `supabase db push` would miss the 5 Drizzle migrations; Lovable AI gateway + `.lovable.app` reset links would break; the cron jobs were unknown.

---

## 2. Decisions

### Where each piece lives after the move

Lovable Cloud does two jobs today. They go to two places:

| Today (Lovable) | After | What it is |
|---|---|---|
| Lovable hosting | **Vercel** | Serves the React app (static files) |
| Lovable Cloud = a Supabase project Lovable owns (`cpjfuttlywafjxefczqc`) | **Our own Supabase project** | Postgres database, logins, file storage, 12 edge functions, scheduled jobs |
| Render | Render (unchanged) | `mid-app-v1` backend, `master-marketer` API |
| trigger.dev | trigger.dev (unchanged) | Master Marketer tasks |

Vercel cannot replace Supabase: its database add-ons are plain Postgres without Supabase Auth, row-level security, storage and edge functions, which the app is built on. Moving Supabase is a copy; replacing it would be a rewrite.

### Decided

- [x] **No permanent staging environment.** Long-lived staging copies drift out of sync and double the upkeep. Instead (see §11):
  - Every pull request gets a **Vercel preview URL** automatically; previews use the production backend and data, with the same logins and RLS as production.
  - **Fast undo** replaces staging: Vercel instant rollback, Render "redeploy previous", Supabase point-in-time recovery (PITR).
  - **Human approval where it's dangerous:** migrations, auth/permissions, billing.
  - **Later, only if needed:** Supabase branching (a throwaway database per PR that includes a migration). Requires the single migration history from §9.
  - For the **migration rehearsal**, the new Supabase project is the test environment and the backend runs **locally** against it. No staging service is created.
- [x] **GitHub:** all three repos live in the **Marketers-in-Demand** org. `pulse-compass` is already there; transfer `mid-app-v1` and `master-marketer` (§3.1).
- [x] **Supabase access control at the org level.** On the Pro plan, members are invited to an *organization*, and their role applies to every project in it (per-project roles need the Team plan). So:
  - A dedicated org (e.g. "New North — Production") holds **only** the production project, with 2–3 members: Owner + 1–2 Administrators.
  - Experiments and side projects go in a separate org.
  - Everyone else (strategists, agents) changes the app through pull requests; schema changes arrive as reviewed migration files. They never need dashboard access to production data.
- [x] **Vercel** account is a company team, not a personal login, with at least one admin besides the founder.
- [x] **Domain:** migrate on `app.marketersindemand.com` first, then move to New North as a separate step (§10). Phase 0 removes the hard-coded domain so that move is configuration only.

### Still open

- [ ] **Region** for the Supabase project — match the Render region of `mid-app-v1` (Render dashboard → service → region). Render Ohio → `us-east-2`, Virginia → `us-east-1`, Oregon → `us-west-2`, Frankfurt → `eu-central-1`. The backend makes ~1,000 calls/hour to the database, so they must sit close together.
- [ ] **Cutover window** — a weekday evening or Saturday; Pulse syncs are weekday-only and the audit runs Monday 12:00 UTC.
- [ ] **New domain name** — e.g. `app.newnorth.com`.

---

## 3. Phase 0 — Code changes (before any infrastructure)

### 3.1 Move the repos into the Marketers-in-Demand org

Transfer `tpelligrinomid/mid-app-v1` and `tpelligrinomid/master-marketer` (repo Settings → Transfer). History is kept and GitHub redirects the old URLs. Afterwards:

- [ ] Render: install/authorize the Render GitHub app on the org; confirm both services still point at their repo and auto-deploy on push.
- [ ] trigger.dev: Master Marketer deploys from the CLI, so nothing changes unless the GitHub integration is enabled.
- [ ] Local clones: `git remote set-url origin https://github.com/Marketers-in-Demand/<repo>.git`.

### 3.2 pulse-compass changes

Do these in `pulse-compass` on a branch `self-hosted`; merge it at cutover. Lovable can keep editing `main` until then — rebase as needed. Freeze Lovable edits once the rehearsal starts.

| # | Change | File(s) |
|---|---|---|
| 0.1 | Reset-password redirect: replace the `.supabase.co → .lovable.app` swap with a `SITE_URL` secret | `supabase/functions/send-email/index.ts:160,238` |
| 0.2 | Replace the Lovable AI gateway (`ai.gateway.lovable.dev`, `LOVABLE_API_KEY`) with direct Anthropic calls (`ANTHROPIC_API_KEY`). **Test against the real API before merging** | `supabase/functions/account-brief`, `supabase/functions/seed-brand-voice` |
| 0.3 | Take ownership of the MCP function: delete the `AUTO-GENERATED` banner line (the plugin then stops overwriting it), replace `projectRef = "cpjfuttlywafjxefczqc"` with the new ref (or env-driven), remove `mcpPlugin()` from `vite.config.ts` | `supabase/functions/mcp/index.ts`, `src/lib/mcp/index.ts`, `vite.config.ts`, `.lovable/mcp/manifest.json` |
| 0.4 | `project_id` → new ref | `supabase/config.toml` |
| 0.5 | SPA rewrite for Vercel (all routes → `/index.html`; must cover `/.lovable/oauth/consent`) | new `vercel.json` |
| 0.6 | Untrack `.env`, add `.env.example` | `.env`, `.gitignore` |
| 0.7 | Migration (SQL, applied in Phase 1): `notify_release_note_inserted()` reads its URL from Vault instead of the hard-coded ref | new SQL file |
| 0.8 | Lock down `weekly-invoice-audit` (and `quickbooks-auth/refresh`): require a shared secret header, since both run with `verify_jwt=false` and no caller check | edge functions + cron SQL in §6 |
| 0.9 | Remove the hard-coded `app.marketersindemand.com` (MCP tools, Slack links and the favicon in `notify-release-note` and `weekly-invoice-audit`); read it from `SITE_URL` / `VITE_SITE_URL`. Same in the backend's report logo (`backend/src/services/reports/client-status-report.ts:537`). This makes the domain move (§10) configuration only | edge functions, `src/lib/mcp/*`, backend report |

No code changes are needed in `mid-app-v1` or `master-marketer` for the cutover (env vars only).

### Secrets to collect (Lovable cannot export them)

| Secret | Used by | Source |
|---|---|---|
| `BACKEND_API_KEY` | `backend-proxy`, `send-email` | Render env (`BACKEND_API_KEY` / `EDGE_FUNCTION_SECRET` — confirm they're equal; reuse the same value so Render needs no change) |
| `SLACK_BOT_TOKEN`, `SLACK_INVOICE_AUDIT_CHANNEL` | `notify-release-note`, `weekly-invoice-audit` | Slack app / Render env |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` | `quickbooks-auth` | Intuit developer portal / Render env |
| `N8N_EMAIL_WEBHOOK_URL` | `send-email` | n8n |
| `ANTHROPIC_API_KEY` *(new)* | `account-brief`, `seed-brand-voice` | Anthropic console |
| `SITE_URL` *(new)* | `send-email` | `https://app.marketersindemand.com` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to edge functions.

### External registrations (add the new URLs now; keep the old ones until Phase 5)

- [ ] Google Cloud OAuth client → add `https://<new-ref>.supabase.co/auth/v1/callback`
- [ ] Intuit developer app → add redirect URI `https://<new-ref>.supabase.co/functions/v1/quickbooks-auth/callback`
- [ ] Lower DNS TTL on `app.marketersindemand.com` to 60s

---

## 4. Phase 1 — Build the new environment (no downtime)

Connection string: use the **session pooler** URI (port 5432) from the dashboard unless your network has IPv6 — the direct host is IPv6-only.

```bash
export PGBIN=~/scoop/apps/postgresql/current/bin
export NEW_DB="postgresql://postgres.<new-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
export DUMP=growth-pulse-grid_<date>.backup
```

1. **Project:** Pro plan, chosen region, enable PITR. Enable extensions `vector`, `pg_net`, `pg_cron` (Dashboard → Database → Extensions).
2. **Schema (public only), from the export — not from migration files:**
   ```bash
   $PGBIN/pg_restore -s -n public --no-owner -d "$NEW_DB" $DUMP 2> schema_restore.log
   ```
   Review `schema_restore.log`; "already exists" errors for extension-owned objects are fine, anything else is not.
3. **Storage policies** (6 policies on `storage.objects`):
   ```bash
   $PGBIN/pg_restore -l $DUMP | grep "POLICY storage objects" > storage_policies.list
   $PGBIN/pg_restore -L storage_policies.list --no-owner -d "$NEW_DB" $DUMP
   ```
4. **Buckets:** create `deliverable-images`, `deliverable-uploads` (20 MB limit), `content-assets` — all **public**, matching today.
5. **Vault + trigger fix** (0.7): `select vault.create_secret('https://<new-ref>.supabase.co','project_url');` then apply the updated `notify_release_note_inserted()`.
6. **Edge functions:** from the `self-hosted` branch:
   ```bash
   supabase link --project-ref <new-ref>
   supabase secrets set BACKEND_API_KEY=... SLACK_BOT_TOKEN=... (etc, table above)
   supabase functions deploy   # all 12; verify_jwt settings come from config.toml
   ```
7. **Auth settings:** Site URL `https://app.marketersindemand.com`; redirect URLs for prod + `*.vercel.app` previews; email/password + Google enabled; **signups disabled** (invite-only); **OAuth 2.1 server enabled** with dynamic client registration, authorization URL `https://app.marketersindemand.com/.lovable/oauth/consent` (needed by the MCP server).
8. **Vercel:** import `pulse-compass` (branch `self-hosted`), framework Vite, output `dist`. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_API_URL`. Until cutover, previews point at the new project and `VITE_API_URL=http://localhost:3001` (the local backend, below); after cutover, at the production Render backend.
9. **Local backend for the rehearsal:** run `mid-app-v1/backend` with `npm run dev` and a `.env` pointing at the new project (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, same `BACKEND_API_KEY`/`EDGE_FUNCTION_SECRET`). **Leave the QuickBooks variables blank, don't call any `/api/cron/*` route, and avoid Databox features in Compass chat** (see below).

> ⚠️ **QuickBooks: why the rehearsal copy must not touch it**
>
> QuickBooks gives the app two keys, both stored in the `pulse_sync_tokens` table:
> - an **access token** that works for ~1 hour, and
> - a **refresh token** used to get a new access token when it expires.
>
> Every time the refresh token is used, Intuit hands back a **new** refresh token and the old one stops working. It's like a keycard that gets re-cut every time you swipe it.
>
> When we copy the database, the new project gets a copy of the same keycard. Whichever system swipes it first gets the new card; the other is left holding a dead one, and its QuickBooks sync fails until an admin reconnects QuickBooks in the app (~1 minute via the normal "Connect QuickBooks" flow).
>
> So:
> 1. **Rehearsal:** the copy must never swipe the card. No pg_cron jobs, no `quickbooks-auth` calls, no QuickBooks sync. Production keeps working untouched.
> 2. **Cutover:** stop the old system from swiping (disable its cron job) **before** the final export, so the new project receives the latest card and becomes its only user.
> 3. **If it goes wrong anyway:** reconnect QuickBooks once in the new app. Annoying, not dangerous; no data is lost.
>
> The Databox refresh token in the same table behaves the same way (it's used by Compass chat's Databox tools).

---

## 5. Phase 2 — Timed rehearsal (live app untouched)

1. Take a **fresh export** from Lovable Cloud (Cloud → Advanced → Export). **Time the export** — it's part of the cutover window.
2. **Start a timer.** Restore data:
   ```bash
   export PGOPTIONS="-c session_replication_role=replica -c statement_timeout=0"
   # auth first (users + identities only; sessions/tokens are useless after the move)
   $PGBIN/pg_restore -a -n auth -t users -t identities --no-owner -d "$NEW_DB" $DUMP
   # public data, 4 parallel jobs
   $PGBIN/pg_restore -a -n public --no-owner -j 4 -d "$NEW_DB" $DUMP 2> data_restore.log
   ```
   `session_replication_role=replica` skips FK checks and user triggers (audit logs etc.) during the load. Sequence values are restored by `pg_restore` automatically. The upload is ~8.7 GB uncompressed: on a slow home uplink, run the restore from a cloud machine in the same region instead (record which you used).
3. **Refresh materialized views:** `select public.refresh_contract_views();`
4. **Storage files** — 263 objects. Script: read object names from `storage.objects` in the export → download each from the old public URL → upload to the new bucket with the service-role key, preserving paths. (Buckets are public, so no old key is needed.)
5. **Row-count check** — counts per public table from the export vs. the new DB:
   ```bash
   # from the export
   $PGBIN/pg_restore -a -n public -f - $DUMP | awk '/^COPY /{t=$2;n=0;f=1;next} /^\\\.$/{if(f)print t"\t"n;f=0;next} f{n++}' | sort > export_counts.tsv
   ```
   ```sql
   -- in the new DB
   select format('public.%s', relname), n_live_tup from pg_stat_user_tables where schemaname='public' order by 1;  -- run ANALYZE first, or use exact count(*) for the big ones
   ```
6. **Stop the timer.** Record: export time + download + restore + storage + checks.
7. **Smoke-test** on a Vercel preview + the local backend using §8 (skip QuickBooks, Databox, Slack and email-sending items, or test them only against yourself).
8. **Plan the window** = export + restore + storage delta + ~45 min for switching and verification.

---

## 6. Phase 3 — Cutover

**T-1 day:** announce the window in Slack; tell the team the app will be unavailable and everyone will need to log in again afterwards (new signing keys invalidate sessions; passwords still work).

1. **Freeze writes**
   - Render → suspend **all** cron jobs (clickup-sync, quickbooks-sync, recover-deliverables, process-status-reports, generate-strategy-notes, clickup-service-category, sync-process-library, process-library-service-category, clickup-archived-sync, search-visibility, clickup-full-sync, quickbooks-full-sync, backfill-embeddings, generate-management-report).
   - Check no deliverable/content generation is mid-flight (it runs inside the web process).
   - Old project's pg_cron (Lovable SQL editor) — reversible:
     ```sql
     update cron.job set active = false where jobname in ('quickbooks-token-refresh','weekly-invoice-audit');
     ```
     This must happen **before** the export so the QuickBooks token in the export is the last one issued.
   - Post: "Platform offline for migration."
2. **Export** from Lovable Cloud; download.
3. **Wipe rehearsal data** in the new project:
   ```sql
   do $$ declare r record; begin
     for r in select tablename from pg_tables where schemaname='public' loop
       execute format('truncate table public.%I cascade', r.tablename);
     end loop; end $$;
   truncate auth.identities, auth.users cascade;
   ```
4. **Restore** (same commands as Phase 2 step 2), refresh views, copy storage delta, **row-count check must match**.
5. **Recreate pg_cron jobs** in the new project:
   ```sql
   select vault.create_secret('<new anon key>', 'anon_key');   -- project_url created in Phase 1
   select cron.schedule('quickbooks-token-refresh', '*/30 * * * *', $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/quickbooks-auth/refresh',
       headers := jsonb_build_object('Content-Type','application/json',
         'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='anon_key')),
       body := '{}'::jsonb);
   $$);
   select cron.schedule('weekly-invoice-audit', '0 12 * * 1', $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/weekly-invoice-audit',
       headers := jsonb_build_object('Content-Type','application/json',
         'apikey',(select decrypted_secret from vault.decrypted_secrets where name='anon_key')),
       body := jsonb_build_object('time', now()));
   $$);
   ```
   (If 0.8 added a shared-secret header, include it here.)
6. **Switch Render** (production backend) env: `SUPABASE_URL`, `SUPABASE_ANON_KEY` → new project; `QUICKBOOKS_REDIRECT_URI` → new `quickbooks-auth/callback` URL; `FRONTEND_URL` unchanged if the domain stays. `BACKEND_API_KEY`/`EDGE_FUNCTION_SECRET` unchanged if the same value was reused. Redeploy.
7. **Merge `self-hosted` → `main`** in pulse-compass; Vercel production deploy.
8. **DNS:** point `app.marketersindemand.com` at Vercel; remove the custom domain from Lovable publishing.
9. **MCP clients:** remove and re-add the "MiD Pulse and Compass" connector in claude.ai (new URL `https://<new-ref>.supabase.co/functions/v1/mcp`); tell other users to do the same.
10. **Unfreeze:** resume Render cron jobs. Watch the first two ClickUp/QuickBooks sync cycles in `pulse_sync_logs`.

---

## 7. Rollback

- **Before step 6 (Render switch):** nothing has changed for users. Re-activate the old cron jobs (`update cron.job set active = true ...`), resume Render crons, done.
- **After step 6:** revert Render env vars and DNS, re-activate old cron jobs. Data written to the new project after cutover must be copied back by hand, so make the go/no-go call within the first few hours. If the QuickBooks token was refreshed on the new side, reconnect QuickBooks via the app's OAuth flow (one admin, ~1 minute).

---

## 8. Verification checklist

- [ ] Owner, admin, team member and client logins (password + Google) work
- [ ] Client sees only assigned contracts (RLS)
- [ ] Invite: send an invite, accept it, setup completes, `users.auth_id` linked
- [ ] Password reset email arrives and the link lands on `app.marketersindemand.com/reset-password` (not `.lovable.app`)
- [ ] ClickUp + QuickBooks sync run; new rows in `pulse_sync_logs`
- [ ] `quickbooks-token-refresh` runs (`select * from cron.job_run_details order by start_time desc limit 5;`)
- [ ] Points balance/burden matches pre-migration screenshots for 3 contracts; dashboard MRR matches
- [ ] Compass chat answers with citations (pgvector), web search, Databox, SEO tools
- [ ] Generate a deliverable via Master Marketer; the webhook stores the draft
- [ ] Account brief and brand-voice seeding work (Anthropic, not the Lovable gateway)
- [ ] Deliverable images, uploads and content assets open; public share links open signed-out
- [ ] Insert a test release note → Slack message arrives
- [ ] MCP connector: reconnect in claude.ai, `list_contracts` works
- [ ] QuickBooks connect/reconnect flow completes (new redirect URI)
- [ ] Next Monday: weekly invoice audit posts to Slack

---

## 9. Phase 5 — After cutover

1. Keep Lovable Cloud untouched (read-only) for 2–4 weeks as the rollback point, then delete the project.
2. **Disconnect Lovable as an editor** of pulse-compass; move development to Claude Code / the team agent setup.
3. **One migration history:** `supabase db dump` from the new project → a single baseline migration in `supabase/migrations`; archive `drizzle/` and `mid-app-v1/backend/migrations/`. All future schema changes go through `supabase/migrations` only. (Prerequisite for Supabase branching / per-PR preview databases.)
4. Add an npm script for types: `supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts`.
5. Remove Lovable-only code: `lovable-tagger`, `@lovable.dev/mcp-js`, `previewAuthStorage.ts`, `drizzle.config.ts`, `.lovable/`; pick one lockfile.
6. Backend: give Render a service-role key (or a scoped DB role) and retire `backend-proxy` and the duplicate `db-proxy.ts` client.
7. Add an HNSW index on `compass_knowledge.embedding`.
8. Consider dropping or trimming `pulse_tasks.raw_data` (2.9 GB of ClickUp payloads).
9. Monitoring + billing alerts on Supabase and Vercel; restore DNS TTL; remove the old Google OAuth callback and Intuit redirect URI.
10. Build MCP v2 inside the Render backend on a stable hostname (e.g. `mcp.marketersindemand.com`). Scope (see the team plan): `compass_ask`, Master Marketer job tools, Compass chat's research tools (Databox account resolved per contract server-side), ClickUp task creation with **per-user ClickUp OAuth** (no shared token), acting-for identity, audit log. Contract permissions come from Pulse/Compass only.

---

## 10. Phase 6 — Move to the New North domain (separate step, 1–2 weeks after cutover)

Done separately so that if something breaks after cutover we know which change caused it. Adding the domain in Vercel is the easy part; the domain is also allowlisted in several other places:

1. **Vercel:** add `app.newnorth.com` (DNS CNAME to Vercel). Both domains now serve the same app.
2. **Render backend `FRONTEND_URL`:** add the new origin to the comma-separated list. **Without this the backend rejects every request from the new domain (CORS).** Keep the old origin too.
3. **Supabase Auth:** Site URL → new domain; add it to redirect URLs (keep the old one); OAuth server authorization URL → `https://app.newnorth.com/.lovable/oauth/consent`.
4. **Edge function secret `SITE_URL`** + Vercel `VITE_SITE_URL` → new domain (reset links, Slack links, MCP tool links; thanks to Phase 0 item 0.9).
5. **Google OAuth consent screen:** add `newnorth.com` to authorized domains.
6. **n8n email templates** and any links in Slack/n8n workflows that point at the old domain.
7. **Redirect** `app.marketersindemand.com` → `app.newnorth.com` (Vercel domain redirect, keep paths). Keep it **permanently**: clients have share links to deliverables and content assets on the old domain.
8. Tell the team: logins are stored per domain, so everyone logs in once more on the new domain.

Rollback: remove the redirect; the old domain still works throughout.

---

## 11. How changes ship after the migration (no permanent staging)

| Safety net | How |
|---|---|
| See it before it ships | Every PR gets a Vercel preview URL (production data, normal logins and RLS) |
| Automated checks | Typecheck + build (+ tests as they're added) required on every PR |
| Human review where it matters | CODEOWNERS: the founder approves `supabase/migrations/**`, auth/RLS, billing/QuickBooks, edge functions. Narrow this as trust grows |
| Undo | Vercel instant rollback; Render redeploy of the previous version; Supabase PITR (rewind the database to any second in the retention window) |
| Who can touch production data directly | Only the 2–3 members of the production Supabase org |
| Later, if agents write many migrations | Supabase branching: throwaway database per PR, created from migrations, deleted on merge |

---

# Part B — Team and agent operating model

## 12. Coding agents: what we use and why

### Decision: Claude Code is the standard; the repos stay tool-neutral

**Claude Code (Team plan)** is the team standard. Amp is not.

Why Claude Code:
- **It covers all three lanes we need** (table below): people at a terminal, non-engineers asking through GitHub issues, and unattended agents in GitHub Actions on a schedule. That third lane is what platform monitoring (§13) runs on.
- **Already in use.** The founder's workflow, conventions and MCP setup carry over unchanged. A second vendor would mean two sets of conventions and two bills.
- **Shared configuration lives in the repo** (`CLAUDE.md`, `.claude/skills`, `.mcp.json`), so every person and every agent works from the same instructions.

Why not Amp as the standard:
- It's a strong tool for individual engineers, with pay-per-token pricing and shareable threads.
- But it has no route for non-engineers (no Slack or issue intake we could confirm), and we found no built-in way to run scheduled background agents.
- An engineer who prefers Amp, Codex or Cursor personally can still use it: the instructions live in `AGENTS.md`, which those tools read (see below).

### Three lanes

| Lane | Who | How | Seat |
|---|---|---|---|
| **Build** | Founder + 2–4 builders | Claude Code CLI / desktop / web sessions. Work on a branch, open a PR, preview link, merge after checks and review | Premium (~$100–125/mo) |
| **Request** | Strategists, account team | Open a GitHub issue and mention `@claude`; get back a draft PR with a Vercel preview link; a builder reviews | No seat needed (runs on the org API key via the GitHub Action) |
| **Autonomous** | Agents, no human at the keyboard | **Claude Code GitHub Action** (`anthropics/claude-code-action`), triggered by PRs, issues, `@claude` mentions, alerts and **cron schedules**. Lives in the repo as workflow files, runs on an org API key with a spend cap | API usage |

Autonomous agents run as **GitHub Actions workflows, not personal "routines"**:
- Workflows are owned by the org.
- They're versioned and reviewable like code.
- They keep running if someone leaves.

Claude Code routines are tied to one person's account and are in research preview.

### Repo setup every agent reads

| File | Purpose |
|---|---|
| `AGENTS.md` | The source of truth: architecture, commands (dev/build/typecheck/test), conventions, "never do" list. Read by Amp, Codex, Devin, Cursor |
| `CLAUDE.md` | `@AGENTS.md` plus Claude-specific notes |
| `.claude/skills/` | Runbooks as skills, e.g. "investigate a sync failure", "add a migration", "deploy Master Marketer (git push **and** `trigger.dev deploy`)" |
| `.mcp.json` | Shared MCP servers: Supabase (**read-only mode**), Sentry, trigger.dev, Vercel, Render |
| `REVIEW.md` | What the PR-review agent checks: RLS on new tables, migrations reversible, no secrets, no hard-coded URLs |
| `.github/workflows/` | CI checks + the agent workflows in §13 |
| `CODEOWNERS` | Founder approval on migrations, auth/RLS, billing/QuickBooks, edge functions |

### Other tools considered (2026-10-10)

| Tool | Verdict |
|---|---|
| **Amp** | Fine for an individual engineer. Not the standard (no non-engineer lane, no scheduled agents confirmed) |
| **Devin** | Best "assign a ticket to an AI teammate" experience via Slack/Linear, with free flex seats for non-engineers. Revisit only if Claude's Slack lane falls short; it costs a second vendor and usage billing that's hard to predict |
| **GitHub Copilot Business** ($19/user) | Optional cheap second PR reviewer and "assign issue to Copilot" route |
| **Cursor, Factory** | Overlap with Claude Code; skip |
| **Jules** | No team plan; skip |
| **Lovable / v0** | Disconnected after cutover. Lovable can't work on an existing repo; the GitHub issue → PR → preview loop replaces it for non-engineers |

---

## 13. Agent operations: monitoring and maintaining the platform

Goal: agents watch the platform continuously, catch errors and drift early, diagnose them, and propose or apply fixes, so problems are found before clients or the team notice.

### 13.1 Principles

1. **Plain checks detect, agents diagnose, humans approve.**
   - Simple scheduled checks (no AI) run every few minutes. They're cheap and reliable.
   - Agents are called in when a check fails, and on a daily or weekly sweep.
2. **Agents can only read production.**
   - They change things through pull requests, and a human merges.
   - They run migrations, change environment variables, or edit data only through the short allowlist in §13.5.
3. **Everything an agent does leaves a trail** as a GitHub issue, a PR or a Slack post.
4. **Agents get their own least-privilege credentials** (§13.6), never the production service-role key.

### 13.2 Foundation: what must exist before agents can monitor anything

Today the only monitoring is a shallow `/health` endpoint on the backend: no error tracking, no uptime checks, no alerting. Build this first.

| Piece | What | Covers |
|---|---|---|
| **Error tracking** | Sentry in the React app, the Express backend, edge functions (Deno SDK) and Master Marketer. Tag every release with its git commit | Exceptions with stack traces, linked to the commit that caused them |
| **Uptime** | External checks every 1–5 min (Better Stack, Checkly or similar), with Slack alerts | `app` URL, backend `/health`, Master Marketer `/api/health`, MCP endpoint |
| **Business health view** | A SQL view `ops.health_checks` plus a backend route `/api/health/deep` (protected), returning one row per check: `ok / warn / fail` | Below |
| **Platform signals** | Supabase advisors (security and performance lints), Supabase and Render logs, trigger.dev failed runs, Vercel deploy status | Read by agents over MCP and APIs |

**Business health checks.** These are what matter most: the failures that hurt the business without throwing an error.

| Check | Source | Fails when |
|---|---|---|
| ClickUp sync fresh | `pulse_sync_state.last_successful_sync_at` (service = clickup) | > 45 min old on a weekday, working hours |
| QuickBooks sync fresh | `pulse_sync_state` (service = quickbooks) | > 45 min old on a weekday |
| QuickBooks token healthy | `pulse_sync_tokens` (service = quickbooks) | `is_active = false`, or `expires_at` in the past for > 1 h |
| Sync errors | `pulse_sync_logs` | Any `status` = error in the last hour, or the error rate is climbing |
| Scheduled DB jobs | `cron.job_run_details` | Any failed run in the last 24 h |
| Stuck deliverables | `compass_deliverables` | Still in a generating state > 60 min after `updated_at` |
| Master Marketer jobs | trigger.dev runs | Failed or crashed runs in the last 24 h |
| Embeddings backlog | `compass_knowledge` | Rows with `embedding IS NULL` older than 1 day |
| Databox connection | `pulse_sync_tokens` (Databox) | Token inactive or expired |
| Weekly invoice audit | `cron.job_run_details` + Slack | Didn't run by Monday 13:00 UTC |

A scheduled job (pg_cron or a Render cron) evaluates the view every 5–15 minutes and posts to `#platform-health` when a check turns to `fail`. No AI is involved at this layer.

### 13.3 The agents

All run as Claude Code GitHub Action workflows in the relevant repo (or the future monorepo).

| Agent | Trigger | What it does | Output |
|---|---|---|---|
| **PR reviewer** | Every PR | Reviews the diff against `REVIEW.md`: bugs, RLS on new tables, migration safety, secrets, hard-coded URLs | PR comments (advisory; required checks are separate) |
| **@claude helper** | `@claude` in an issue or PR | Implements the request on a branch | Draft PR + preview link |
| **Incident triage** | A check fails, a new Sentry issue appears or uptime drops. The alert opens a GitHub issue labelled `incident`, which starts the workflow | Reads the error, logs and recent deploys, queries the DB read-only, finds the cause; if the fix is code, opens a PR | Diagnosis in the issue, a draft fix PR, a Slack ping |
| **Daily health sweep** | Weekdays 07:00 ET (cron) | Summarizes the last 24 h: new and rising Sentry errors, sync health, failed jobs, cron runs, Supabase advisors, slow queries, spend | Slack digest; a GitHub issue for each new problem |
| **Weekly discrepancy audit** | Sundays (cron) | **Schema drift**: production vs migration files (`supabase db diff`). **Env drift**: variables read in code vs `.env.example` vs what's configured. **Data reconciliation**: last month's QuickBooks invoices vs `pulse_invoices`, ClickUp task counts vs `pulse_tasks`, points summary vs a fresh recompute. **Docs drift**: `AGENTS.md`/`CLAUDE.md` vs reality. **Dependencies**: security advisories | One issue per discrepancy, with evidence and a proposed fix |
| **Dependency upkeep** | Dependabot/Renovate PRs | Fixes the upgrades that break the build | Updated PR |

### 13.4 How an incident flows

```text
check fails / Sentry alert / uptime alert
   → GitHub issue (label: incident) + Slack #platform-health
   → triage agent investigates (read-only: Sentry, logs, DB, trigger.dev, recent commits)
   → writes diagnosis on the issue
   → code fix?  opens PR → checks + preview → human merges → deploy → check turns green
   → ops fix?   runs an allowlisted action (§13.5) or asks a human
```

### 13.5 Safe actions agents may take on production (added once trust is earned)

Start with **none**: agents diagnose and open PRs only. Then allow, one at a time, actions that are idempotent and already exposed as endpoints:

- Re-run a sync: `POST /api/cron/clickup-sync`, `/quickbooks-sync`
- Retry a stuck deliverable: `POST /api/cron/retry-deliverable-generation`
- Replay a failed trigger.dev run

These go through a dedicated **ops API key** that only those routes accept. Every call is logged to the incident issue.

**Never allowed:** merging, running migrations, changing env vars or secrets, deleting data, touching auth or users, and anything in QuickBooks beyond reading.

### 13.6 Credentials for agents

| Credential | Scope |
|---|---|
| Postgres role `agent_readonly` | `SELECT` on `public` (and `cron.job_run_details`); no `auth`, `vault` or `storage`. Used by the Supabase MCP in read-only mode |
| Sentry token | Read issues and events |
| trigger.dev | Read runs; replay only once §13.5 allows it |
| Render / Vercel | Read logs and deploys. Where a vendor only offers full-access keys, store them only in the protected GitHub `ops` environment used by the ops workflows |
| Anthropic API key | Org key dedicated to agents, with a monthly spend limit |
| Ops API key | Only the §13.5 routes |

All are stored as GitHub Actions secrets in a protected `ops` environment, never in agent-readable files.

### 13.7 Rollout order

1. **Cutover + 1 week:** Sentry everywhere; uptime checks; `#platform-health` channel.
2. **+2 weeks:** `ops.health_checks` view + alerting; `AGENTS.md`/`CLAUDE.md`/`REVIEW.md` in each repo; CI checks; PR reviewer.
3. **+3 weeks:** daily health sweep; `@claude` helper; request lane (GitHub issues) piloted with 2–3 people.
4. **+4–6 weeks:** incident triage agent; weekly discrepancy audit.
5. **After a month without surprises:** allow the first safe action (re-run sync).

Cost: seats as in §12, plus API usage for the autonomous agents. Set the spend limit before turning anything on, and review actual spend after the first month.

---

## 14. Timeline

| When | What | Downtime |
|---|---|---|
| Week 1 | Repo transfers; Phase 0 code changes + secrets + registrations; Phase 1 build | None |
| Week 2 | Phase 2 rehearsal (timed), fix issues, schedule window | None |
| Cutover day | Phase 3 | Measured in rehearsal (export + restore + ~45 min) |
| Weeks +1–4 | Phase 5; old project kept for rollback | None |
| Weeks +1–2 | Phase 6 domain move | None (one extra login) |
| Weeks +1–6 | Part B rollout (§13.7) | None |
