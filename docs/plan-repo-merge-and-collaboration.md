# Repo merge + team development — plan (draft)

Status: **planning.** Drafted 2026-10-19. Goal: one repository for the MiD platform (frontend + backend + database) that other developers can clone, read and review, and a way of working that supports more than one person changing it. **Master Marketer stays its own repo.**

## Where things are today

| | Frontend | Backend |
|---|---|---|
| Repo | `Marketers-in-Demand/pulse-compass` (org) | `tpelligrinomid/mid-app-v1` (personal account) |
| History | 2,105 commits (Lovable + Claude Code) | 341 commits |
| Stack | Vite + React + TS, **bun** | Express + TS (NodeNext), **npm** |
| Deploys | Vercel, production branch `main` | Render (`mid-app-v1`), configured in the dashboard (no `render.yaml`) |
| Database | `supabase/` — 132 migrations, edge functions, `config.toml` | `backend/migrations/` — 22 older numbered SQL files, applied by hand |
| Docs | `README`, `ARCHITECTURE.md`, `AGENTS.md`, style guides, `docs/` | `docs/` (migration runbook, MCP v2, data tools, specs) |
| CI | none | none |

Checked 2026-10-19: no secrets in either history (the frontend's old `.env` held only the retired Lovable project's public keys). Local-only files with secrets (`migration_from_lovable.env`, `backend/.env*`) are gitignored and stay that way.

## Recommendation

**Merge the backend into the org repo, with full history, as a monorepo.** Rename the repo to something neutral (e.g. `Marketers-in-Demand/mid-platform`; GitHub redirects the old URL, and Vercel stays connected).

Why the org repo: it's already org-owned (team access, permissions), has the larger history and the Vercel connection. The backend moves out of a personal account, which matters once others contribute.

### Layout

```
/
├── frontend/          # was pulse-compass root (Vite app)
├── backend/           # was mid-app-v1/backend (Express API, MCP, crons)
├── supabase/          # the ONE place for migrations, edge functions, config.toml
├── docs/              # both docs folders merged (architecture, runbooks, specs, plans)
├── scripts/           # ops scripts (migration, checks)
├── README.md          # what this is, how to run it locally, where things deploy
├── ARCHITECTURE.md    # system map: frontend ↔ backend ↔ Supabase ↔ Master Marketer ↔ integrations
└── CLAUDE.md / AGENTS.md  # shared conventions for AI-assisted development
```

No package workspaces at first — `frontend/` and `backend/` keep their own `package.json` and package manager. Keep it boring; tooling can be unified later.

### Database migrations

- `supabase/migrations/` becomes the single source of truth.
- The 22 legacy `backend/migrations/*.sql` files move to `supabase/legacy-backend-migrations/` with a README (already applied; kept for history, not re-run).
- From now on every schema change is a migration file in a PR, applied with the Supabase CLI after review — no ad-hoc SQL against production (including from Claude Code sessions).

### Deploys after the merge

| | Change |
|---|---|
| **Vercel** | Root directory → `frontend/`. "Ignored build step" so backend-only commits don't rebuild the frontend. Preview deploy per PR (already free). |
| **Render** | Point the service at the merged repo, root directory `backend/`, **build filter** `backend/**` so frontend-only commits don't redeploy the API. Same env vars. |
| **Supabase functions** | Deployed with the CLI today; later a GitHub Action deploys changed functions on merge to `main`. |
| **Old backend repo** | Archive (read-only) after the first successful deploys from the new repo. Keep it; don't delete. |

### Steps (about half a day, plus a quiet window for the switch)

1. **Prep** — commit or discard pending local work in both repos; decide on untracked folders (`reports/`, `research_notes/` may contain client data → keep out of the repo); remove stray files.
2. **Merge with history** — rewrite the backend repo's paths into `backend/`, `docs/`, `scripts/` (`git filter-repo --to-subdirectory-filter`-style), then merge into the org repo with `--allow-unrelated-histories`; move the frontend into `frontend/`; merge the two `docs/` folders and the migration folders.
3. **Verify locally** — both apps build, type-check and run; backend tests/scripts still resolve paths.
4. **Switch deploys** (quiet window) — update Vercel root directory and Render repo/root/filters; push; confirm both deploy and the app, MCP and crons work.
5. **Archive** the old backend repo; update bookmarks, the runbook and memory.

