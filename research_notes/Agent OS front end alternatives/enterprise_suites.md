# Big-vendor enterprise AI workspace suites as a company-wide "agent OS" (~30-person agency), as of Oct 2026

Scope: Claude for Work (Team/Enterprise), ChatGPT Business/Enterprise, Microsoft Copilot Studio / M365 Copilot, Google Gemini Enterprise, Glean, Notion AI Custom Agents. Scored against 6 requirements: (1) per-user OAuth to a custom remote MCP server, (2) per-agent access control, (3) multi-model including Claude and open models, (4) scheduled runs under the owner's identity, (5) skills as code in Git, (6) pricing and caps.

Method note: several OpenAI help-center pages (help.openai.com, openai.com/index) returned HTTP 403 to the fetch tool, so the ChatGPT findings rely on search-result excerpts of those pages plus secondary coverage. Microsoft, Google, Glean, Notion and Anthropic docs were fetched directly where cited as such.

## Which suites come closest overall, even if they fail the multi-model requirement?

### Takeaway
Claude for Work (Team/Enterprise) comes closest on requirements 1, 4 and 5. It has documented org-wide custom connectors with per-user OAuth (CIMD, DCR or a static client), scheduled runs that act as the routine owner, and org skill provisioning. It fails requirement 3 (Claude only), and per-agent RBAC is weaker than Glean's or ChatGPT workspace agents'. Glean is the strongest on access control plus scheduled-run governance plus multi-model including Claude, but it is enterprise-priced and opaque. ChatGPT Business workspace agents are a credible second for a 30-seat agency (per-user or agent-owned app connections, RBAC sharing, schedules) but are OpenAI-models-only. Copilot Studio has the best-documented MCP OAuth options (DCR with discovery) and both OpenAI and Claude models, but it brings Power Platform complexity and credit metering. Gemini Enterprise is weakest on MCP OAuth (no DCR or discovery reported, manual IdP client registration) and has a 14-day credential refresh for schedules. None of the six supports open models via OpenRouter or local models in the end-user workspace.

### Cited Findings

**Scorecard summary (detail in later sections)**

| Req | Claude Team/Ent | ChatGPT Business/Ent | Copilot Studio / M365 | Gemini Enterprise | Glean | Notion Custom Agents |
|---|---|---|---|---|---|---|
| 1 Per-user OAuth custom MCP, org-wide | Yes (CIMD, DCR, or own client) | Yes, beta (admin publishes custom apps) | Yes (DCR+discovery, DCR, manual) | Partial (admin data store; manual OAuth client; no DCR reported) | Yes (Connectors page; per-server write approval) | Custom MCP supported; identity model unclear |
| 2 Per-agent RBAC | Partial (projects sharing; skills/plugins org-wide or by group on Ent) | Yes (role-based agent visibility) | Yes (agent sharing plus Entra/Power Platform) | Partial (unverified) | Yes (IdP groups for scheduling and sharing) | Yes (per-agent permissions; admin controls) |
| 3 Claude + open models | Claude only | OpenAI only | OpenAI + Anthropic; no open models in M365 Copilot | Gemini + Claude (preview or limited) | Multiple, including Claude Opus 5.5 / Sonnet 5.5 | GPT, Claude, Gemini (secondary) |
| 4 Scheduled runs as owner | Yes (Cowork scheduled tasks; Claude Code routines run "as you") | Yes (schedules; per-user or agent-owned connection) | Yes, via agent flows/triggers (identity details unverified) | Yes (user credentials; refresh every 14 days) | Yes (user-activated; cap of 10 active per user) | Yes (schedules/triggers; credits) |
| 5 Skills as code | Yes (SKILL.md; org provisioning; repo skills in routines) | Partial (agents auto-add "skills"; no Git workflow documented) | Partial (solutions/ALM, not SKILL.md) | Partial (Skills Registry, billed) | No evidence | No |
| 6 Price ~30 seats | ~$20–25/std seat (secondary) | $20/$25 per seat; agents on credits | Credits ($200/25k pack, secondary) + M365 Copilot license | ~$21–60/seat (secondary) | Not public; ~$99k median contract (secondary) | Business seat + $10 per 1,000 credits |

