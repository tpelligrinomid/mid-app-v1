# Open-source / self-hostable agent builders and workflow platforms as an "agent OS" (LibreChat alternatives)

Research date: 2026-10-14. Budget-limited pass (~15 tool calls). Depth is strongest on n8n, Dify, Sim, Langflow and Mastra. Flowise, Activepieces, Letta, Goose, OpenHands and Botpress are thin, and CopilotKit and Rivet were not researched. Anything not cited below is listed under Gaps.

## Which candidates genuinely meet requirement 1 (per-user OAuth to a custom remote MCP server) today?

### Takeaway
Only **n8n (Enterprise plan only, Preview feature)** documents true per-end-user OAuth credentials resolved to the triggering user, and even there the docs don't confirm that the MCP Client Tool's OAuth2 credential qualifies. **Dify** has per-user identity only on Enterprise, via SSO token forwarding (not OAuth to the MCP server). In Dify Community, MCP OAuth is a workspace-shared connection. **Sim, Langflow and Flowise** use workspace or static header credentials for MCP clients. **Mastra** can do per-user MCP OAuth, but as a code framework you build it yourself. No candidate was confirmed to give each user their own OAuth token on a free or self-hosted tier.

### Cited Findings
**n8n**
- The MCP Client Tool supports Bearer, generic header, multiple headers, OAuth2 and None auth. Its docs don't mention dynamic client registration, per-user credentials or Chat Hub. — [n8n MCP Client Tool docs](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp)
- A PR from about Aug 2025 noted that the node then supported only static credentials, and maintainers said OAuth2 was in progress. This is historical context. — [n8n PR #17880](https://github.com/n8n-io/n8n/pull/17880)
- A third-party blog says MCP OAuth2 credentials use dynamic client registration (RFC 7591) by default, with manual endpoints/client ID as a fallback. Search snippets also say a 2.33.0 fix handles MCP OAuth2 token expiry and PKCE. Neither claim is verified against official docs. — [Infralovers blog](https://www.infralovers.com/blog/2026-03-09-n8n-agentic-mcp-hub/); [n8n release notes](https://docs.n8n.io/changelog/release-notes) (snippet only)
- **End-user credentials:** "End-user credentials require an Enterprise plan." They are "in Preview and may change," support "OAuth-based credential types only," can only be created in team projects, and allow one account per user per template. Admins can't view or use individual connections. — [n8n End-user credentials docs](https://docs.n8n.io/administer/manage-credentials/end-user-credentials)
- The supported triggers for end-user credentials are Manual, Chat Hub, MCP Server Trigger, Form Trigger (n8n User Auth), and Chat Trigger in **Hosted Chat only**, not embedded/webhook mode. Schedule and plain webhook are not listed. — [same](https://docs.n8n.io/administer/manage-credentials/end-user-credentials)
- The docs' example: "When user A runs the workflow, n8n reads user A's inbox. When user B runs it, n8n reads user B's inbox." — [same, via search snippet](https://docs.n8n.io/administer/manage-credentials/end-user-credentials)
- A secondary source says n8n 2.11 added a Chat Hub panel where users connect or disconnect OAuth accounts when a workflow needs them. Unverified. — [nocodecreative blog](https://blog.nocodecreative.io/n8n-chat-hub-internal-ai-agents/)

**Dify**
- Default behavior: a workflow calls an MCP server with one fixed workspace-level credential, so the MCP server sees every caller as the same account. — [Dify Enterprise docs: MCP User-Identity Forwarding](https://enterprise-docs.dify.ai/en/3.13.x/administer/sso/mcp-identity-forwarding)
- **Identity forwarding (Enterprise only, "Not available" for community):** Dify sends the user's existing IdP token in an `X-Dify-SSO-Token` header. Requirements:
  - the MCP server must trust the same IdP and validate signature, issuer and audience;
  - the IdP must be OIDC/OAuth2 (not SAML) and issue refresh tokens;
  - the feature is toggled per MCP provider.
  This is not an OAuth flow to the MCP server and does not use DCR. — [same](https://enterprise-docs.dify.ai/en/3.13.x/administer/sso/mcp-identity-forwarding)
- The core MCP provider flow stores OAuth tokens per provider, so the built-in MCP OAuth connection is shared across users. A community discussion (Oct 2025) asks for per-user MCP auth at session start, and it was still a request. — [Dify Discussion #26799](https://github.com/langgenius/dify/discussions/26799)
- A third-party Marketplace plugin, "MCP Auth Relay", claims to store OAuth tokens per user. It is community-built and unverified. — [Dify Marketplace](https://marketplace.dify.ai/plugin/kazuya-awano/mcp-auth-relay)
- Bug: MCP tool invoke drops the OAuth Authorization header when any custom header is set. — [Dify issue #42326](https://github.com/langgenius/dify/issues/42326)

**Sim (simstudio.ai)**
- MCP servers are added with a URL and optional headers, and only `streamable-http` is supported. "MCP servers are configured per workspace". "MCP servers run with the permissions of the user who configured them." The docs describe no per-user credentials or DCR. — [Sim docs: Using MCP tools](https://docs.sim.ai/agents/mcp)
- PR #8206 / release v0.8.59 add OAuth on *workflow MCP servers*, which is Sim acting as a server, not as a client. — [PR #8206](https://github.com/simstudioai/sim/pull/8206); [PR #8207](https://github.com/simstudioai/sim/pull/8207)

**Langflow**
- Issue #15408 (open, about late Sep 2026) says the MCP client only accepts a static headers dict, with "no authorization-code/PKCE flow, no dynamic client registration..., no token refresh." — [Langflow issue #15408](https://github.com/langflow-ai/langflow/issues/15408)
- Related requests: [#12091 OAuth 2.1 token refresh](https://github.com/langflow-ai/langflow/issues/12091) and [#7857 OAuth for MCP servers](https://github.com/langflow-ai/langflow/issues/7857).
- Langflow 1.6's "OAuth for MCP" covers protecting Langflow's own exposed MCP servers (via MCP Composer), not the client side. — [Langflow 1.6 blog](https://www.langflow.org/blog/langflow-1-6/)

**Flowise**
- The only MCP-auth request found is for remote MCP servers with custom headers, i.e. static auth. — [Flowise issue #4456](https://github.com/FlowiseAI/Flowise/issues/4456)
- Security: CVE-2026-41273 lets an unauthenticated user obtain stored third-party OAuth access tokens via a public chatflow. — [GHSA-6f7g-v4pp-r667](https://github.com/advisories/GHSA-6f7g-v4pp-r667)

**Mastra (code framework)**
- The docs describe per-user delegation by configuring `MCPOAuthClientProvider` through `authProvider`, and say to "isolate each user's providers, connections, tokens, and stored registration state." The default OAuth storage is in memory, so persistence needs a custom `OAuthStorage` scoped to user and connection. — [Mastra MCP authentication guide](https://mastra.ai/docs/guides/mcp-authentication-authorization)

**OpenHands / Goose**
- OpenHands supports OAuth MCP servers via FastMCP (`openhands mcp add --auth oauth`). Tokens are cached locally, per machine. — [OpenHands MCP settings](https://docs.openhands.dev/openhands/usage/settings/mcp-settings)
- Goose: third-party guides describe OAuth 2.0 + PKCE browser auth on the first tool call to a remote MCP extension. Goose is a desktop/CLI agent, so each user naturally holds their own token. — [ManageLM Goose guide](https://managelm.com/plugins/goose.html); [Civic Goose quickstart](https://docs.civic.com/nexus/quickstart/clients/goose)

### Inferences
- The strongest documented true per-user OAuth on a hosted builder is n8n Enterprise end-user credentials. It still has two caveats: it is a Preview feature, and MCP Client Tool OAuth2 is not explicitly listed as a supported type. **Test this before committing.**
- Dify Enterprise's model would work if the custom MCP server already trusts the agency's IdP (for example Google Workspace OIDC). It means changing the MCP server to validate `X-Dify-SSO-Token` rather than running its own OAuth.
- Goose and OpenHands satisfy per-user OAuth only because each employee runs their own client. Neither is a centrally governed multi-user web app.
- Mastra (and Mastra-based apps) can meet requirement 1 fully, but only as custom development. It is a framework, not a turnkey agent OS.

### Gaps
- Whether n8n's MCP Client Tool OAuth2 credential can be made an end-user credential. The docs are silent, so a hands-on test is needed.
- n8n MCP DCR/discovery was confirmed only via a third-party blog.
- Activepieces MCP client per-user OAuth: no source found.
- Letta, Botpress, CopilotKit and Rivet MCP client OAuth: no primary source found or researched.
- Flowise MCP OAuth beyond static headers: no source found.

## Which have strong scheduling AND per-user identity together (the LibreChat #16157 gap)?

### Takeaway
None do this cleanly out of the box. n8n's end-user credentials are explicitly tied to interactive or user-authenticated triggers, and Schedule isn't among them. Dify's identity forwarding explicitly excludes Cron runs and Service API calls. The practical pattern is an external scheduler (Trigger.dev) calling an API that carries the user's identity. Of the tools researched, only code frameworks (Mastra) give full control of that.

### Cited Findings
- n8n end-user credentials resolve to "the triggering user." The supported triggers are Manual, Chat Hub, MCP Server Trigger, Form Trigger and Hosted Chat Trigger, and Schedule is not listed. The docs mention no API to run as a specific user. — [n8n End-user credentials](https://docs.n8n.io/administer/manage-credentials/end-user-credentials)
- Dify identity forwarding is not supported for scheduled (Cron) runs or Service API calls, which "have no interactive user." — [Dify Enterprise docs](https://enterprise-docs.dify.ai/en/3.13.x/administer/sso/mcp-identity-forwarding)
- Dify does allow dynamic header values, so a header on the HTTP request that triggered a run (for example a Service API call) can be passed through to the MCP server. An external scheduler could therefore inject a per-user token it holds. — [Dify search summary of Dify Tools/MCP docs](https://docs.dify.ai/en/cloud/use-dify/build/mcp)
- Sim's MCP calls run with the permissions of the user who configured the server, so scheduled runs use that same configured credential. — [Sim docs](https://docs.sim.ai/agents/mcp)
- Mastra's per-user `authProvider`/`OAuthStorage` design is app-controlled, so a background job can load a given user's stored tokens. — [Mastra MCP auth guide](https://mastra.ai/docs/guides/mcp-authentication-authorization)

### Inferences
- **n8n workaround (untested):** use the MCP Server Trigger as the entry point. Have Trigger.dev call an n8n MCP server endpoint *as the user* with the user's n8n token, so the run counts as triggered by that user. This depends on Trigger.dev holding per-user n8n tokens, which may defeat the purpose.
- **Dify workaround:** a Service API call plus a dynamic header carrying a token minted by an external scheduler. You manage the token yourself, outside Dify's identity system.
- None of the candidates has a documented equivalent of "a scheduled chat that refreshes and uses the owner's OAuth token." The LibreChat-style gap appears industry-wide in this category.

### Gaps
- The LibreChat issue #16157 behavior was not re-verified in this pass.
- Scheduling plus identity for Activepieces, Letta (which has scheduled/sleep-time agents), Flowise and Langflow was not researched.

## Access control, multi-model, skills-as-code, licensing and pricing gotchas, and chat UX

### Takeaway
RBAC, SSO and per-user identity are enterprise-gated almost everywhere:
- **n8n:** end-user credentials are Enterprise-only. The Chat user role's plan availability is reported inconsistently.
- **Dify:** SSO, RBAC and identity forwarding are Enterprise.
- **Sim:** SSO and access control need an enterprise license even when self-hosted.

Licenses differ materially:
- **Dify:** Apache 2.0 plus extra conditions (no multi-tenant hosting without permission, no removing the logo). Not OSI open source.
- **n8n:** Sustainable Use License (fair-code). Internal business use is generally allowed. Not verified this pass.
- **Sim:** Apache 2.0 core plus a commercial enterprise license.
- **Activepieces:** MIT core plus `packages/ee` under a commercial license.

### Cited Findings
- n8n Chat Hub: by default chat users can't add credentials or workflows. Admins can set default credentials per provider and restrict users from adding their own. — [n8n Chat Hub docs](https://docs.n8n.io/advanced-ai/chat-hub/); [n8n blog: Introducing Chat Hub](https://blog.n8n.io/introducing-chat-hub/)
- Sources conflict on plan availability for the n8n Chat user role. One says Pro, Business and Enterprise. Another says all Cloud plans plus Business and Enterprise self-hosted. Check the current pricing page. — [n8n blog](https://blog.n8n.io/introducing-chat-hub/) vs [nocodecreative](https://blog.nocodecreative.io/n8n-chat-hub-internal-ai-agents/)
- n8n Chat Hub launched as a centralized AI access front end (Jan 2026). — [Help Net Security](https://www.helpnetsecurity.com/2026/01/28/n8n-chat-hub-centralize-ai-access/)
- Dify license: Apache 2.0 with conditions. Multi-tenant hosting (tenant = workspace) needs written permission, and the logo and copyright in the console/frontend can't be removed. The OSI license-discuss list argued this conflicts with the Open Source Definition. — [Dify LICENSE mirror](https://toscode.mulanos.cn/qambi/dify/blob/main/LICENSE); [OSI license-discuss](https://lists.opensource.org/pipermail/license-discuss_lists.opensource.org/2025-October/022425.html)
- Dify Enterprise adds SSO/SAML and RBAC, per a secondary review. — [promptquorum review](https://www.promptquorum.com/power-local-llm/dify-ai-workflow-builder-review)
- Sim: the code is Apache 2.0. Enterprise features (SSO, access control) need a subscription license for production. Self-hosted deployments can restrict MCP domains via `ALLOWED_MCP_DOMAINS`. — [Sim GitHub](https://github.com/simstudioai/sim); [Sim self-hosting docs](https://docs.sim.ai/platform/self-hosting)
- Activepieces: the Community Edition is MIT outside `packages/ee`. "Unlimited Connections" and "All Pieces" are in Community. "Project Team Members" and "Audit Logs" are Enterprise. — [Activepieces editions](https://www.activepieces.com/docs/about/editions)

### Inferences
- For a ~30-person agency, internal use is likely fine under Dify's and n8n's licenses, since you are not reselling the platform as multi-tenant SaaS. The binding constraint is that the features you need (per-user credentials, RBAC/SSO) sit in paid Enterprise tiers.
- Activepieces gating "Project Team Members" behind Enterprise suggests per-agent access control by group would also be paid.
- On chat surfaces: n8n Chat Hub and Dify Web Apps are employee-facing chat UIs. Sim, Langflow, Flowise and Activepieces are mainly builders with embeddable chat widgets. Mastra, CopilotKit and Letta are frameworks needing your own UI. Goose and OpenHands are per-user desktop/CLI/dev tools.

### Gaps
Not verified in this pass:
- **n8n Sustainable Use License terms:** the exact text was not fetched.
- **n8n per-agent access control:** whether Chat Hub agents can be hidden by user, group or role, and on which plan.
- **Multi-model support (Claude plus OpenRouter or local) per platform:** all major builders (n8n, Dify, Flowise, Langflow, Sim) are widely known to support Anthropic, OpenRouter and Ollama, but no source was collected for any of them.
- **Skills-as-code / SKILL.md / Git sync:** not researched for any candidate. n8n has source-control (Git) environments, which is believed to be Enterprise, but no source was collected.
- **Mobile chat UX quality:** not researched for any candidate.
- **Pricing:** dollar figures for n8n Enterprise self-hosted, Dify Enterprise and Sim Enterprise were not found.
- **Not researched at all:** CopilotKit, Rivet and Botpress (beyond third-party MCP listings), and Letta (no Letta-specific MCP/OAuth results returned).
