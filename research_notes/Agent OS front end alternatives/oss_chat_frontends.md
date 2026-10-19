# Open-source chat-first front ends for an agency "agent OS": alternatives to LibreChat (as of 2026-10-14)

Scope note: research ran on 2026-10-14 against official docs, GitHub API data (stars, licenses, releases), and GitHub issues and PRs. I verified the requirements most closely for LibreChat and Open WebUI, which are the only two real contenders. For the long tail I checked only the license and requirement 1, the hard requirement (per-user OAuth to a custom remote MCP server). Anything I could not source is listed under Gaps or marked as an inference.

## Q1. Which candidates meet requirement 1 today (per-user OAuth to a custom remote MCP server, not static headers)?

### Takeaway
Two candidates have documented, shipped, per-user OAuth 2.1 for custom remote MCP servers with dynamic client registration (DCR): **LibreChat** and **Open WebUI**. LobeHub's code appears to have an OAuth and DCR flow, but its docs don't describe it and a fix for standards-conforming DCR has not been merged. AnythingLLM, Chainlit and Big-AGI do not support it today; all three have only open feature requests or unmerged PRs. HuggingChat/chat-ui forwards only Hugging Face's own token.

### Cited Findings
**LibreChat (baseline): meets requirement 1**
- The `oauth` setting on an MCP server makes each user sign in: "users will be prompted to authenticate via OAuth flow before the MCP server can be used." — [LibreChat mcp_servers docs](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- DCR: "If no client id & client secret is provided, Dynamic Client Registration (DCR) will be used." The `oauth_headers` setting can add headers to DCR and token requests. — [same](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- For setups that need per-user static credentials instead of OAuth, `customUserVars` stores values "associated with the individual user". — [same](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- Multi-replica deployments: `oauthRefreshCoordination: true` "serializes token refresh through the shared Redis instance". — [same](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- There is an on-behalf-of (OBO) option gated by the role permission `MCP_SERVERS.CONFIGURE_OBO`. Setting `chatMenu: false` hides a server from the chat picker, but it "remains available to saved Agents and model specs that explicitly assign it". — [same](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- Recent hardening: v0.8.8 (2026-10-01) blocks unsafe MCP OAuth redirects and private IPs. rc4 (2026-09-23) serializes MCP token refresh across replicas and makes the OAuth `resource` parameter optional. — [LibreChat releases (GitHub API)](https://api.github.com/repos/danny-avila/LibreChat/releases?per_page=3)

**Open WebUI: meets requirement 1 (since native MCP support arrived in v0.6.31)**
- An admin registers the MCP server once and each user connects their own account. The access a user grants "is stored against their account alone. Nobody else inherits it." — [Open WebUI MCP docs](https://docs.openwebui.com/features/extensibility/mcp.txt)
- DCR is the default ("Uses Dynamic Client Registration (DCR)"). There is also an "OAuth 2.1 (Static)" mode for a pre-created client ID and secret, plus an optional separate OAuth Server URL. — [same](https://docs.openwebui.com/features/extensibility/mcp.txt)
- Protected resource metadata: if the server publishes a `resource` field in its RFC 9728 Protected Resource Metadata document, Open WebUI forwards it on the authorize, token and refresh calls. — [same](https://docs.openwebui.com/features/extensibility/mcp.txt)
- Limitations:
  - Native MCP support is Streamable HTTP only.
  - Only admins can add MCP servers.
  - Do not set OAuth MCP tools as default or pre-enabled tools on a model; if the user hasn't authorized yet, the call fails with "Failed to connect to MCP server".
  - You "MUST" set `WEBUI_SECRET_KEY`, otherwise restarts cause "Error decrypting tokens".
  — [same](https://docs.openwebui.com/features/extensibility/mcp.txt)
- v0.12.0 (2026-10-10) fixes:
  - Servers that use OAuth with DCR (Atlassian, Notion) now receive the scopes they need.
  - Google MCP connections now receive a refresh token.
  - Parallel token renewals no longer log users out.
  — [Open WebUI releases (GitHub API)](https://api.github.com/repos/open-webui/open-webui/releases?per_page=3)

**LobeHub (formerly LobeChat): partial and poorly documented**
- Open PR #17570 (2026-07-24, unmerged) says: "Dynamic client registration currently ignores the authorization server metadata and always requests `client_secret_post` plus the `refresh_token` grant. That makes standards-conforming public PKCE servers fail registration." So a DCR flow exists in the code, but it is buggy against spec-conformant servers until this PR merges. — [lobehub PR #17570](https://github.com/lobehub/lobehub/pull/17570)
- The official MCP marketplace doc page is currently a placeholder with no auth content. — [LobeHub docs](https://lobehub.com/docs/usage/community/mcp-market)
- DeepWiki, which is auto-generated and not authoritative, describes popup-based OAuth with DCR or pre-registered credentials over StreamableHTTP. — [DeepWiki lobehub MCP](https://deepwiki.com/lobehub/lobehub/5.1-mcp-protocol-integration)
- Open issue #20108 asks for support for MCP spec version 2026-07-28. — [lobehub #20108](https://github.com/lobehub/lobehub/issues/20108)

**AnythingLLM: does NOT meet requirement 1**
- The MCP docs mention only custom HTTP `headers` (example: `X-API-KEY`), with no OAuth. — [AnythingLLM MCP docs](https://docs.anythingllm.com/mcp-compatibility/overview)
- Open feature request #6396 (2026-09-17), "Support MCP OAuth2.1 Authorization", reports that OAuth MCP servers fail with "[401] Streamable HTTP error". — [anything-llm #6396](https://github.com/Mintplex-Labs/anything-llm/issues/6396)
- Community PR #4876 ("OAuth/OIDC impersonation support with MCP server integration") was closed without merging 8 seconds after it was opened (2026-01-18). — [anything-llm PR #4876](https://github.com/Mintplex-Labs/anything-llm/pull/4876)

**Chainlit: does NOT meet requirement 1 (unmerged PR)**
- Static per-user headers shipped (#2292). The OAuth flow is in open PR #3013, "feat(mcp): per-user OAuth for HTTP MCP connections" (opened 2026-08-19, unmerged). The PR says: "The authorization *flow* — Chainlit obtaining a token on the user's behalf — is still missing." — [chainlit PR #3013](https://github.com/Chainlit/chainlit/pull/3013); [issue #2197](https://github.com/Chainlit/chainlit/issues/2197)

**Big-AGI: does NOT meet requirement 1**
- MCP client support exists only in open PR #1177 (2026-08-17, unmerged). Issue #892 "Support MCP" is still open. — [big-AGI PR #1177](https://github.com/enricoros/big-AGI/pull/1177); [#892](https://github.com/enricoros/big-AGI/issues/892)

**HuggingChat / chat-ui: does NOT meet requirement 1**
- MCP servers are configured as URLs in `MCP_SERVERS`, and users can add their own. The only per-user token mechanism is `MCP_FORWARD_HF_USER_TOKEN=true`, which forwards "the signed-in user's Hugging Face token to the official HF MCP login endpoint". The README describes no generic OAuth flow. — [chat-ui README](https://raw.githubusercontent.com/huggingface/chat-ui/HEAD/README.md)

### Inferences
- If requirement 1 is truly hard, only LibreChat and Open WebUI are viable today. LobeHub might work, but it would need hands-on testing against our own MCP server's DCR metadata (public client with PKCE), and PR #17570 suggests it fails for spec-conformant public clients.
- Cherry Studio, Jan and Msty are single-user desktop apps. Even where they have MCP OAuth, it is the local user's token, so they don't fit a multi-user agent OS. I did not verify their MCP OAuth support.
- The Vercel AI Chatbot template is a starter codebase, not a product. Per-user MCP OAuth would have to be built in-house.

### Gaps
- Khoj, Msty, Jan and Cherry Studio MCP OAuth: not checked against primary sources (my tool budget ran out). Khoj's last release is 2.0.0-beta.28 (2026-03-26) and its last push was 2026-08-02, so it looks low-cadence.
- I could not confirm whether either LibreChat or Open WebUI fully implements the RFC 9728 401 `WWW-Authenticate` discovery path. Open WebUI documents RFC 9728 `resource` forwarding. LibreChat's docs mention discovery only in the context of preconfigured client secrets. Test both against our server.

## Q2. Per-agent access control, multi-model support, and Skills as code

### Takeaway
LibreChat and Open WebUI both have role- and group-based permissions in the free edition, both are multi-model, and both now have first-class Skills. LibreChat's Skills explicitly use the `SKILL.md` format. Open WebUI's Skills shipped in v0.12.0 (supporting files, version history, import from URL), but I could not confirm whether they are compatible with `SKILL.md`.

### Cited Findings
- **LibreChat agent and skill permissions:**
  - At run time, Scheduled Chats recheck "the user's Agent feature permission and view access to the selected Agent". This means agents have per-user view ACLs. — [LibreChat scheduled chats](https://www.librechat.ai/llms.mdx/docs/features/scheduled_chats)
  - Per role, admins can grant use, create, share and public-share permissions for skills. — [LibreChat Skills docs](https://www.librechat.ai/docs/features/skills)
  - v0.8.8-rc3 enforces role permissions for web search, file search and code execution. — [LibreChat releases](https://api.github.com/repos/danny-avila/LibreChat/releases?per_page=3)
- **LibreChat Skills:**
  - A skill is centered on a `SKILL.md` file: frontmatter says when to use it and the body holds the procedure.
  - A skill can bundle `references/`, `scripts/` and `assets/`.
  - Each agent can have its own `skills` allowlist.
  — [LibreChat Skills docs](https://www.librechat.ai/docs/features/skills)
  - The v0.8.8 Management API adds Agent and Skill CRUD, and rc3 adds "Skill discovery and authoring to the Management API". This makes a Git-to-API sync job possible. — [LibreChat releases](https://api.github.com/repos/danny-avila/LibreChat/releases?per_page=3)
- **Open WebUI access control:**
  - Admins "scope [an MCP server] with Access Control to the right users or groups".
  - Headers can pass `{{USER_GROUPS}}` so the MCP server can authorize by group.
  — [Open WebUI MCP docs](https://docs.openwebui.com/features/extensibility/mcp.txt)
  - v0.12.0: token-exchange sign-ins assign groups from the token's groups claim. — [Open WebUI releases](https://api.github.com/repos/open-webui/open-webui/releases?per_page=3)
- **Open WebUI paywall:** the license page lists SSO and LDAP as allowed without a license, provided the branding stays intact. It does not mention RBAC or SCIM as paid features. The enterprise license mainly buys white-labelling and support. — [Open WebUI license](https://docs.openwebui.com/license)
- **Open WebUI Skills (v0.12.0):**
  - Supporting files and version history.
  - Import from URL (up to 200 MiB).
  - `/skills:create`.
  - A per-model Skills switch.
  — [Open WebUI releases](https://api.github.com/repos/open-webui/open-webui/releases?per_page=3)
- **Multi-model:** chat-ui routes everything through an OpenAI-compatible `OPENAI_BASE_URL`, so OpenRouter works. — [chat-ui README](https://raw.githubusercontent.com/huggingface/chat-ui/HEAD/README.md)

### Inferences
- In my understanding, both LibreChat and Open WebUI support Anthropic natively plus OpenAI-compatible endpoints (OpenRouter, Ollama, vLLM). I did not re-fetch provider docs this session, but this is long-standing, well-known functionality.
- For a "Finance agent hidden from non-leaders": LibreChat agent sharing (per-user and per-group view ACL) and Open WebUI model/workspace Access Control (users and groups) both appear to cover it without an enterprise license.

### Gaps
- LobeHub multi-user RBAC: the GitHub search found only agent/group permission perf PRs (for example [#20858](https://github.com/lobehub/lobehub/pull/20858)) and no documented org RBAC or SSO-group mapping for self-hosted deployments. Unverified.
- Open WebUI `SKILL.md` / Agent Skills format compatibility: not confirmed.

## Q3. Scheduled runs as the owning user, and agent APIs to run an agent on behalf of a user

### Takeaway
Both LibreChat and Open WebUI now have scheduled runs owned by a user, and both have per-user API keys that run agents in that user's context.
- **LibreChat:** Scheduled Chats is experimental and off by default. The Agents API is in beta, offers OpenAI-compatible and Open Responses endpoints, and authenticates with per-user API keys or OIDC tokens.
- **Open WebUI:** Automations use RRULE schedules. `/api/chat/completions` takes per-user API keys and can use MCP tools via `tool_ids`.
- **Caveat for both:** an OAuth MCP connection must already be authorized interactively by that user. If it needs a fresh interactive sign-in, the run fails or is blocked.

### Cited Findings
- **LibreChat Scheduled Chats:**
  - "experimental", disabled by default, enabled with `interface.schedules`.
  - Cadence is preset or 5-field cron; each schedule has an IANA time zone; defaults are `maxPerUser` 10 and `minIntervalMinutes` 60.
  - Before a run, LibreChat checks every MCP tool, and an "authentication flow requiring interaction prevents the run".
  - Permissions are `SCHEDULES: USE` and `SCHEDULES: CREATE`.
  - No documented API to create or trigger schedules.
  — [LibreChat scheduled chats](https://www.librechat.ai/llms.mdx/docs/features/scheduled_chats)
  - The v0.8.8 notes say: "In beta: experimental and disabled by default". rc3 added "MCP readiness checks for scheduled chats" and MCP credential renewal for schedules. — [LibreChat releases](https://api.github.com/repos/danny-avila/LibreChat/releases?per_page=3)
- **LibreChat Agents API (beta):**
  - Endpoints: `POST /api/agents/v1/chat/completions`, `POST /api/agents/v1/responses`, `GET /api/agents/v1/models`, and Agent Events.
  - Gated by `remoteAgents` (default false).
  - Auth is per-user API keys or an OIDC bearer token, which "must belong to a user that already exists in LibreChat".
  - Management routes run "as the bound user with that user's permissions".
  - The docs do not explicitly say that inference calls use the key owner's MCP OAuth tokens.
  — [LibreChat Agents API](https://www.librechat.ai/docs/features/agents_api)
  - v0.8.8 "enforces tool approval policy on headless agent runs"; rc4 published an OpenAPI spec. — [LibreChat releases](https://api.github.com/repos/danny-avila/LibreChat/releases?per_page=3)
- **Open WebUI Automations:**
  - Each run "creates a chat and executes through the normal chat completion pipeline".
  - Automations are private to their creator; only the owner can open, edit, run or delete one, admins included.
  - Gated by the Features > Automations permission (settable per group).
  - Custom schedules use RRULE syntax, not cron.
  - API routes are mentioned in passing but not documented.
  — [Open WebUI Automations](https://docs.openwebui.com/features/chat-conversations/chat-features/automations.md)
  - v0.12.0: "The first run after a restart uses the model's tools, MCP servers, and filters". — [Open WebUI releases](https://api.github.com/repos/open-webui/open-webui/releases?per_page=3)
- **Open WebUI API:**
  - API keys are per user (Settings > Account); admins enable them and group permissions gate non-admins.
  - The API checks "the caller's access to each selected tool server".
  - MCP tools are passed as `tool_ids` in the form `server:mcp:<server-id>`.
  - For OAuth MCP, the key's user must already have completed the OAuth flow in the web UI.
  — [Open WebUI API endpoints](https://docs.openwebui.com/reference/api-endpoints)

### Inferences
- **Trigger.dev pattern on LibreChat:** keep one API key (or OIDC token) per employee, or mint OIDC tokens per user, and call `/api/agents/v1/responses`. The run's identity is then that user. Whether their stored MCP OAuth token gets used on API (non-UI) runs is not stated in the docs; test it.
- **Same pattern on Open WebUI:** the docs explicitly say OAuth MCP works over the API once the user has authorized in the UI. That is the clearest documented statement found for requirement 4.

### Gaps
- Neither project documents clearly what happens when a refresh token expires during unattended runs, beyond LibreChat blocking the run.

## Q4. License, seat caps, deployability, and project health

### Takeaway
LibreChat is MIT, now under ClickHouse ownership (acquired Nov 2025), and very active. Open WebUI is source-available (BSD-3 plus a branding clause from v0.6.6 on), with no seat caps on features. You may not de-brand it above 50 users, which at about 30 users doesn't affect us. LobeHub uses the "LobeHub Community License" (Apache 2.0 plus commercial restrictions on derivative works). AnythingLLM, Chainlit, chat-ui, Jan, the Vercel template and Big-AGI are MIT or Apache. Cherry Studio and Khoj are AGPL-3.0.

### Cited Findings
- **GitHub stats as of 2026-10-14:**

| Repo | Stars | License | Last push | Latest release |
|---|---|---|---|---|
| LibreChat (now `LibreChat-AI/LibreChat`) | 45,646 | MIT | 2026-10-13 | v0.8.8, 2026-10-01 |
| Open WebUI | 155,598 | "NOASSERTION" (custom) | 2026-10-13 | v0.12.0, 2026-10-10 |
| LobeHub | 83,212 | custom | 2026-10-14 | v2.2.19, 2026-10-07 |
| AnythingLLM | 67,034 | MIT | — | v1.18.0, 2026-10-13 |
| Chainlit | 12,516 | Apache-2.0 | — | 2.12.0, 2026-08-25 |
| Vercel chatbot | 20,996 | Apache-2.0 (per LICENSE file) | 2026-07-08 | no releases |
| Big-AGI | 7,145 | MIT | — | v2.1.0, 2026-08-21 |
| Cherry Studio | 52,603 | AGPL-3.0 | — | v2.1.6, 2026-10-11 |
| HuggingFace chat-ui | 10,981 | Apache-2.0 | — | v0.10.0, 2026-05-11 |
| Khoj | 37,676 | AGPL-3.0 | 2026-08-02 | 2.0.0-beta.28, 2026-03-26 |
| Jan | 44,941 | Apache-2.0 per LICENSE (Menlo Research) | — | v0.8.6, 2026-10-09 |

  — Sources: GitHub REST API repo and release endpoints, for example [api.github.com/repos/open-webui/open-webui](https://api.github.com/repos/open-webui/open-webui); [LobeHub LICENSE](https://raw.githubusercontent.com/lobehub/lobehub/HEAD/LICENSE); [Jan LICENSE](https://raw.githubusercontent.com/janhq/jan/HEAD/LICENSE); [Vercel chatbot LICENSE](https://raw.githubusercontent.com/vercel/chatbot/HEAD/LICENSE)
- **LibreChat ownership:** ClickHouse announced the acquisition on 2025-11-04, bringing in founder Danny Avila and team, with stated plans to keep investing in the open-source project. — [ClickHouse blog](https://clickhouse.com/blog/clickhouse-acquires-librechat). The repo now resolves to `LibreChat-AI/LibreChat` and is still MIT. — [GitHub API](https://api.github.com/repos/danny-avila/LibreChat)
- **Open WebUI license:**
  - From v0.6.6, the license is "not an OSI-approved 'open source' license".
  - You may not alter or remove the branding unless one of these applies: ≤50 users in a 30-day period, an enterprise license, or contributor permission.
  - The page is internally inconsistent about how the threshold is worded.
  - SSO and LDAP are allowed without a license.
  — [Open WebUI license](https://docs.openwebui.com/license)
- **LobeHub license:** commercial use "as a frontend and backend service without modifying the source code" is allowed, but "a commercial license must be obtained ... if you want to develop and distribute a derivative work". Contributors also agree that "the producer can adjust the open-source agreement to be more strict". — [LobeHub LICENSE](https://raw.githubusercontent.com/lobehub/lobehub/HEAD/LICENSE)
- **LibreChat deployment:** multi-replica deployments need a shared Redis for coordinated MCP OAuth refresh (`oauthRefreshCoordination`). — [LibreChat mcp_servers docs](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- **Open WebUI deployment:** `WEBUI_SECRET_KEY` must be set on Docker for the OAuth MCP tokens to survive restarts. — [Open WebUI MCP docs](https://docs.openwebui.com/features/extensibility/mcp.txt)
- **Seat caps:** I found no per-seat caps on automations in either project. The limits are admin-configurable: LibreChat `maxPerUser` defaults to 10; Open WebUI has `AUTOMATION_MAX_COUNT` and `AUTOMATION_MIN_INTERVAL`, which admins bypass. — [LibreChat scheduled chats](https://www.librechat.ai/llms.mdx/docs/features/scheduled_chats); [Open WebUI Automations](https://docs.openwebui.com/features/chat-conversations/chat-features/automations.md)

### Inferences
- **Service footprint (from general knowledge; I did not re-verify it this session):**
  - LibreChat: the app container, MongoDB, and optionally Meilisearch (search), its RAG API plus Postgres/pgvector (file RAG), and Redis (multi-instance).
  - Open WebUI: a single container with SQLite or Postgres and a built-in vector store, plus optional Redis for multi-worker.
  - On Render, Open WebUI is the simpler footprint. LibreChat needs a managed Mongo (Atlas) plus Postgres for RAG.
- **Overall ranking for this use case:** LibreChat (MIT, `SKILL.md`, Agents API with per-user keys, scheduled chats, per-user MCP OAuth with DCR) is narrowly ahead of Open WebUI on license and Git-friendly skills. Open WebUI is ahead on documented OAuth-MCP behaviour over the API, footprint, and maturity of its schedules. Both have their scheduling marked experimental or new.
- **Ownership risk:** the ClickHouse acquisition hasn't changed LibreChat's license, but it creates vendor-direction risk. Open WebUI's 2025 license change shows that relicensing risk is real for these projects.

### Gaps
- I did not verify LibreChat's or Open WebUI's current required-services list in their docs this session.
- Msty: I did not check its license (believed closed-source, freeware) or whether it has a multi-user mode.
