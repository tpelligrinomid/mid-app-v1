# Pulse Portfolio Chat — Backend Spec & Handoff

**Audience:** Render backend team
**Status:** Spec v1 — DB migration applied, frontend pending
**Owner:** MiD platform
**Last updated:** 2026-04-24

---

## 1. Problem & Goal

The platform already has two contract-scoped RAG chats inside Compass (Management chat over notes/meetings/deliverables, Content Ops chat over the content library). Both filter retrieval by a single `contract_id`.

We need a **portfolio-level chat in Pulse** ("Ask Pulse") that lets the CEO and managers query across **many contracts at once**, mixing structured operational data (priority, manager, points, financials) with unstructured RAG (meeting sentiment, action items, deliverables).

**Example prompts:**
- *"Give me a digest of Tier 1 contracts and any action items or sentiment from recent meetings."*
- *"Which of my accounts have negative sentiment trending in the last 14 days?"*
- *"Summarize the last 5 deliverables across the portfolio."*
- *"Which contracts are over points burden right now?"*
- *"What did we decide about pricing across the portfolio in Q1?"*

This is **not** "remove the contract filter from the existing chat." It's a different query pattern — multi-contract permission scoping plus tool-calling that fuses structured and unstructured queries.

---

## 2. Access Model

| Role | Allowed contract set |
|------|----------------------|
| **Owner** | All contracts where `engagement_type != 'internal'` |
| **Admin** | All contracts where `engagement_type != 'internal'` |
| **Team Member** | Contracts where they're listed as `team_manager` OR `account_manager` (resolved via `get_user_managed_contract_ids()`) |
| **Client** | No access |

**Critical:** The allowed contract set is **always resolved server-side** from the JWT. Never trust a client-provided contract list as authoritative — only use it to *narrow* the server-resolved set.

```
final_contract_ids = server_allowed_set ∩ (client_filter ?? server_allowed_set)
```

---

## 3. UX Summary (for context)

New sidebar item under Pulse: **"Ask Pulse"**. Reuses the existing `ChatPage` component with `scope: 'portfolio'`.

**Filter chips above the input** (default = "All my contracts"):

| Chip | Visible to | Behavior |
|------|-----------|----------|
| All my contracts | Everyone with access | Default. Uses full server-resolved allowed set. |
| Tier 1 / Tier 2 / Tier 3 | Everyone | Adds `priority IN (...)` filter |
| **By Account Manager** | **Owner + Admin only** | Picker → narrows to one AM |
| **By Team Manager** | **Owner + Admin only** | Picker → narrows to one TM |
| Specific contracts | Everyone | Multi-select combobox |

The selected filter is persisted on the conversation record (`contract_filter` JSONB) so reopening a conversation restores the scope.

---

## 4. Database Changes (already applied)

Migration ran successfully. Summary:

### 4.1 `compass_chat_conversations` extended

```sql
-- contract_id is now nullable
ALTER TABLE compass_chat_conversations ALTER COLUMN contract_id DROP NOT NULL;

-- new columns
ADD COLUMN scope text NOT NULL DEFAULT 'contract';   -- 'contract' | 'portfolio'
ADD COLUMN contract_filter jsonb;                     -- saved filter selection

-- constraints
CHECK (scope IN ('contract', 'portfolio'))
CHECK (
  (scope = 'contract'  AND contract_id IS NOT NULL) OR
  (scope = 'portfolio' AND contract_id IS NULL)
)

-- index
CREATE INDEX idx_compass_chat_conversations_scope_user
  ON compass_chat_conversations (scope, created_by);
```

**Existing RLS policies already key on `created_by = auth.uid()`** — portfolio conversations are private to their creator. No policy change needed.

**`contract_filter` JSON shape (suggested):**
```json
{
  "type": "all" | "priority" | "account_manager" | "team_manager" | "contract_ids",
  "value": "tier_1" | "jane@example.com" | ["uuid1", "uuid2"] | null
}
```

### 4.2 New helper: `get_user_managed_contract_ids()`

Returns the set of non-internal contracts where the current authenticated user is listed as `team_manager` or `account_manager`. Match is on `users.email` OR `users.full_name` (since `contracts.team_manager` / `account_manager` are free-text columns today).

