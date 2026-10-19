# Ocean — AI Agent Environment

**Architecture brief | October 10, 2026**  
**Audience:** Team and AI development assistant managing the Lovable → independently hosted Pulse / Compass migration  
**Status:** Proposed architecture, not permission to change production

## Executive summary

**Ocean** is the new employee-facing AI environment for Project Ocean. It should give employees one browser-based chat workspace to access company tools, client/contract intelligence, reusable skills, specialized agents, and automations. We intend to customize an existing agent runtime such as **Hermes**, potentially hosted through **Orgo** or another managed Hermes provider. **We do not intend to build our own Hermes/OpenClaw replacement.** No hosting vendor is selected yet.

Ocean has three logical agent types:

1. **Role Agents** — personalized for employees (Account Director, Strategist, Creative Director, Operations), working across their *authorized* contracts.
2. **Contract Agents** — **one logical agent per Compass contract**. A contract can cover research, content, paid media, analytics, and more. The contract, not client or service line, is the primary context and security scope.
3. **Capability Agents** — reusable functional specialists (Paid Media Analysis, Competitive Research, Content Strategy, SEO, Reporting) that apply standardized skills to authorized contract context.

**Compass is the system of record for contract intelligence. Pulse / Compass MCP is the secure tool interface. Master Marketer remains the specialized marketing workflow engine, with Trigger.dev running long and complex jobs. Ocean is the employee-facing conversational orchestration layer.**

The objective is to capture the methods of the best employees as reviewed, versioned, reusable skills, and distribute them across the organization without leaking contract data.

## 1. Existing platform — preserve these investments

Known current state, subject to source-code verification:

- **Pulse / Compass:** Frontend originally built in Lovable; database in Lovable Cloud-managed Supabase. Existing chat and working RAG/intelligence retrieval. Contract-segmented data including meeting notes, deliverables, version history, reporting and campaign changes.
- **Backend:** Separate repository hosted on Render.
- **API service:** Separate repository hosted on Render; accesses third-party APIs and uses Trigger.dev.
- **Supabase and Edge Functions:** Render services access the Lovable-managed Supabase environment and Edge Functions. Confirm exact data paths, RLS, secrets and service roles.
- **Pulse / Compass MCP:** Existing MCP interface. Inventory available tools and confirm how identity, permissions and contract scope are enforced.
- **Master Marketer:** Existing skills-driven marketing capability. Backend assembles intelligence, sends it to Master Marketer, and returns results to Pulse / Compass.
- **Trigger.dev:** Existing orchestration for long-running, multi-source workflows. A research report may use ~15 data sources and run for ~15 minutes.
- **Engineering:** Production is stable, but development has been directly against production without staging. One person has been the development bottleneck; an existing team of ~1–2 people should take over.

**Do not rebuild existing RAG, Master Marketer, Trigger.dev workflows, or Render services just to introduce Ocean.**

## 2. Target architecture

```text
                      OCEAN — employee browser workspace
                  Chat | personal settings | skills | jobs
                                      |
                     Authenticated employee identity
                                      |
           +--------------------------+-------------------------+
           |                          |                         |
      ROLE AGENTS                CONTRACT AGENTS          CAPABILITY AGENTS
     Per employee               One per contract         Shared specialists
           |                          |                         |
           +--------------------------+-------------------------+
                                      |
                     Ocean routing and policy controls
                  Delegation | approvals | audit | identity
                                      |
                         PULSE / COMPASS MCP
                    Authorized contract-scoped tools
                                      |
            +-------------------------+----------------------+
            |                         |                      |
      COMPASS INTELLIGENCE       MASTER MARKETER        OTHER TOOLS
      RAG, data, artifacts       Specialized skills     CRM, ads, ClickUp
            |                         |                      |
            +-------------------------+----------------------+
                                      |
               Existing Supabase / Edge Functions / Render
                           Trigger.dev workflows
```

This is a **logical** architecture. One agent does not necessarily mean one always-on computer. Orgo's advertised cloning, isolated computers and workspaces are promising, but bulk provisioning, inherited template updates, SSO, delegation, and enterprise security must be tested rather than assumed.

