# New North rebrand — platform plan (draft)

Status: **planning, not started.** Drafted 2026-10-18. Covers moving the MiD platform (Pulse + Compass, the backend, Master Marketer output, emails and shared links) from Marketers in Demand to the **newnorth.com** brand: domain, logo, styling and the brand inside generated documents.

Until cutover, everything new (e.g. Agendas, `docs/spec-agendas.md`) uses the **Marketers in Demand** styling, but is built on the brand settings below so it switches with everything else.

## Principles

1. **Brand as configuration, not find-and-replace.** Put name, logos, colors, fonts, domains and email identity in one brand config per repo (frontend theme + backend/Master Marketer constants). Cutover becomes flipping one setting and deploying, and we can preview New North styling before switching.
2. **Both domains work during the transition; old links keep working forever.** Client share links, the MCP connector URL people installed in claude.ai, password-reset emails and OAuth callbacks all point at `marketersindemand.com` today. They must redirect, not break.
3. **Client-facing first, internal second.** What clients see (shared deliverables, agendas, emails, generated documents) matters most; internal screens can follow.
4. **Delivered documents keep the brand they were delivered under.** We don't rewrite history; new and revised documents use the new brand.

## Inventory (scanned 2026-10-18)

### Domains in use

| Host | Used for | Where configured |
|---|---|---|
| `app.marketersindemand.com` | The web app; deep links from Ask Compass, MCP and Slack; share links (`/d/<id>`, shared assets) | Vercel domain; `APP_URL` (Render); **hard-coded fallbacks** in `backend/src/services/mcp/app-url.ts`, `services/content-generation/chat-tools.ts`, `services/deliverables/chat-tools.ts`; Supabase functions `notify-release-note`, `send-email`, `weekly-invoice-audit` |
| `mcp.marketersindemand.com` | MiD MCP v2 (claude.ai connectors installed by staff) | Render custom domain; `backend/src/routes/mcp.ts` host guard; `MCP_PUBLIC_URL` deliberately unset so an alias works |
| `forms.marketersindemand.com` | Links inside contract resources data (52 rows in the contract-resources migration export) | Data, not code |
| `marketersindemand.com` | Marketing site, email sending domain | DNS (`docs/dns-marketersindemand.com.10.17.26.txt`) |

### Systems tied to the domain (must be updated together)

- **Vercel**: add `app.newnorth.com` (or chosen host); redirect old host.
- **Supabase Auth**: Site URL + redirect allow-list (login, magic links, password reset); OAuth 2.1 server consent page (`/.lovable/oauth/consent`) and issuer as seen by MCP clients.
- **Render**: `FRONTEND_URL` (CORS), `APP_URL`, MCP custom domain alias (`mcp.newnorth.com`).
- **QuickBooks (Intuit)**: OAuth redirect URI.
- **Databox / Nightwatch / Slack**: tokens aren't domain-bound; Slack messages contain app links (follow `APP_URL`).
- **Email**: sender domain and templates (n8n + Gmail today; Resend migration planned — do it on newnorth.com: SPF, DKIM, DMARC); the logo URL in emails is already broken (runbook follow-up).
- **claude.ai MCP connectors**: staff re-add the connector on the new URL (old one keeps working via alias).

### Brand name and styling

| Area | Files / place | Notes |
|---|---|---|
| App chrome | `pulse-compass/src/components/layout/AppSidebar.tsx` (logo), `index.html` (title, meta), `public/favicon.svg/.ico` | "MiD Marketers in Demand" lockup in the sidebar |
| Theme | `pulse-compass/src/index.css` — `--primary: 263 70% 50%` (purple), `--gradient-primary`, `--shadow-purple`, sidebar tokens; Tailwind config | Replace with New North palette tokens |
| Auth pages | `Login.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `OAuthConsent.tsx` | Client and staff see these |
| Public pages | `pages/public/SharedDeliverable.tsx`, `SharedContentAsset.tsx` | **Client-facing** — highest priority |
| Deliverable renderers | `components/deliverables/renderers/*` (roadmap, content plan, SEO audit, program roadmap, points plan) | Colors, headers, any logo |
| Agendas (new) | Markdown renderer + Present mode | Build on brand tokens from day one |
| Downloads | Markdown/PDF exports | Footer/brand line |
| Emails | Supabase `send-email`; backend `services/reports/client-status-report.ts` (HTML status report, contains "Marketers in Demand"); strategy notes | **Client-facing** status reports |
| Generated documents | Master Marketer prompts — `src/prompts/roadmap-boilerplate.ts` names the agency; ~7 prompt files reference "MiD" | Agency name inside roadmaps/plans the clients read |
| Ask Compass / MCP | MCP server display name "MiD Pulse and Compass"; release notes; tool descriptions mentioning MiD | Internal |
| Product names | "Pulse" and "Compass" | Decide: keep as product names under New North, or rename |

18 backend files and 7 Master Marketer files use "MiD" — mostly comments and log prefixes (leave those); the plan only changes **user-visible** strings.

## Phases

| Phase | What | Notes |
|---|---|---|
| **0. Decide & prepare** | Brand kit from newnorth.com (logo files incl. dark/light/icon, colors, fonts, voice); decisions below; centralize brand config in each repo (no visual change yet) | The config work removes the 3 hard-coded app URLs and the scattered name strings |
| **1. Domains (dual-run)** | Add `app.newnorth.com` + `mcp.newnorth.com`; Supabase/Intuit/CORS allow both; email domain on newnorth.com (with the Resend migration) | Both hosts serve the same app; no visual change |
| **2. Client-facing brand** | Shared deliverable/asset pages, agendas, status report emails, auth pages, favicon/title — New North theme | Preview behind a setting before switching |
| **3. Generated documents** | Master Marketer: agency name and boilerplate in roadmap/plan/brief prompts; any branded sections in renderers | Applies to new and revised deliverables only |
| **4. Cutover** | Make newnorth.com primary: `APP_URL`, links in Slack/emails/Ask Compass; old host 301-redirects (paths preserved, so `/d/<id>` links keep working); announce to staff (re-add MCP connector) and clients | One release note + client email |
| **5. Cleanup** | Internal screens and naming, MCP display name, docs, remove MiD assets; keep redirects and the MCP alias indefinitely | Old domain stays registered |

## Decisions needed

1. **Hostnames:** `app.newnorth.com` and `mcp.newnorth.com`? (MCP was set up so an alias works without code changes.)
2. **Timing:** tie the platform cutover to the public rebrand date, or ship the app first?
3. **Product names:** keep "Pulse" and "Compass"? Do clients see either name?
4. **Delivered documents:** confirm we leave already-delivered deliverables as they are (proposed), and only new/revised ones carry New North.
5. **Email:** send from which address on newnorth.com, and does the Resend migration happen as part of this?
6. **Legal/footer text:** company name and address for emails and shared pages.
7. **Client communication:** do clients get a heads-up about the new links/logins (login URL changes; old one redirects)?

## Related

- `docs/mid-platform-lovable-migration-plan.md` — Phase 5 follow-ups: Resend email migration + logo, combine repos.
- `docs/spec-agendas.md` — agendas use MiD styling until this cutover, built on the brand settings.
- `docs/mcp-v2-plan.md` — MCP hostname alias (`MCP_PUBLIC_URL` unset on purpose).