- Claude: "On Team and Enterprise plans, an Owner adds the connector for the organization, and members then connect with their own account." — [Claude docs: Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/remote-mcp.md)
- Claude routines: "Anything a routine does through your connected GitHub identity or connectors appears as you" — [Claude Code docs: Routines](https://code.claude.com/docs/en/web-scheduled-tasks)
- ChatGPT workspace agents: access "follows role-based permissions, so users can only see and run agents they have permission to access"; builders "choose whether apps use each user's account or an agent-owned shared connection" (search excerpt of OpenAI help article) — [OpenAI Help: ChatGPT Workspace Agents for Enterprise and Business](https://help.openai.com/en/articles/20001143-chatgpt-workspace-agents-for-enterprise-and-business)
- Copilot Studio MCP wizard supports OAuth "Dynamic discovery", "Dynamic" (DCR without discovery) and "Manual" options — [Microsoft Learn: Connect your agent to an existing MCP server](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- Glean release notes list Claude Opus 5.5 as a premium model in Assistant and Agents (Sep 22, 2026) and Claude Sonnet 5.5 as selectable (Sep 29, 2026) — [Glean release notes Sep 22, 2026](https://docs.glean.com/release-notes/releases/2026-09-22-september-release); [Glean release notes Sep 29, 2026](https://docs.glean.com/release-notes/releases/2026-09-29-september-release)

### Inferences
- If multi-model is a hard requirement, only Glean, Copilot (OpenAI+Claude), Notion (GPT/Claude/Gemini) and Gemini Enterprise (Gemini+Claude, limited) partially qualify, and none offers OpenRouter or local or open-weight models to end users. An "agent OS" with open models therefore needs a self-hosted or third-party front end (out of scope here) or a gateway behind a custom MCP server.
- For a Claude-first agency that already runs a custom OAuth MCP server (MiD Pulse/Compass is already connected to claude.ai as a custom connector in this environment), Claude Team/Enterprise has the least friction. Its main gaps are the model lock-in and the lack of a shared, group-scoped "agent" object comparable to a ChatGPT workspace agent.

### Gaps
- No primary source found for a Claude Team/Enterprise group-based per-Project visibility control (e.g. "Finance project visible only to leaders group"). Projects can be shared, but group/SCIM scoping was not verified.
- OpenAI help pages could not be fetched directly (403), so OpenAI details are from search excerpts.

## Requirement 1: Per-user OAuth to a custom remote MCP server (with DCR/discovery)

### Takeaway
Claude, Copilot Studio and ChatGPT (beta) document per-user OAuth with admin-added org connectors. Claude supports CIMD ("published identity"), DCR or a static client. Copilot Studio supports DCR with discovery, DCR alone, or manual. Gemini Enterprise requires manual OAuth client registration; one vendor page reports no DCR or discovery. Glean and Notion support custom MCP, but their per-user OAuth details were not verified in primary docs.

### Cited Findings
- **Claude:** plans for remote URL connectors are "Free, Pro, Max, Team, and Enterprise". On Team/Enterprise only an Owner (or, on Enterprise, a custom role with library management) can add one, and it then appears to members with a "Custom" label for each to Connect — [Claude docs](https://claude.com/docs/connectors/custom/remote-mcp.md)
- **Claude OAuth client options:** "Use Claude's published identity" (Client ID Metadata Document hosted by Anthropic, recommended); "Register automatically" (Dynamic Client Registration); "Use your own OAuth client". Auth modes are "Sign in now", "Sign in when needed" and "No sign-in". Request-header auth (API keys, up to four headers) is "in beta and available to a limited set of organizations". Auth settings can't be changed after adding; you have to remove and re-add the connector — [Claude docs](https://claude.com/docs/connectors/custom/remote-mcp.md)
- **ChatGPT:** "full MCP support, including write actions, is in beta for Business, Enterprise, and Edu"; admins/owners enable developer mode, "create and test custom apps, and publish them for their workspace" (search excerpts) — [OpenAI Help: Developer mode, apps and full MCP connectors](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt). Remote HTTPS servers only (secondary) — [usecarly](https://www.usecarly.com/blog/chatgpt-mcp-servers/). DCR/CIMD specifics were not verified.
- **Copilot Studio:** the MCP onboarding wizard offers None, API key or OAuth 2.0 (Dynamic discovery, Dynamic or Manual). "OAuth 2.0 lets individual users authenticate with the server". Streamable transport only, with SSE unsupported "after August 2025". MCP access is governed by Power Platform connector data (DLP) policies. A BYO MCP server can also be registered via "Agents 365 CLI and Microsoft 365 Admin Center". Page updated 2026-08-19 — [Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- **Gemini Enterprise:** an admin registers the server once as a "custom MCP server data store". You register Gemini Enterprise as an OAuth client with your IdP (redirect `https://vertexaisearch.cloud.google.com/oauth-redirect`). StreamableHTTP only. The IdP and server must be public — [Google Cloud docs: Set up custom MCP server data store](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server). The claim that it supports neither DCR nor discovery comes from a third-party vendor page (search excerpt) — [SecureAuth](https://docs.secureauth.com/ai/agents/gemini-enterprise/)
- **Glean:** "As of September 22, 2026, all new MCP connections are set up through the Connectors page" — [Glean release notes Sep 22, 2026](https://docs.glean.com/release-notes/releases/2026-09-22-september-release). Glean asks for user approval before MCP write actions by default, and admins can turn this off per server — [Glean release notes Sep 29, 2026](https://docs.glean.com/release-notes/releases/2026-09-29-september-release)
- **Notion:** "A Custom MCP connection supports any custom MCP server, including internal tools"; admins control "which external tools agents can connect to" — [Notion: Agents](https://www.notion.com/product/agents)

### Inferences
- Because Claude supports CIMD, DCR and a static client, an existing server built for claude.ai keeps working. Copilot Studio is similarly flexible. Gemini needs a pre-registered client at your IdP.
- Notion Custom Agents seem to act with agent-scoped permissions rather than strictly as the invoking user, which matters for per-user OAuth semantics. This is unverified.

### Gaps
- Glean per-user vs shared OAuth for custom MCP servers in agents, and DCR support: not verified.
- ChatGPT DCR/CIMD support for custom apps: not verified (403).

## Requirement 2: Per-agent / per-project access control by user, group or role

### Takeaway
ChatGPT workspace agents (role-based visibility), Glean (IdP-group controls) and Notion (per-agent permissions with admin oversight) document per-agent access control. Claude offers org-wide skill/plugin provisioning, Enterprise custom roles and group-targeted plugin marketplaces (partly secondary). Copilot inherits Entra/Power Platform sharing.

### Cited Findings
- **ChatGPT:** agents can be shared with teammates or the workspace, and "users can only see and run agents they have permission to access" (search excerpt) — [OpenAI Help](https://help.openai.com/en/articles/20001143-chatgpt-workspace-agents-for-enterprise-and-business). The Compliance API lets admins view agent configurations and runs and suspend agents. An org-wide admin console was announced as "coming later" at launch — [Reworked](https://www.reworked.co/digital-workplace/openai-launches-workspace-agents-for-enterprise-workflow-automation/)
- **Glean:** scheduled triggers are "off by default". Admins can enable them "for everyone or for selected users and supported IdP groups (Google Groups, Azure AD/Entra ID)". This setting "doesn't affect who can create, share, or publish agents" — [Glean docs: Schedule triggers](https://docs.glean.com/agents/concepts/schedule-triggers)
- **Notion:** "Each Custom Agent gets its own permissions, just like a teammate". Admins control who can create agents, can view all agents and their access, and can disable any agent — [Notion: Agents](https://www.notion.com/product/agents)
- **Claude:** Owners can provision skills org-wide, enabled or disabled by default, and members can toggle them off — [Claude Help: Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude); [Claude Help: Provision and manage skills for your organization](https://support.claude.com/en/articles/13119606-provision-and-manage-skills-for-your-organization). Owners and Enterprise custom roles with library management can distribute plugins — [Claude Help: Manage plugins for your organization](https://support.claude.com/en/articles/13837433-manage-plugins-for-your-organization). Group-scoped marketplace distribution ("Selected Enterprise groups") is reported only by a third-party guide — [Sid Bharath](https://sidbharath.com/blog/claude-skills-for-teams-enterprise-deployment-guide/)
- **Claude routines** "belong to your individual claude.ai account. They are not shared with teammates" — [Claude Code docs: Routines](https://code.claude.com/docs/en/web-scheduled-tasks)
- **Gemini Enterprise:** admins can control which AI models are available to agents (VentureBeat via search excerpt) — [VentureBeat](https://venturebeat.com/orchestration/google-cloud-unveils-persistent-gemini-agents-for-long-running-tasks-and-they-get-their-own-gmail-calendar-and-drive-storage)

### Inferences
- A "Finance agent visible only to leaders" maps natively to a ChatGPT workspace agent shared with a group, a Glean agent shared to an IdP group, or a Notion Custom Agent with restricted access. In Claude it would be a Project shared with specific people, plus a plugin/skill targeted to a group (Enterprise). The connector itself would still be org-wide, so the MCP server must enforce row-level authorization (as MiD's role-scoped MCP already does).

### Gaps
- Copilot Studio agent sharing and security-group details were not fetched this session.
- Gemini Enterprise agent sharing controls were not verified.
- Claude Project group sharing was not verified.

## Requirement 3: Multi-model (Claude AND open models via OpenRouter or local)

### Takeaway
All six fail the open-model half. Claude for Work offers Claude only. ChatGPT offers OpenAI only. M365 Copilot/Copilot Studio offers OpenAI plus Anthropic (admin opt-in). Gemini Enterprise offers Gemini plus Claude in limited or preview form. Glean offers multiple models including Claude Opus/Sonnet 5.5. Notion offers GPT, Claude and Gemini (secondary).

### Cited Findings
- **Microsoft:** Claude is available in Researcher and Copilot Studio. An admin must first enable Anthropic models in the M365 admin center, and model choice in the Copilot app needs a Microsoft 365 Copilot license — [Microsoft Support: Use Claude with Researcher](https://support.microsoft.com/en-us/microsoft-365-copilot/use-claude-with-researcher-in-microsoft-365-copilot). One secondary overview says Claude now covers Researcher, Copilot Studio, Excel, PowerPoint, Word, Copilot Chat, Power Platform and Copilot Cowork, with availability varying by tenant, region and license — [itechguides](https://www.itechguides.com/anthropics-claude-models-are-now-available-in-microsoft-365-copilot-what-that-means-in-2026/). Microsoft announced "Copilot Cowork" built with Anthropic and an E7 suite in March 2026 — [Fortune](https://fortune.com/2026/03/09/microsoft-copilot-cowork-ai-agents-anthropic-e7-m365-saas/)
- **Gemini Enterprise:** sources conflict on Claude availability: one says it is usable today, another says private preview, a third says it is an announced capability with limits — [pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/21745/google-launches-gemini-agent-claude-models); [Kingy AI](https://kingy.ai/blog/google-gemini-work-agent-claude-specs-comparisons/). Agent Designer agents in US/Global were migrated to Gemini 3.5 Flash by default — [Gemini Enterprise release notes](https://docs.cloud.google.com/gemini/enterprise/docs/release-notes). Treat Claude in Gemini Enterprise as **announced or limited, not GA**.
- **Glean:** Claude Opus 5.5 is a premium model in Assistant and Agents. Claude Sonnet 5.5 is selectable and "may be subject to usage-based pricing" — [Glean release notes Sep 22](https://docs.glean.com/release-notes/releases/2026-09-22-september-release); [Sep 29](https://docs.glean.com/release-notes/releases/2026-09-29-september-release)
- **Notion:** agents support Claude, GPT and Gemini (secondary; the Notion product page doesn't name models) — [eesel](https://www.eesel.ai/blog/notion-ai-review); [Notion: Agents](https://www.notion.com/product/agents)
- **ChatGPT workspace agents** are "powered by Codex"; no non-OpenAI models are mentioned — [Reworked](https://www.reworked.co/digital-workplace/openai-launches-workspace-agents-for-enterprise-workflow-automation/)
- **Claude routines:** "The prompt input includes a model selector", meaning Claude models only — [Claude Code docs: Routines](https://code.claude.com/docs/en/web-scheduled-tasks)

### Inferences
- Copilot Studio can likely attach Azure AI Foundry-hosted models (including open-weight ones) to custom agents, but this wasn't verified this session. Treat it as a lead, not a finding.
- No suite exposes OpenRouter or local models to end users.

### Gaps
- Glean's full model list and whether it supports BYO or open models: not verified.
- Copilot Studio "bring your own model" via Foundry: not verified.

## Requirement 4: Scheduled/background runs using the owner's identity for custom MCP calls; caps

### Takeaway
All six support scheduled agents. Documented caps: Glean allows **10 active background agents per user**. Claude Code routines allow **100 scheduled runs per hour per account**, a **minimum 1-hour interval**, and 30/hour per routine for Run now and API fires. Claude Cowork scheduled tasks have no documented count cap (hourly/daily/weekly/weekdays). Gemini allows hourly to annual schedules with **credentials that expire every 14 days**, and chat agents only. ChatGPT and Notion run on schedules metered by credits. In Claude and Gemini scheduled runs explicitly use the owner's connectors and credentials.

### Cited Findings
- **Claude Cowork scheduled tasks:** "available on all paid plans (Pro, Max, Team, Enterprise)". "Scheduled tasks run remotely, so they run on their cadence even when your computer is asleep or the Claude Desktop app is closed". Tasks needing local files run locally only. Runs use "any connectors and plugins you've set up in Cowork". Frequencies are hourly, daily, weekly, weekdays or manual. No count limit is stated. Admins control access via the Cowork toggle — [Claude Help: Schedule recurring tasks in Claude Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork.md)
- **Claude Code routines (research preview):** Pro, Max, Team and Enterprise. Run on Anthropic cloud. Connectors are "the claude.ai integrations on your account", all included by default, and "Claude can use every tool from an included connector, including writes, without asking for permission during a run". Actions "appear as you". Minimum interval is one hour. Limits are 100 scheduled runs/hour per account, 30/hour per routine for Run now/API fires, and 100/hour per account for API fires. Routines draw down subscription usage, and orgs can enable metered usage credits for overage. Owners can disable routines org-wide — [Claude Code docs: Routines](https://code.claude.com/docs/en/web-scheduled-tasks)
- **ChatGPT workspace agents:** you can "create, update, or delete schedules for published agents" and agents "keep working when nobody has ChatGPT open". Apps can use "each user's account or an agent-owned shared connection" (search excerpts) — [OpenAI Help](https://help.openai.com/en/articles/20001143-chatgpt-workspace-agents-for-enterprise-and-business). Also API trigger and Slack deployment — [Reworked](https://www.reworked.co/digital-workplace/openai-launches-workspace-agents-for-enterprise-workflow-automation/)
- **Gemini Enterprise Agent Designer:** "Chat agent schedules operate using your user credentials". "Execution schedules are only supported for non-workflow chat agents". Schedules aren't supported for actions involving other people, and runs needing approval pause. Credentials expire every 14 days and schedules fail unless refreshed. No count limit is stated — [Google Cloud docs: Schedule chat agent executions](https://docs.cloud.google.com/gemini/enterprise/docs/agent-designer/schedule-agent)
- **Glean:** "Each user can have up to 10 active background agents… More than 10 requires contacting Glean". Runs are "activated by individual users and run according to each user's schedule". Read-only tools run unattended. Write tools need the admin "Run without user confirmation" setting. Steps that require confirmation can't complete in the background, and Glean emails the user. MCP write tools from newly configured servers default to Allowed — [Glean docs: Schedule triggers](https://docs.glean.com/agents/concepts/schedule-triggers)
- **Notion:** Custom Agents run on schedules or triggers (Slack, Mail, Calendar, database changes). Credits are shared workspace-wide, reset monthly and don't roll over — [Notion: Agents](https://www.notion.com/product/agents). Agents pause when credits run out until reset or an admin buys more (secondary) — [connex.digital](https://connex.digital/blog/notion-custom-agent-credits-how-to-cut-costs-before-the-paid-era-begins/)
- **Copilot Studio:** the MCP doc notes features apply to "agents or agent flows powered by the standard harness" — [Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)

### Inferences
- For a custom MCP server, Claude routines and Cowork tasks call the connector with the owner's stored OAuth token, so the MCP server sees the owner's identity and role. Gemini does the same but needs a 14-day refresh. Glean appears user-scoped. ChatGPT allows a choice between per-user and agent-owned connections.

### Gaps
- Copilot Studio scheduled/autonomous triggers and whose credentials MCP calls use (maker vs user) were not verified this session. Historically, autonomous triggers run with the author's connection, but this is unconfirmed here.
- ChatGPT: the max number of schedules per agent or user wasn't found. The consumer "Tasks" cap is not confirmed for workspace agents.
- Claude Cowork: no documented per-user cap on the number of scheduled tasks.

## Requirement 5: Skills/instructions manageable as code in Git

### Takeaway
Claude is the clear leader. Skills are SKILL.md folders, owners provision org skills, plugins can be distributed via marketplaces, and routines use "skills committed to the cloned repository". Others offer weaker or non-Git mechanisms.

### Cited Findings
- **Claude:** org skill provisioning by owners — [Claude Help: Provision and manage skills](https://support.claude.com/en/articles/13119606-provision-and-manage-skills-for-your-organization). Skills for enterprise on the platform side — [Claude Platform Docs: Skills for enterprise](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise); [Claude blog: Organization skills and directory](https://claude.com/blog/organization-skills-and-directory). Routines run "skills committed to the cloned repository" and can read `.mcp.json` from the repo — [Claude Code docs: Routines](https://code.claude.com/docs/en/web-scheduled-tasks)
- **ChatGPT:** agents are built from a description or uploaded file, and "ChatGPT adds skills automatically". Templates ship with built-in skills — [Reworked](https://www.reworked.co/digital-workplace/openai-launches-workspace-agents-for-enterprise-workflow-automation/). No Git workflow is documented.
- **Gemini Enterprise:** a Skills Registry exists and began billing July 1, 2026 (secondary) — [ecorpit](https://ecorpit.com/gemini-enterprise-agent-platform-cost-breakdown-2026/)

### Inferences
- An agency could keep a Git repo of SKILL.md folders and push them to Claude via org provisioning or a plugin marketplace. No equivalent "skills as code" pipeline was found for Notion or Glean.

### Gaps
- Whether Claude's org skill provisioning has a public admin API (vs. a UI upload) wasn't confirmed this session.
- Copilot Studio ALM/solution export as a Git workflow was not researched.

## Requirement 6: Pricing for ~30 seats and caps on automation

### Takeaway
Rough monthly costs for 30 seats, mostly from secondary sources: Claude Team about $600–750 for standard seats (premium seats about $100–125), plus optional usage credits. ChatGPT Business $600 annual or $750 monthly, plus workspace-agent credits. Notion is the Business seat price plus $10 per 1,000 agent credits. Gemini Enterprise is roughly $21–60 per seat (secondary, conflicting). Copilot Studio uses credits (secondary: $200 for 25,000) on top of M365 Copilot licensing. Glean is not public, with one secondary report of a median contract around $99k per year.

### Cited Findings
- **Claude Team:** Standard about $20/mo annual or $25 monthly. Premium about $100 annual or $125 monthly (5x usage). 2–150 seats (secondary) — [tygartmedia](https://tygartmedia.com/claude-team-pricing-2026-standard-premium-seats/); [krater.ai](https://krater.ai/blog/claude-team-plan-pricing). Enterprise is described as $20/seat plus API-rate usage (secondary) — [runbear](https://runbear.io/posts/claude-enterprise-pricing-mid-market). Routines consume subscription usage, with optional metered overage — [Claude Code docs](https://code.claude.com/docs/en/web-scheduled-tasks)
- **ChatGPT Business:** $20/user/mo annual or $25 monthly, with a 2-seat minimum; reportedly cut on April 2, 2026 (secondary) — [sayfeai](https://www.sayfeai.com/blog/chatgpt-business-pricing-2026); [eesel](https://www.eesel.ai/blog/chatgpt-work-pricing). Workspace agents: research preview April 22, 2026; GA in Business/Enterprise/Edu May 21, 2026; token/credit pricing from July 6, 2026 (search excerpt of release notes) — [OpenAI Business release notes](https://help.openai.com/en/articles/11391654-chatgpt-business-release-notes). The cost of a credit is not officially stated (secondary) — [eesel](https://www.eesel.ai/blog/chatgpt-work-pricing)
- **Notion:** Custom Agents are on Business/Enterprise. "Starting May 4, 2026" they run on credits at "$10 per 1,000" monthly, shared workspace-wide with no rollover — [Notion: Agents](https://www.notion.com/product/agents). Business seat about $20 (secondary, conflicting on billing) — [eesel](https://www.eesel.ai/blog/notion-ai-review)
- **Gemini Enterprise:** about $21 Business (≤300 seats) to $30–60 Standard/Plus (secondary, conflicting). Agent infrastructure (Skills Registry, Agent Gateway, Memory Bank) is metered from July–Sept 2026 — [gosearch](https://www.gosearch.ai/faqs/gemini-enterprise-pricing/); [ecorpit](https://ecorpit.com/gemini-enterprise-agent-platform-cost-breakdown-2026/)
- **Copilot Studio:** Copilot Credits at $200 for 25,000 credits per month, or $0.01 per credit PAYG (secondary, Sep 2026) — [getmacha](https://www.getmacha.com/blog/copilot-studio-pricing-explained)
- **Glean:** no public pricing. Seats plus a pooled credit allowance. Median contract about $98,890/yr per Vendr (secondary) — [pinggy](https://pinggy.io/amp/blog/best_enterprise_search_platforms_with_ai_agents/)

### Inferences
- At 30 seats, Claude Team, ChatGPT Business and Notion Business are in the same ~$600–750/mo seat band. Their real differentiator is metered agent usage (ChatGPT credits, Notion credits, Claude usage limits and credits). Glean is likely out of budget for a 30-person agency.

### Gaps
- Official per-seat prices were not fetched from vendor pricing pages (all secondary). Verify claude.com/pricing, chatgpt.com/business pricing, Microsoft and Google pricing pages.
- M365 Copilot per-user license price for Business SKUs was not found.

## Recent launches (Aug–Oct 2026) that change the picture

### Takeaway
Claude Cowork scheduled tasks moved to remote (cloud) execution around Oct 6, so runs no longer need the laptop awake. Claude routines are expanding (CLI GitHub triggers, run history). Glean consolidated MCP onto its Connectors page and added Claude 5.5 models (Sep 2026). Copilot Studio's MCP doc was updated in Aug 2026 with Agents 365 BYO MCP registration. Gemini Enterprise migrated Agent Designer defaults to Gemini 3.5 Flash.

### Cited Findings
- Claude Cowork: "Scheduled tasks run remotely…"; Pro/Max tasks "created before October 6" that run locally keep running there (year not stated in article) — [Claude Help](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork.md)
- Claude routines: GitHub triggers from the CLI require v2.1.225+ and run history Q&A requires v2.1.227+. Still "research preview" — [Claude Code docs](https://code.claude.com/docs/en/web-scheduled-tasks)
- Glean: Connectors page for MCP (Sep 22, 2026); MCP write approval default, Claude Sonnet 5.5 (Sep 29, 2026) — [Sep 22](https://docs.glean.com/release-notes/releases/2026-09-22-september-release); [Sep 29](https://docs.glean.com/release-notes/releases/2026-09-29-september-release)
- Copilot Studio: MCP doc updated 2026-08-19, adds Agents 365 CLI BYO MCP path — [Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- Gemini Enterprise: Agent Designer default migrated to Gemini 3.5 Flash — [Gemini Enterprise release notes](https://docs.cloud.google.com/gemini/enterprise/docs/release-notes). Persistent Gemini Agents with their own Gmail/Calendar/Drive announced — [VentureBeat](https://venturebeat.com/orchestration/google-cloud-unveils-persistent-gemini-agents-for-long-running-tasks-and-they-get-their-own-gmail-calendar-and-drive-storage)

### Inferences
- Remote Cowork scheduling plus org custom connectors make Claude Team a viable "scheduled agent as owner" platform without desktop dependency.

### Gaps
- No primary-source verification of Aug–Oct 2026 ChatGPT changes (release notes blocked).
- Exact GA dates for Claude in Gemini Enterprise are unknown.