## 3. Agent taxonomy

### Role Agents — who is doing the work?

Personalized to each employee and their role. They coordinate across contracts that employee is authorized to access, maintain employee preferences, prepare account briefings, schedule approved workflows and call Contract or Capability Agents. A Role Agent cannot gain extra permissions by delegating work.

Examples: Account Director Agent, Strategist Agent, Creative Director Agent, Operations Agent.

### Contract Agents — which engagement are we serving?

Provision **one logical Contract Agent per canonical Compass `contract_id`**. A contract may span paid media, research, content and analytics; do not create separate contract agents by service. The agent has contract-specific objectives, working context, approved tools and skills, and access to Compass knowledge **through authorized MCP calls**. Durable contract records stay in Compass. Contract Agents may invoke multiple Capability Agents and Master Marketer workflows.

A Contract Agent's existence is **not** an entitlement: every request must still be checked against the initiating employee's permissions. Contract Agent memory must not leak across contracts.

### Capability Agents — how is work performed?

Shared functional specialists that operate on authorized contract data, without maintaining their own permanent copy of each client's records. They apply reusable procedures and invoke MCP tools or Master Marketer workflows.

Examples: Paid Media Analysis, Competitive Research, Content Strategy, SEO Audit, Reporting, Campaign Optimization.

**Not every skill needs its own agent.** A skill is a procedure; a Capability Agent can invoke many skills. Some skills are better implemented as existing Trigger.dev workflows.

## 4. Skills, templates and organizational learning

- **Company skills:** Organization-wide methods, standards and controls.
- **Role skills:** Methods for Account Directors, Strategists, etc.
- **Capability skills:** Research, paid media, content, SEO and reporting procedures.
- **Contract skills:** Contract-specific instructions and Compass references; never publish confidential client data as global skill content.
- **Personal skills:** Employee experiments, preferences and custom workflows.

Desired promotion path: employee creates a useful personal skill → department lead reviews → test security and quality → publish a versioned shared skill → distribute to eligible agents → monitor and roll back if needed.

Keep canonical skill definitions versioned (e.g., GitHub) and manage assignments and versions in Compass or a dedicated registry. **Cloning is not the same as ongoing template inheritance.** Verify how provider updates reach existing agents without overwriting personal preferences. The system should preserve ownership of institutional knowledge if an employee leaves.

## 5. Identity, authorization and isolation

Effective access must never exceed:

`employee permissions ∩ delegated agent permissions ∩ contract scope ∩ tool action policy`

Requirements:

- Centrally authenticate employees; prefer SSO.
- Pass verifiable, short-lived employee/delegation context to Pulse MCP. Do not trust agent-supplied contract IDs as proof of authorization.
- Enforce contract-level authorization **server-side on every tool call**, including agent-to-agent delegation and job-result retrieval.
- No unrestricted Supabase service-role keys or shared administrator tokens inside employee-accessible agent environments.
- Separate contract data, conversation state, reusable skills and logs. Enforce appropriate tenant isolation and RLS where relevant.
- Log initiating employee, contract, agent, tool, job, approval and outcome.
- Require human approval for client-facing messages, campaign changes, spend, deletion and other consequential actions at launch.
- Revalidate permissions when scheduled tasks run; revoke sessions, tokens and jobs on offboarding or contract reassignment.
- Isolate code execution, credentials, files and network access. Assess vendor security, data retention, subprocessors and agreements before sending real client data.

## 6. Pulse / Compass MCP interface

Favor high-level, stable, authorized business tools rather than raw database access. Illustrative **proposed** operations (not assertions that these exist today):

| Tool | Purpose |
|---|---|
| `compass_search` | Search authorized contract knowledge with source references |
| `compass_ask` | Reuse existing grounded RAG answering |
| `compass_get_contract_context` | Contract scope, goals and relevant history |
| `compass_get_meetings` | Meeting notes and decisions |
| `compass_get_deliverables` | Deliverables and version history |
| `compass_get_performance` | Available reporting and campaign metrics |
| `compass_save_insight` | Save approved work to the correct contract |
| `master_marketer_start_workflow` | Launch an existing specialized workflow |
| `workflow_get_status` | Return progress/status of Trigger.dev job |
| `workflow_get_result` | Retrieve completed contract-scoped artifacts |
| `workflow_cancel` | Cancel when supported and authorized |