```sql
CREATE FUNCTION public.get_user_managed_contract_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT c.contract_id
  FROM contracts c
  JOIN users u ON u.auth_id = auth.uid()
  WHERE c.engagement_type IS DISTINCT FROM 'internal'
    AND (
      c.team_manager     = u.email
      OR c.account_manager = u.email
      OR c.team_manager     = u.full_name
      OR c.account_manager = u.full_name
    );
$$;
```

> **Backend note:** Manager fields are free text. If matches feel flaky in production, we should consider migrating `contracts.team_manager` / `account_manager` to FK references on `users.user_id`. Out of scope for v1.

### 4.3 New retrieval RPC: `match_knowledge_multi(...)`

Multi-contract version of the existing `match_knowledge(...)`. Takes `uuid[]` instead of single `uuid`.

```sql
match_knowledge_multi(
  query_embedding   text,           -- 1536-dim vector as text
  match_contract_ids uuid[],        -- server-resolved allowed set
  match_count        int  DEFAULT 20,
  match_threshold    float DEFAULT 0.7
) RETURNS TABLE(chunk_id, contract_id, source_type, source_id, title, content, chunk_index, metadata, similarity)
```

Uses HNSW with `ef_search = 100` and a 30s statement timeout, same as the single-contract version.

---

## 5. New Endpoint

### `POST /api/pulse/chat`

**Auth:** Standard JWT (Owner / Admin / Team Member).
**Response:** SSE stream — same wire format as the existing Compass chat endpoints.

### Request body

```ts
{
  conversation_id?: string;      // omit on first message; backend creates one
  message: string;
  filter?: {                     // optional client-side narrowing
    type: 'all' | 'priority' | 'account_manager' | 'team_manager' | 'contract_ids';
    value?: string | string[];
  };
}
```

### Server flow

1. **Resolve `allowed_contract_ids`:**
   - Owner/Admin → `SELECT contract_id FROM contracts WHERE engagement_type != 'internal'`
   - Team Member → `SELECT * FROM get_user_managed_contract_ids()`
2. **Apply `filter`** (intersection only — never expand):
   - `priority` → AND `contracts.priority = $value`
   - `account_manager` → AND `contracts.account_manager = $value` (Owner/Admin only — reject for TM)
   - `team_manager` → AND `contracts.team_manager = $value` (Owner/Admin only — reject for TM)
   - `contract_ids` → AND `contract_id = ANY($value)` ∩ allowed
3. **Persist conversation** (insert into `compass_chat_conversations` with `scope='portfolio'`, `contract_id=NULL`, `contract_filter=$filter`) on first message.
4. **Run tool-calling loop** with the toolset below. Pass `allowed_contract_ids` as a closure to every tool — never let the model invent IDs.
5. **Stream tokens** via SSE; persist final assistant message into `compass_chat_messages`.

---

## 6. Tool-Calling Toolset

The model picks which tools to call. Structured tools should run *before* RAG when the question implies them.

| Tool | Purpose | Source |
|------|---------|--------|
| `list_contracts(filters)` | List contracts. Args: `priority?`, `account_manager?`, `team_manager?`, `status?`, `account?`. Always intersected with `allowed_contract_ids`. | `contracts` |
| `get_recent_meetings(contract_ids, days)` | Title, date, sentiment JSONB, participants. | `compass_meetings` |
| `get_action_items(contract_ids, days, status?)` | Pulled from `compass_notes.action_items` JSONB. | `compass_notes` |
| `get_recent_notes(contract_ids, days)` | Published notes only (`status='published'`). | `compass_notes` |
| `get_recent_deliverables(contract_ids, days, status?)` | Title, type, status, due/delivered dates. | `compass_deliverables` |
| `get_points_summary(contract_ids)` | Burden, balance, delivery rate. | RPC `get_contract_points_summary` |
| `get_financials(contract_ids, months)` | Invoices, totals, churn signals. | `pulse_invoices` |
| `get_tech_spend(contract_ids)` | Monthly internal/client costs. | `contract_technologies` |
| `search_knowledge(query, contract_ids)` | Vector search across allowed contracts. | RPC `match_knowledge_multi` |

### Tool-call hardening

