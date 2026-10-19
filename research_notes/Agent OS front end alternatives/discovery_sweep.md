# Discovery sweep: lesser-known "agent OS / AI workspace for teams" products (as of 2026-10-14)

Scope: products outside the already-evaluated list, scored on the 6 requirements (R1 per-user OAuth to custom remote MCP; R2 per-agent access by user/group; R3 Claude + open models; R4 scheduled/background runs as the user, or API to run agent-as-user; R5 skills in Git as SKILL.md; R6 no per-seat automation caps, self-hostable on a simple Docker host, license).

Method note: I made about 20 tool calls. Archestra and Obot were checked against their own GitHub docs folders on `main`, read through the `gh` API on 2026-10-14. Open Agent Platform and Agno were checked from their GitHub and docs pages. Everything else (Arcade, Bifrost, agentgateway, ContextForge, Composio, and so on) appears only in vendor-written roundup blogs and was **not** verified against primary sources.

## Has anyone built the full package? Which 1–2 come closest, and what is missing?

### Takeaway
**Archestra** (archestra-ai/archestra) is the one find that covers all six requirements on paper, with primary-source docs for each: an employee chat with projects, per-user OAuth on-behalf-of calls to remote MCP servers, team and role grants on each agent, scheduled tasks that run as a named user, an A2A endpoint called with a personal token, Git-synced SKILL.md, and Anthropic plus vLLM/Ollama. Its two catches:
- **Licensing at 30 users.** The RBAC, granular per-agent grants and SSO features are Enterprise-licensed. They are free only while the whole company has **fewer than 30** users, which is exactly the size of this agency.
- **Docker is for evaluation only.** The docs present Docker as the way to try it, and Helm/Kubernetes as the production path.

No other product found comes close. Obot has dropped its own chat and agent layer and is now a gateway (see Q3). Open Agent Platform is archived.

### Cited Findings