Tool responses should have structured outputs, contract scope, errors, provenance where applicable and stable artifact references.

## 7. Master Marketer and long-running jobs

**Preserve the current Master Marketer → Trigger.dev execution path.** Ocean calls it as a tool; it does not reimplement the 15-minute research pipeline inside an interactive Hermes chat turn.

Proposed lifecycle:

1. Employee requests research in Ocean.
2. Role/Contract Agent invokes a scoped MCP operation.
3. Backend checks identity, contract, action and parameters.
4. Master Marketer/Trigger.dev job starts and immediately returns a `job_id` and status.
5. Existing workflow gathers sources, analyzes and generates output.
6. Results are persisted to the correct Compass contract or approved artifact store.
7. Ocean checks status or receives a completion event, displays results and supports follow-on work.

Specify retry, idempotency, cancellation, notifications, partial failure and job authorization. Do not assume Orgo/Hermes supports callbacks or agent delegation without proof.

## 8. Memory and source-of-truth boundaries

- **Compass:** Durable contract knowledge, data, meeting history, deliverables, research outputs, permissions and provenance.
- **Ocean/Hermes:** Conversations, personal preferences, short-term working memory, temporary files and active plans.
- **Skill registry:** Versioned instructions, templates, tests and publication status.
- **Trigger.dev/backend:** Execution state, retries, diagnostics and job IDs.

Contract Agents can have persistent *working* memory, but must retrieve authoritative contract intelligence from Compass. Define export, backup, retention, deletion and archival policies for each store.

## 9. Hosting and deployment model

**Preferred POC:** Hermes hosted on Orgo, while comparing suitable managed Hermes alternatives if necessary. We want a managed agent runtime, **not** to engineer a new framework or run generic cloud infrastructure solely for its own sake.

The supplied Orgo product screenshot advertises always-on isolated computers, templates/cloning, configurable compute, and workspaces/roles. Verify in a live demonstration:

1. Can we provision employees and Contract Agents programmatically from versioned templates?
2. Is there a secure, usable browser chat interface without Slack or messaging apps?
3. Can MCP credentials be scoped per employee and contract, with revocation?
4. Can one Role Agent invoke Contract and Capability Agents with preserved identity?
5. Can centrally published skills update existing agents safely?
6. Can we monitor costs, errors, jobs, audit events and backups centrally?
7. Can we export configurations and move to another Hermes host if needed?

A **logical agent** does not require a dedicated always-on VM. Reserve persistent computers for agents that need browser automation, filesystem state or isolated code execution. Technical operations staff may use sandboxed code/application deployment with GitHub review and staging; do not give every employee unrestricted execution privileges.

## 10. Lifecycle and provisioning

| Event | Desired action |
|---|---|
| Employee joins | Create personal Role Agent from approved template |
| Employee role changes | Update role skills and permissions, preserve allowed personal settings |
| Contract created in Compass | Create logical Contract Agent keyed to `contract_id` |
| Employee assigned to contract | Enable authorized access through their Role Agent |
| Contract services change | Update allowed skills/capabilities |
| Shared skill approved | Roll out version to eligible agents |
| Contract ends | Revoke tools, handle pending jobs, archive according to policy |
| Employee leaves | Revoke access, sessions, secrets and scheduled jobs |

All provisioning should be idempotent, logged, reversible and compatible with template updates.

## 11. Relationship to Lovable → self-hosted Pulse / Compass migration

**These are separate but coordinated workstreams.** The production application is stable; preserve that stability while transferring engineering responsibility to the internal team.

Priorities for the migration assistant:

1. Audit the Lovable frontend, Lovable Cloud Supabase database, RLS, auth, storage, Edge Functions, secrets, Render repositories, Trigger.dev and MCP integrations.
2. Put frontend, backend, API code, Edge Functions and schema migrations under controlled version management where technically possible.
3. Establish a **fully isolated staging environment** before changing production: staging frontend, independent Supabase data/auth/storage/functions, staging Render services and safe Trigger.dev jobs. Use synthetic or sanitized test data and nonproduction third-party credentials.
4. Implement GitHub PR review, automated checks, deployment approval, rollback and monitoring. No AI coding agent should have unrestricted production write access.
5. Migrate Lovable Cloud dependencies to company-controlled infrastructure in a separate, tested cutover; validate user authentication, storage, RLS, integrations and recovery.
6. Expose existing Compass intelligence and Master Marketer workflows as governed MCP capabilities, reusing existing services.
7. Prototype Ocean **in parallel**, without requiring production Compass changes or prematurely retiring the existing chat.
8. Only retire Compass chat after Ocean matches or exceeds it on answer accuracy, provenance, contract permissions, reliability and usability.

**Do not conflate moving development to Claude Code/Amp with moving infrastructure out of Lovable Cloud.** The team can establish controlled development first and plan the backend migration separately.

## 12. Pilot and acceptance criteria

Start with **2 employee Role Agents, 3 Contract Agents and 1–2 shared Capability Agents**, backed by existing Compass data and a test/staging environment.

The pilot must demonstrate:

- Two employees receive personalized agents from one role template.
- Three Contract Agents are created using canonical Compass contract IDs.
- A Role Agent can ask a cross-contract question **only** over authorized contracts.
- A Contract Agent can call a shared Paid Media Analysis Capability Agent.
- A Contract Agent can launch a ~15-minute Master Marketer/Trigger.dev research job and retrieve the result without keeping chat requests open.
- A strategist's new skill can be reviewed, versioned, published and made available to another employee/contract.
- Denied users cannot obtain data through direct tools, delegated agents, cached memory, job status or saved artifacts.
- Skill updates do not destroy employee customizations; agent and skill configurations are exportable.
- Technical owners can monitor, troubleshoot, revoke access and recover from failure without relying on the original application developer.

Do not scale to all employees or contracts until these pass.

## 13. Open decisions / validation questions

- Which managed Hermes host meets provisioning, SSO, chat, policy and audit requirements? Orgo is a candidate, **not a confirmed selection**.
- What agent-to-agent delegation mechanism is supported, and how does it preserve initiating employee identity?
- What is the current MCP tool inventory, and which methods already enforce contract-level permissions?
- How are current Master Marketer skills stored and versioned? Which should remain backend workflows versus become Hermes skills?
- Where will the canonical skill registry and template assignments live?
- What is the cost of one logical Contract Agent versus one always-on cloud computer? Can idle agents suspend?
- What must persist in agent memory versus Compass?
- What vendor security controls and client contractual constraints govern hosted agent processing?
- Which staging components can be provisioned without relying on Lovable Cloud export features?

## 14. Instructions to the implementing LLM

**Treat this document as the target vision and constraints, not as a request to immediately implement everything.**

First produce:

1. A **current-state architecture inventory**, verified from repositories and deployed services, with unknowns labeled.
2. A **dependency map** covering frontend, Supabase, Edge Functions, Render, Trigger.dev, Master Marketer, RAG and MCP.
3. A **staging-first migration plan** with rollback and production safety requirements.
4. An **Ocean integration plan** showing minimal additions needed to expose Compass intelligence and Master Marketer jobs through MCP.
5. A **Hermes/Orgo POC plan** for Role, Contract and Capability Agents, template distribution, identity, security and cost validation.
6. A **phased backlog** separating must-have infrastructure, POC features and future enhancements.

**Non-negotiables:** No unnecessary rewrite; no direct production experimentation; no cross-contract data leakage; no duplicated Compass source of truth; no replacement of working Trigger.dev pipelines merely to adopt Hermes; and no dependency on one employee as the sole developer/operator.

**North star:** One Ocean environment for employees; one logical agent per contract; shared functional Capability Agents; personalized Role Agents; Compass as the intelligence source; Pulse MCP as the secure bridge; Master Marketer and Trigger.dev as proven execution services; reusable organizational knowledge distributed through versioned skills.
