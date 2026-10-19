# Hosted (SaaS) AI agent platforms as a company-wide "agent OS" (~30-person agency), October 2026

Scope note: about 20 tool calls covered 12 candidates, so depth varies. Primary docs were fetched for Lindy, Relevance AI, Gumloop, Cassidy, Abacus, TypingMind and Writer. Pricing comes from primary pages for Lindy and Relevance only. Pricing for Zapier and MindStudio comes from third-party aggregators and is marked that way. Nothing was researched for Poe for teams or Make AI Agents, so they appear only under Gaps. Requirements are numbered R1-R6 as in the brief.

## Q1: Which platforms support both per-user OAuth to a custom remote MCP server and scheduling?

### Takeaway
No candidate documents the full chain: each employee signs in to a custom MCP server with their own OAuth, and a scheduled run then carries the owner's identity into MCP calls. Three platforms document per-user OAuth to custom MCP: Cassidy (per-user is the recommended mode), Gumloop (proxied OAuth MCP: "OAuth makes each person sign in") and Abacus ChatLLM Teams (an org-shared server config where each member authenticates). Cassidy and Gumloop also have workflows or triggers. Neither documents whose OAuth token a scheduled or unattended run uses. That gap is the main thing to test in a POC.

### Cited Findings
**Cassidy**
- Custom MCP Connectors offer two modes. Per-user is recommended: "Each user connects their own account" and signs in the first time an Agent needs the Connector, so "each person sees only what they can already access." The shared mode means "Everyone uses one saved account and its permissions", and Cassidy recommends a service account for it. — [Cassidy: Set up a Custom Connector](https://docs.cassidyai.com/agents/connectors/mcp-servers)
- OAuth setup is manual, with optional Client ID, Client Secret and Scope under "Advanced OAuth Credentials" and a fixed redirect URL `https://app.cassidyai.com/api/connections/mcp`. The docs do not mention DCR. — [Cassidy docs](https://docs.cassidyai.com/agents/connectors/mcp-servers)
- Per-connector access: "Manage access" shares a connector "with specific people or groups, or with the whole organization," and restricted connectors show as Restricted in the catalog. Each action can be set to Always allow, Ask every time or Disabled. Only users with the "Manage Connectors" privilege can add custom connectors. — [Cassidy docs](https://docs.cassidyai.com/agents/connectors/mcp-servers)
- Connectors can be used in Agents, Skills and Workflow AI actions. The docs do not explain how per-user sign-ins behave in workflows that run with no one present. — [Cassidy MCP integration](https://docs.cassidyai.com/integrations/mcp.md); [Cassidy docs](https://docs.cassidyai.com/agents/connectors/mcp-servers)

**Gumloop**
- Custom MCP needs a public HTTPS server using Streamable HTTP or SSE, with no local or STDIO servers. The docs list "Automatic OAuth flow discovery (RFC 8414) for compatible servers" but say nothing of RFC 9728 or DCR. — [Gumloop: Custom MCP servers](https://docs.gumloop.com/nodes/mcp/custom_mcp_servers.md)
- Credentials are either personal ("only you can use them") or team-level ("shared with your team"). — [Gumloop: Custom MCP servers](https://docs.gumloop.com/nodes/mcp/custom_mcp_servers.md)
- On proxied MCP: "None / API Key shares one org secret," but "OAuth makes each person sign in." For a personal custom MCP on a shared agent, "Each person adds the custom MCP," and "Gumloop does not silently share one person's personal login." — [Gumloop: custom vs proxied vs hosted MCP](https://docs.gumloop.com/help/skills-triggers-mcp/custom-proxied-hosted-mcp.md)
- Gotchas: the Additional Header field takes one header only, Anthropic models do not forward custom headers (use a Bearer token instead), and "All exposed tools are available to the AI without approval prompts." — [Gumloop: Custom MCP servers](https://docs.gumloop.com/nodes/mcp/custom_mcp_servers.md)
- Scheduled agent triggers (recurring or one-time, app and webhook) are reported only by a third-party listing. I did not confirm them in Gumloop docs. — [Anavem (third-party)](https://www.anavem.com/tools/gumloop)

**Abacus ChatLLM Teams**
- Admins can share a server org-wide, but "no credentials are shared: each member connects and authenticates with their own account." Abacus recommends OAuth for remote servers. — [Abacus connectors: MCP Servers](https://abacus.ai/help/connectors/mcpServers); [Abacus ChatLLM MCP help](https://abacus.ai/help/chatllm-ai-super-assistant/mcp-servers/)
- Hard limits: "up to 5 servers and up to 50 tools across those servers." A Custom Chatbot that uses MCP cannot be made Public because it relies on per-user credentials. — [Abacus connectors: MCP Servers](https://abacus.ai/help/connectors/mcpServers); [Abacus help](https://abacus.ai/help/chatllm-ai-super-assistant/mcp-servers/)
- I found nothing on scheduled tasks that use MCP. — same sources

**Lindy**
- Custom MCP needs only a public HTTPS streamable-HTTP URL. "Servers that run their own OAuth flow need nothing here." Static credentials (bearer, custom header, query parameter) go under Advanced. The docs say nothing about DCR or client ID and secret. — [Lindy MCP docs](https://docs.lindy.ai/integrations/mcp)
- A product can have "a personal connection and a shared one." Availability is either "Only you" or "Your workspace." "Sharing is the connection owner's call," and admins "can revoke sharing" but "cannot grant it or reconnect the credential on your behalf." — [Lindy MCP docs](https://docs.lindy.ai/integrations/mcp)
- The MCP page does not cover triggers or schedules. The Lindy pricing page lists "scheduled workflows" as a credit-consuming activity, which confirms scheduling exists. — [Lindy MCP docs](https://docs.lindy.ai/integrations/mcp); [Lindy pricing](https://www.lindy.ai/pricing)

**Relevance AI**
- Relevance supports remote MCP servers only, over Streamable HTTP; local or JSON configuration is not available. Preset servers (Notion, Canva, Atlassian) use OAuth. For custom servers you "enter any required authentication details." Each connection has "its own authentication credentials," and the docs list use cases such as "separate user credentials for different data access." The docs do not say whether credentials are bound per end user at runtime, and they do not mention DCR. — [Relevance AI MCP Client](https://relevanceai.com/docs/integrations/mcp/mcp-client)

**TypingMind Teams**
- The 14 Nov 2025 changelog announced remote MCP with "OAuth + OpenID, custom OAuth client, or via API key in headers," for both the Personal and Team versions. — [TypingMind changelog](https://feedback.typingmind.com/changelog/remote-mcp-support-and-in-app-mcp-store)
- "Sessions… are managed per chat (and per user in the Team version)," and each Team workspace gets its own OAuth redirect URL. The docs do not explicitly state per-user token storage. — [TypingMind MCP docs](https://docs.typingmind.com/model-context-protocol-in-typingmind)
- TypingMind is a chat front end. I found no scheduling feature.

**Writer**
- MCP connectors "are currently available for WRITER Agent, and connectors do not currently support Agent Builder, no-code agents, or API integrations." Connectors support OAuth 2.0 and API keys. — [Writer dev docs: MCP gateway](https://dev.writer.com/home/mcp-gateway)
- The Help Center labels Connectors BETA, and admins control which connectors end users can access. — [Writer support: Setting up Connectors (BETA)](https://support.writer.com/article/299-setting-up-connectors)

**Zapier Agents**
- I found no Zapier documentation for connecting a third-party custom MCP server inside Zapier Agents. The Zapier MCP docs are about Zapier as an MCP server. — [Zapier MCP docs](https://docs.zapier.com/mcp/get-started/connect/linear)

**StackAI**
- The docs I found cover StackAI as an MCP server, either hosted at `mcp.stack-ai.com/mcp` or self-hosted with Docker, with OAuth login. I found no docs on consuming a custom MCP server with per-user OAuth. — [StackAI MCP Server docs](https://docs.stackai.com/mcp-server/stackai-mcp-server); [StackAI blog](https://stackai.com/blog/how-to-use-the-stack-ai-mcp-server)

### Inferences
- Per-user OAuth to a custom MCP server is now common, documented by Cassidy, Gumloop, Abacus, TypingMind and Lindy, the last implicitly. Two things are not documented anywhere: OAuth identity for scheduled or background runs, and DCR. Our MCP server uses DCR/discovery, so it may need a pre-registered client ID and secret on Cassidy, or reliance on RFC 8414 discovery on Gumloop.
- Likely behavior, inferred and unverified: a scheduled run uses the token of the user who built or owns the workflow, or a shared team credential. That would match "owner's identity" for personal automations, but it needs testing.
- Best candidates to POC for R1+R4: Cassidy (strongest documented per-user plus group ACL) and Gumloop (per-user OAuth plus RFC 8414 discovery plus triggers). Lindy is third, since its personal versus workspace connection model fits but its OAuth details are thin.
- Weak fits: Writer (MCP excluded from Agent Builder), Abacus (5-server cap, no scheduling evidence), TypingMind (no scheduling), Zapier Agents (no custom MCP client docs found).

### Gaps
- No primary source confirms which identity's OAuth token is used for scheduled or triggered runs on any platform. This applies to Cassidy, Gumloop and Lindy.
- DCR (RFC 7591) support is undocumented everywhere. RFC 9728 protected-resource metadata is undocumented everywhere.
- Per-agent ACL (R2) is documented only for Cassidy connectors (people or groups). I did not verify agent-level sharing ACLs for Gumloop, Lindy or Relevance.
- R5 (skills and instructions as code in Git) is not documented by any candidate. None of the sources mention Git sync. Relevance, Gumloop and StackAI have APIs, but I did not research them.
- Not researched: Poe for teams, Make AI Agents, and MindStudio's MCP client. MindStudio's docs found only describe exposing MindStudio agents as an MCP server — [MindStudio University](https://university.mindstudio.ai/docs/building-ai-agents/mcp-servers).

## Q2: What are the real usage caps and credit economics for heavy scheduled automation?

### Takeaway
Most of these platforms are credit- or task-metered. For heavy scheduled automation, that metering costs more than seats do. Lindy's own pricing page puts scheduled workflows in its highest credit band, 1,000 to 2,500 credits each, while the Team plan starts at 5,000 pooled credits for $49.99. Relevance AI no longer publishes self-serve tiers, so its cost is sales-quoted only.

### Cited Findings
- **Lindy:** Free gives $50 of credits for 7 days. Team starts at $49.99/mo for 5,000 credits, "every active user is billed," credits are pooled, and tiers run up to 1,750,000 credits for $9,999.50/mo. Top-ups cost $10 per 1,000 credits. Monthly credits do not roll over. Usage bands are everyday asks at 2-250 credits, deep work at 250-1,000, and "big builds… scheduled workflows" at 1,000-2,500. When credits run low, Lindy pauses rather than overbilling. SSO/SCIM and audit logs are Enterprise only. — [Lindy pricing](https://www.lindy.ai/pricing)
- **Relevance AI:** The pricing page shows only Enterprise ("Talk to sales"), with unlimited users, agents and projects, "custom actions and custom vendor credits", RBAC, SSO and audit logs. It lists no prices. — [Relevance AI pricing](https://relevanceai.com/pricing)
- **Zapier:** MCP tool calls cost 2 tasks per successful call. Agents are billed in "activities," separately from tasks. The Free Agents tier reportedly gets 400 activities/month with a cap of 10 activities per run. Core plans run Professional from $19.99/mo (750 tasks) to Team $69/mo (2,000 tasks). All of this comes from third-party summaries; I did not fetch Zapier's pricing page. — [eesel.ai](https://eesel.ai/blog/zapier-subscription); [Anavem](https://www.anavem.com/pricing/zapier); [Zapier blog](https://zapier.com/blog/what-is-a-task-in-zapier/)
- **MindStudio:** Free covers 1 agent and 1,000 runs/mo. Individual is about $20/mo; one source says $24/user/mo, so that figure conflicts. Business pricing is by quote. Model usage is billed "at provider cost, with no markup." Third-party sources only. — [Hack'celeration](https://hackceleration.com/labs/mindstudio-pricing); [CostBench](https://costbench.com/software/ai-automation/mindstudio/); [Toolradar](https://toolradar.com/tools/mindstudio/pricing)
- **StackAI:** A public Free plan exists. Enterprise is custom and includes on-prem or VPC. One third-party source claims a $199 Pro tier, which conflicts with another saying there is no intermediate tier. — [Yespress (third-party)](https://yespress.io/products/stack-ai.md); [AWS Marketplace listing](https://aws.amazon.com/marketplace/pp/prodview-tfiuk6zpxfvc4)
- **Gumloop:** The pricing page could not be fetched, because the static render returned no content. — [Gumloop pricing](https://www.gumloop.com/pricing)

### Inferences
- Lindy at scale (inference from published bands): one daily scheduled workflow at about 1,500 credits comes to about 45,000 credits/month per automation. That is roughly 9 times the 5,000-credit base, or about $400+/mo at the $10/1k top-up rate for a single automation. Heavy scheduled use makes Lindy expensive.
- Zapier's 10-activities-per-run cap (unverified) would limit multi-step agent runs.
- Credit-metered SaaS charges the platform margin on every scheduled run. Unless the platform offers BYO keys with no markup, a self-hosted or BYO-key stack is likely far cheaper for heavy automation.

### Gaps
- Gumloop, Cassidy, Writer, TypingMind Teams, Abacus, Poe and Make: I did not retrieve current per-seat prices or credit allowances from primary pages. From training memory, possibly outdated and to verify: Abacus ChatLLM is about $10/user/mo, TypingMind Teams is seat-based, and Make bills operations/credits.
- I found no primary source for a per-run timeout or concurrency limit on any platform.

## Q3: Which platforms are self-hostable, or support BYO models with no markup?

### Takeaway
Among these SaaS candidates, StackAI is the only one with a documented self-host or VPC option, and it is Enterprise-only. MindStudio is the clearest "no markup on model usage" claim (third-party sourced), and it has a BYO-key path. Most others do not document BYO keys or Claude-plus-open-model routing. For a self-hosted, BYO-model stack, the Dust/Langdock benchmarks or OSS alternatives would be the better comparison.

### Cited Findings
- StackAI offers on-prem or VPC under Enterprise, plus a "Customer Hosted (VPC or On prem)" AWS Marketplace listing, price not shown. Its MCP server can be self-hosted with Docker. — [Yespress](https://yespress.io/products/stack-ai.md); [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-p6pd4dwnmgyew); [StackAI MCP docs](https://docs.stackai.com/mcp-server/stackai-mcp-server)
- MindStudio supports BYO provider API keys through its Service Router, and the provider account must hold prepaid credits. Third-party sources say model usage is billed at provider cost with no markup. — [MindStudio blog](https://www.mindstudio.ai/blog/how-to-use-your-own-ai-model-api-keys-with-mindstudio); [Hack'celeration](https://hackceleration.com/labs/mindstudio-pricing)
- TypingMind: the MCP Connector is open-source and can be deployed to your own server. TypingMind is known as a BYO-key chat UI, but I did not verify current BYO-key and OpenRouter docs this round. — [TypingMind MCP docs](https://docs.typingmind.com/model-context-protocol-in-typingmind)
- Lindy offers "model selection per task" with "most major models," and its pricing page does not mention BYO keys. — [Lindy pricing](https://www.lindy.ai/pricing)
- Relevance AI's pricing page does not mention BYO keys or self-hosting. — [Relevance AI pricing](https://relevanceai.com/pricing)
- Gumloop documents a Claude-specific limitation: custom headers are not forwarded. This confirms Claude is selectable on Gumloop. — [Gumloop docs](https://docs.gumloop.com/nodes/mcp/custom_mcp_servers.md)

### Inferences
- None of the candidates gives a self-hosted agent OS with per-user MCP OAuth and scheduling at SMB pricing. StackAI self-host is enterprise-priced, and TypingMind self-host is a chat UI without scheduling.
- The best combination of BYO model and multi-model support is probably TypingMind (chat) or MindStudio (agents), but neither is verified for R1+R4 together.

### Gaps
- I did not verify OpenRouter or local-model support for any candidate from primary docs.
- I did not check BYO-key markup policies for Relevance AI, Gumloop, Cassidy, Writer, Abacus or Poe. Writer primarily runs its own Palmyra models, so Claude support there is unverified.
- Poe for teams and Make AI Agents were not researched at all.