**Archestra (strongest candidate)**
- Health: 4,369 GitHub stars. Repo created 2025-07-15, last push 2026-10-14. Releases ship almost daily (platform-v1.3.72 on 2026-10-13; v1.4.0-rc.36 to rc.39 between 2026-10-10 and 2026-10-14). — [GitHub API / repo](https://github.com/archestra-ai/archestra)
- What it calls itself: "Enterprise AI Platform with guardrails, MCP registry, gateway & orchestrator". It offers "Chat for non-technical users" with projects, plus Slack, MS Teams and email front-ends. — [README](https://github.com/archestra-ai/archestra)
- **R1:** Each upstream MCP server gets a sign-in method. "OAuth 2.1 — Each person, in the browser, once." A tool set to **Resolve at call time** with the default credential **On behalf of the user** means "each person acts as themselves." It can fall back to a team install. If nobody has connected, "the call fails with a link to install one." OAuth tokens refresh automatically. It also supports IdP token exchange (Entra OBO, Okta, RFC 8693, ID-JAG). Per-call credentials require streamable-http, not stdio. Each call's identity is logged. — [docs/pages/mcp/authentication/servers.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/mcp/authentication/servers.md)
- **R1 (client side):** The Archestra gateway accepts MCP clients through OAuth with Dynamic Client Registration. "The client registers itself the first time it connects." It can be turned off with `ARCHESTRA_AUTH_DCR_ENABLED=false`. — [docs/pages/mcp/authentication/gateway.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/mcp/authentication/gateway.md)
- **R1 gap:** I did not confirm whether Archestra itself uses DCR/discovery when it registers with an *upstream* OAuth MCP server, or whether an admin must pre-register a client. The servers doc only says to "pick the method the server's own docs name."
- **R2:** "Resource grants control which individual agents, gateways, skills, apps, models, and credentials they can reach." A grant can go to a user, team, service account, role, or everyone, at the levels Can view / Can use / Can edit / Full access. Teams can be nested, and members inherit grants from parent teams. — [docs/pages/admin/access-control.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/admin/access-control.md)
- **R2 caveat:** "Granular access control is an Enterprise feature, including the small-team allowance." — same page
- **R3:** The provider list covers Anthropic, OpenAI, Gemini, Bedrock, Azure, Ollama, GitHub Copilot, and an "OpenAI-compatible" provider for "vLLM, llama.cpp, LM Studio, SGLang". It also has a Model Router. — [docs/pages/llm-proxy/providers/openai-compatible.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/llm-proxy/providers/openai-compatible.md), [providers index (repo tree)](https://github.com/archestra-ai/archestra/tree/main/docs/pages/llm-proxy/providers)
- **R4 (scheduled):** Projects include "Scheduled Tasks": choose an agent and a prompt, set a cron or interval and a timezone. Each run executes as its own conversation with logs. — [docs/pages/chat/projects.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/chat/projects.md)
- **R4 (identity):** The schedule schema includes `actor_user_id`, documented as "The user the scheduled run executes as." — [docs/pages/reference/archestra-mcp-server.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/reference/archestra-mcp-server.md)
- **R4 (external scheduler):** Every agent has an A2A 1.0 HTTP endpoint (`POST /v2/a2a/{agentId}`). A **personal token** runs "as You". Team tokens, org tokens, OAuth tokens and IdP JWTs are also accepted. A Trigger.dev job could call this with each user's personal token. — [docs/pages/agents/triggers-and-channels/webhook-a2a.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/agents/triggers-and-channels/webhook-a2a.md)
- **R4 (channels):** In Slack and Teams group chats, "each message still runs with the sender's own permissions." — [triggers-and-channels/index.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/agents/triggers-and-channels/index.md)
- **R4 caveat:** "Scheduled skill, plugin, and Knowledge syncs use organization credentials." This covers sync jobs, not agent schedules. — [docs/pages/admin/security/credentials.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/admin/security/credentials.md)
- **R4 caveat:** The agent-delegation tool "works only for a signed-in user. Scheduled and other automated runs do not get the tool." — skills index doc ([repo](https://github.com/archestra-ai/archestra/tree/main/docs/pages/agents/skills))
- **R5:** Archestra imports from GitHub or GitLab and finds every folder containing a `SKILL.md`. It re-syncs every 15 minutes, hourly or daily. Synced skills are read-only, and private repos work through a GitHub App or a GitLab token. It also supports MCP-published skills (draft SEP-2640, beta). — [docs/pages/agents/skills/importing.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/agents/skills/importing.md)
- **R6 (license):** "Open Core. The base platform is licensed under AGPL-3.0." The following are Enterprise-licensed:
  - RBAC with custom roles
  - Granular per-resource access control
  - SSO/OIDC
  - Knowledge Base/RAG with access control
  - Data retention
  - 2FA
  - Encryption at rest

  Small Team Clause: if total users "across your entire company is fewer than 30," Enterprise features are free in production. At 30 or more, a paid license is required, priced on a quote from sales. No per-seat automation caps were mentioned. — [docs/pages/get-started/pricing-model.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/get-started/pricing-model.md)
- **R6 (hosting):** "Use Docker to try Archestra locally. Use Helm to run it in Kubernetes" for production. With Docker, the image runs Postgres internally unless `ARCHESTRA_DATABASE_URL` is set. The Docker socket mount "enables the embedded Kubernetes cluster for self-hosted MCP servers." pgvector is needed for the Knowledge Base. — [docs/pages/admin/deployment.md](https://github.com/archestra-ai/archestra/blob/main/docs/pages/admin/deployment.md)

**Agno AgentOS (partial, framework-level)**
- Agno describes AgentOS as "the FastAPI for agents." It serves agents over REST, SSE, WebSocket, A2A, AG-UI, MCP, Slack, Telegram and WhatsApp, with "JWT authorization with RBAC, a shared security key, and scoped service accounts." It has a `scheduler=True` option and a separate Control Plane web UI (os.agno.com). The docs page does not describe an end-user chat UI or per-user MCP OAuth, and does not state the license or pricing. — [docs.agno.com AgentOS intro](https://docs.agno.com/agent-os/introduction)

### Inferences
- Archestra is the only product found where the whole loop is documented in primary sources: per-user sign-in, a personal agent, team agents, a schedule that runs as a user, and the user's own token passed to our MCP. It is the one to test hands-on next.
- The size threshold is a real business risk. At about 30 employees, the agency may already be at or over "fewer than 30 users," and then RBAC, per-agent grants and SSO need a quoted Enterprise license. Without those features, R2 does not hold in the AGPL build.
- Archestra's production path is Kubernetes. A single Docker container with external Postgres might run on Render. But self-hosted MCP servers depend on the Docker-socket/embedded-k8s path, which Render does not provide. Only remote MCP would work there, which is fine for our case. This is unverified.
- Agno AgentOS is a framework or runtime to build on, not a ready employee workspace. Reaching R1 and R2 would take custom work.

### Gaps
- I found no hands-on reviews or HN/Reddit discussion of Archestra to check maturity. The search budget ran out.
- Whether Archestra registers with an upstream MCP's OAuth via DCR, or needs an admin-entered client ID, is unknown.
- Archestra Enterprise pricing at 30 or more users is quote-only and not published.
- Not checked against primary sources: CrewAI AMP, SuperAGI, Microsoft Agent Framework, Google ADK web, AutoGen Studio, Eliza, OpenAgents, Superagent, Suna-like products, and Show HN / r/selfhosted threads. This is a coverage gap, not a negative finding.

## Open Agent Platform (LangChain) and Obot in depth

### Takeaway
Neither is a viable "agent OS" front end in October 2026:
- **Open Agent Platform** was deprecated and archived on 2026-02-25. LangChain points users to LangSmith Agent Builder instead.
- **Obot** has removed its own chat and hosted-agent layer and repositioned as an "AI governance" gateway (MCP gateway, LLM gateway, skills registry). Its new agent story, "Claude Environments" (experimental), sends users to Claude's own UI and requires Kubernetes.

### Cited Findings
- **Open Agent Platform:** "This repository has been deprecated." It was archived by the owner on Feb 25, 2026 and recommends Agent Builder on LangSmith. At archive time it had 1.9k stars, an MIT license, and required LangGraph agents deployed on LangGraph Platform. Its auth is swappable only through code changes. Per-user tokens and scheduling were not documented. — [GitHub](https://github.com/langchain-ai/open-agent-platform)
- **Obot health:** 1,106 stars, MIT license, last push 2026-10-14. Releases come about weekly (v0.26.3 on 08 Oct, v0.26.2 on 02 Oct, v0.26.1 on 25 Sep). — [GitHub](https://github.com/obot-platform/obot), [releases](https://github.com/obot-platform/obot/releases)
- **Obot positioning:** "Complete AI Governance Platform." It is "a single governed entry point to every MCP server a user is allowed to reach." The gateway handles "MCP OAuth, user and shared credentials." Access to servers, tools, skills and models can be limited "by user or identity-provider group." The LLM gateway covers OpenAI, Anthropic, Bedrock, Azure and "Generic Responses Compatible" providers. — [docs.obot.ai](https://docs.obot.ai/), [README](https://github.com/obot-platform/obot)
- **Obot dropped its chat UI:** The Obot Agent concept page ("a chat interface built to work directly with MCP", with conversations, scheduled or on-demand Workflows, and OpenAI/Anthropic/Azure/Bedrock models) exists only up to the versioned v0.25.0 docs. It is behind `OBOT_ENABLE_AGENTS=true` and absent from the current docs. — [v0.25.0 obot-agent.md](https://github.com/obot-platform/obot/blob/main/docs/versioned_docs/version-v0.25.0/concepts/obot-agent.md)
- **Obot's replacement is Claude Environments:** The current docs say Claude Environments (experimental) "replaces the former Hosted Agents feature. There is no separate agent configuration or chat interface in Obot: administrators configure environments and profiles, and users select an environment in Claude." It needs Kubernetes ("Docker deployments cannot run this feature") and a Claude Team or Enterprise org with self-hosted environments, an Anthropic public-beta feature. — [claude-environments/overview.md](https://github.com/obot-platform/obot/blob/main/docs/docs/claude-environments/overview.md)
- **Obot chat today:** Recent release notes mention chat only as the "MCP tester chat." — [releases](https://github.com/obot-platform/obot/releases)
- **Obot hosting:** Single `docker run` for evaluation. "Production deployments need Kubernetes." — [docs.obot.ai install overview](https://docs.obot.ai/installation/overview/)

### Inferences
- Obot is no longer an "agent OS" candidate. It belongs in the gateway layer only (see Q3).
- Any earlier write-ups describing Obot as having projects, chat and scheduled tasks are out of date as of v0.26.

### Gaps
- I did not find the exact release where Obot Agent was removed. The docs folder shows it in v0.23 to v0.25 versioned docs and absent in current docs.

## Could an MCP gateway with per-user OAuth sit between any chat front end and our MCP to solve R1/R4?

### Takeaway
Yes, in principle, and **Obot** documents the pieces with primary sources:
- **R1:** Obot handles per-user upstream OAuth "on the user's behalf" and exposes one streamable-http URL per virtual MCP.
- **R4:** Per-user API keys (`ok1-<userId>-…`) let an external scheduler such as Trigger.dev call MCP as a specific user, still limited by that user's policies.

**Archestra** does the same and also brings its own chat. The weak link is the front end. It must speak MCP OAuth (or accept a bearer header) to the gateway, and it must not itself be the thing that runs scheduled jobs under a shared identity.

### Cited Findings
- **Obot upstream OAuth:** "Obot handles OAuth token exchange and refresh to access upstream MCP servers on the user's behalf." Clients connect at `https://<obot>/mcp-connect/{vmcp-id}` over streamable-http "regardless of their underlying runtime." — [docs.obot.ai MCP gateway concept](https://docs.obot.ai/concepts/mcp-gateway/)
- **Obot static OAuth:** For upstream servers without dynamic registration, an admin enters one client ID and secret, and then "each user still authenticates individually through the OAuth flow using the shared client credentials." The page contrasts this with "servers that support dynamic OAuth registration," which implies DCR is used when the upstream offers it. — [mcp-server-oauth-configuration.md](https://github.com/obot-platform/obot/blob/main/docs/docs/configuration/mcp-server-oauth-configuration.md)
- **Obot per-user API keys:** "Agent authorization scopes" issue API keys `ok1-<userId>-<keyId>-<secret>` for "scripts, automation tools, external MCP clients." A key can be limited to selected MCP servers, the LLM proxy and skills. It "is still limited by the owning user's permissions and access policies." — [agent-auth-scopes.md](https://github.com/obot-platform/obot/blob/main/docs/docs/functionality/agent-auth-scopes.md)
- **Obot client compatibility:** The FAQ notes that some clients do not support the OAuth `resource` parameter, and recommends API keys instead (citing a Codex CLI issue). — [faq.md](https://github.com/obot-platform/obot/blob/main/docs/docs/faq.md)
- **Archestra gateway:** "Sign in to Archestra once, and every tool call runs as you, in every app. Ask Claude Code to file a Jira ticket… Jira and GitHub both show your name." — [mcp/authentication docs](https://github.com/archestra-ai/archestra/tree/main/docs/pages/mcp/authentication)
- **Other gateways (secondary sources only, unverified):**
  - Arcade.dev is described as an MCP runtime with per-user authorization, but "its engine that holds tokens is a closed binary," with only the framework under MIT. — [Nango roundup](https://nango.dev/blog/best-open-source-api-integration-platforms-for-ai-agents/)
  - Bifrost (Apache 2.0) is listed with OAuth 2.1 caller auth and per-user upstream credentials, with some enterprise gating. agentgateway (Apache 2.0, Agentic AI Foundation) and IBM ContextForge (user-scoped OAuth tokens) are also listed. — [Maxim AI, vendor blog](https://www.getmaxim.ai/articles/best-open-source-mcp-gateways-in-2026/)

### Inferences
- **Pattern A (lowest effort):** Archestra as both chat and gateway. It covers R1, R2 and R4 natively, subject to the 30-user license line.
- **Pattern B:** Any chat front end, through Obot (or Archestra in gateway-only mode), to our MCP. This gives R1, provided the front end performs MCP OAuth to the gateway per user. Background jobs (R4) would bypass the chat app: Trigger.dev calls the gateway with each user's scoped key, or calls an agent API.
- **Our own MCP:** We control the MCP server and it already does per-user OAuth. A gateway mostly adds governance and audit, plus the ability to mint per-user keys for schedulers. The front end still has to support per-user remote-MCP OAuth for interactive use, so the gateway does not remove that requirement for chat.
- Composio-based workspaces, Pipedream Connect, Klavis, MCPJungle, Toolhive, Docker MCP gateway and Azure APIM were not verified in this sweep. Treat their fit as unknown.

### Gaps
- No primary-source check of Arcade, Composio, Pipedream Connect, Klavis, ContextForge, Bifrost or agentgateway for custom remote MCP with per-user OAuth plus a bundled chat UI.
- I did not test whether Obot's per-user upstream OAuth works for an arbitrary custom remote MCP with DCR, or only for catalog entries.