Risk is low if the switch is done in one sitting: a wrong Render/Vercel setting fails the build and the previous deploy keeps serving.

## How we work together

Today: one person, pushing straight to `main`, which auto-deploys. With two developers we keep what PRs give for free — checks, previews, a record of every change — without making every change wait for the other person.

### Review policy: PRs always, approvals only where mistakes are expensive

1. **Every change goes through a PR and CI must pass.** No direct pushes to `main`. **0 approvals required by default**: when checks are green, the author merges their own PR.
2. **Risky areas require the other person's approval**, enforced by GitHub (`CODEOWNERS` + "require review from code owners" in a ruleset on `main`). Only PRs touching these paths wait:
   - `supabase/migrations/**` — database schema
   - RLS / auth (`supabase/migrations` policies, `backend/src/middleware/auth*`, OAuth consent)
   - `backend/src/services/mcp/**`, `backend/src/routes/mcp.ts` — external access to client data
   - QuickBooks / billing (`backend/src/services/quickbooks/**`, invoice functions)
   - Deploy config and secrets handling (`frontend/vercel.json`, `supabase/config.toml`, `.github/**`)
3. **Claude reviews every PR** (GitHub Action) within minutes and comments on bugs and risks; the author fixes or dismisses each point. Comment "@claude …" on a PR or issue to have it make a change as a new commit/PR.
4. **Ship / Show / Ask** for everything else — the author picks:
   - **Ship:** trivial (copy, styling, docs) → merge when green.
   - **Show:** merge, then tag the other person to look when convenient.
   - **Ask:** wait for approval. Mandatory for the risky areas above.
5. **Safety valves:** admin bypass for genuine emergencies (logged in GitHub); same-day review expectation for "Ask" PRs; a 15-minute weekly skim of what merged.

### Supporting practices

- **CI on every PR** (GitHub Actions): frontend type-check + lint + build + vitest; backend type-check + build.
- **Preview deploys:** Vercel builds a preview per PR (talks to the production backend; fine for UI review — writes are real).
- **No staging:** backend and migration changes are reviewed in code and tested locally; migrations are additive-first (add in one PR, remove later); risky changes go out behind a switch. Supabase branching is available later if a per-PR database is ever needed.
- **Secrets:** a shared vault for env values; `.env.example` kept current in both apps.
- **PR template:** what, why, how tested, screenshots, migration (y/n).
- **Shared `CLAUDE.md`** at the root with the repo's conventions (structure, how to run, migration rules, "test Claude API changes against the real API before merging", Windows/CRLF notes) so both developers' Claude Code sessions follow the same rules.
- **Docs as onboarding:** `README` (run it locally), `ARCHITECTURE.md` (system map), `docs/runbooks/`, `docs/specs/`, `docs/plans/`.
- **No separate agentic coding platform:** Claude Code locally and in GitHub (review Action, "@claude" on issues/PRs, Claude Code on the web) covers background work delivered as PRs. Revisit only if a backlog of well-specified tickets builds up.

### What changes for you

- No more push-to-main, but for most changes the PR merges itself as soon as checks pass (you click Merge).
- Database, security, MCP and billing changes wait for Colin's approval (and his for yours).

## Decisions (2026-10-19)

1. **Repo:** `Marketers-in-Demand/new-north-platform` (rename of `pulse-compass`; GitHub redirects the old URL).
2. **Layout:** `frontend/` + `backend/` + `supabase/` + `docs/` + `scripts/`.
3. **Developers:** TP and Colin. Access per repo inside the existing org (Team plan, 3 seats): org base permission "No permission"; TP owner/admin; Colin **Write** or **Maintain** on this repo (he is Admin on `pulse-compass` today). No separate GitHub org needed (unlike Supabase, GitHub access is per repo).
4. **Process:** pull requests for every change, but **approvals only for risky areas** (see *Review policy*). CI must pass; Claude reviews every PR automatically; admin bypass for emergencies only. Vercel preview per PR for frontend review.
5. **No staging environment.** Backend/database changes are reviewed in code and tested locally; migrations additive-first (add in one PR, remove later), risky changes behind a switch. Supabase branching is the option if a per-PR database is ever needed.
6. **`reports/` and `research_notes/`** stay in the repo (private, two people).

## Related

- `docs/mid-platform-lovable-migration-plan.md` — Phase 5 item 11 (combine repos).
- `docs/plan-newnorth-rebrand.md` — the repo/org name may follow the rebrand.