- Every tool MUST receive `allowed_contract_ids` from the closure and clamp any model-supplied `contract_ids` to that set.
- Reject and re-prompt the model if it tries to widen scope.
- Cap `match_knowledge_multi.match_count` at `min(50, 5 * len(contract_ids))` — keeps cost/latency bounded for large portfolios.

### Cost & latency notes

- For "digest" prompts, run structured tools first; only fall back to vector search for open-ended/qualitative questions.
- Stream **tool-progress events** via SSE (e.g. `event: tool, data: {"name":"get_recent_meetings","contracts":12}`) so the UI can show "Looking at 12 contracts… checking recent meetings…" while the model thinks.
- Consider parallelizing independent tool calls (e.g. `list_contracts` + `get_points_summary`).

### System prompt direction

Should establish:
- The user is a leader/manager at a marketing agency.
- The model has access to N contracts (insert count) and should prefer structured tools for digest-style asks.
- Sentiment lives in `compass_meetings.sentiment` JSONB — query it directly, don't summarize transcripts.
- Action items live in `compass_notes.action_items` JSONB — same.
- Always cite which contracts each fact came from (use `external_id · contract_name`).
- Never reveal data about contracts the user doesn't have access to (defense-in-depth — backend already filters).

---

## 7. Phasing

**Phase 1 — MVP (this scope):**
- Migration ✅ (done)
- Endpoint + permission resolution
- Tools: `list_contracts`, `get_recent_meetings`, `get_action_items`, `search_knowledge`
- Frontend shell behind feature flag for Owner/Admin

**Phase 2 — Operational depth:**
- Add: `get_recent_deliverables`, `get_points_summary`, `get_financials`, `get_tech_spend`, `get_recent_notes`
- Open access to Team Members
- Filter chips in UI

**Phase 3 — Polish:**
- Saved/scheduled digests ("email me the Tier 1 digest every Monday")
- Export conversation to PDF/markdown
- Optional: replace free-text manager fields with FK to `users`

---

## 8. Open Questions for Backend Team

1. **Embedding model:** Existing `match_knowledge` assumes 1536-dim vectors (OpenAI `text-embedding-3-small` or similar). Confirm we're using the same model for query embeddings in `/api/pulse/chat` to avoid vector-space mismatch.
2. **LLM choice:** The Compass chats currently use which model? For portfolio chat with tool-calling we'll want a model strong at multi-step reasoning — recommend `openai/gpt-5` or `google/gemini-2.5-pro` via Lovable AI Gateway for v1, with fallback to `gpt-5-mini` if cost is a concern.
3. **Token budget:** Multi-contract tool results can balloon. Recommend per-tool result caps (e.g. max 50 meetings, max 100 action items) and a synthesis step before the final answer if the context grows past ~80% of the model's window.
4. **Tool-progress events:** Are we OK adding a new SSE event type, or should we encode progress as inline assistant text?
5. **Manager fields:** `contracts.team_manager` and `account_manager` are free-text. Match by email OR full_name works for now but is fragile. Track for Phase 3 cleanup.

---

## 9. Frontend Contract (for reference)

The frontend will:
1. Call `POST /api/pulse/chat` with `{ message, conversation_id?, filter? }`.
2. Render SSE stream into the existing `ChatPage` component (markdown rendering already in place).
3. Persist `conversation_id` returned in the first SSE event.
4. Show filter chips above the input; selected filter is sent on every request and stored on the conversation server-side.
5. Display tool-progress events (if implemented) as ephemeral status text under the latest assistant bubble.

---

## 10. Testing checklist

- [ ] Owner can query all non-internal contracts.
- [ ] Admin same as Owner.
- [ ] Team Member only sees their managed contracts. Confirm via SQL: `SELECT * FROM get_user_managed_contract_ids()` while impersonating.
- [ ] Team Member is **rejected** if they pass `filter.type='account_manager'` or `'team_manager'` (Owner/Admin only).
- [ ] Client role gets 403.
- [ ] Model-supplied `contract_ids` outside the allowed set are silently dropped, not honored.
- [ ] Conversation persistence: portfolio chats appear in chat history sidebar; reopening restores the saved `contract_filter`.
- [ ] Vector search returns results from multiple contracts in a single answer.
- [ ] Sentiment / action item questions hit structured JSONB tools, not RAG.

---

**End of spec.**
