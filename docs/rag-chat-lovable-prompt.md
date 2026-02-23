# RAG Chat — Context-Aware Q&A (Lovable Prompt)

## Overview

Update the **Chat** feature so it appears in **two locations** in the Compass sidebar, each automatically scoped to the relevant knowledge types based on where the user is in the app:

1. **Management > Chat** — searches notes, meetings, and deliverables
2. **Content Ops > Chat** — searches only content (blog posts, podcasts, YouTube transcripts, uploaded files)

Both use the same backend endpoint (`POST /api/compass/chat`) and the same chat UI component — the only difference is the `source_types` filter sent with each request and the page header/placeholder text.

**This replaces the current single Chat page.** Remove the existing Chat nav item from the Management section and add the two new ones as described below.

---

## Backend API

**Base URL:** `https://mid-app-v1.onrender.com`

**Endpoint:** `POST /api/compass/chat`

**Auth:** Supabase JWT in Authorization header (same as all other Compass endpoints).

**Request body:**
```json
{
  "message": "What topics do we write about most?",
  "contract_id": "uuid",
  "source_types": ["content"],
  "conversation_history": [
    { "role": "user", "content": "What are our top blog posts?" },
    { "role": "assistant", "content": "Based on your content library, your top posts cover..." }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `message` | string | Yes | The user's current question |
| `contract_id` | UUID string | Yes | Which contract's content to search |
| `source_types` | string[] | No | Filter which knowledge types to search. Values: `content`, `meeting`, `note`, `deliverable`, `process`, `competitive_intel`. Omit to search all. |
| `conversation_history` | array | No | Prior messages for multi-turn context. Max 20 entries. |

**Response:** Server-Sent Events (SSE) stream — not a regular JSON response. The response is a stream of newline-delimited JSON events.

---

## SSE Response Format

The endpoint returns `Content-Type: text/event-stream`. Each event is a line starting with `data: ` followed by JSON:

### Event 1: Context (sources used)
Sources are deduplicated by `source_id` (only the highest-similarity chunk per source is included):
```
data: {"type":"context","sources":[{"title":"10 Ways AI is Changing B2B","source_type":"content","source_id":"uuid","chunk_index":0,"similarity":0.82},{"title":"Q4 Strategy Meeting","source_type":"meeting","source_id":"uuid","chunk_index":2,"similarity":0.71}]}
```

### Events 2–N: Delta (streaming text chunks)
```
data: {"type":"delta","text":"Based on"}
data: {"type":"delta","text":" your content library,"}
data: {"type":"delta","text":" you write most frequently about"}
```

### Final Event: Done
```
data: {"type":"done","usage":{"input_tokens":2847,"output_tokens":312}}
```

### Error Event (if something fails)
```
data: {"type":"error","message":"Knowledge search failed: ..."}
```

---

## Navigation — Two Chat Locations

### 1. Management > Chat

Add a **"Chat"** nav item at the bottom of the **Management** section in the sidebar (below Status Reports). Use the MessageSquare icon.

```
MANAGEMENT
  Notes
  Meetings
  Deliverables
  Status Reports
  Chat              ← here
```

**Route:** `/compass/:contractId/chat` (keep existing route)

**`source_types` sent with every request:** `["note", "meeting", "deliverable"]`

**Page header:**
- Title: "Chat"
- Subtitle: "Ask questions about your notes, meetings, and deliverables"

**Empty state:**
```
Ask anything about your notes, meetings, and deliverables

Your management documents have been analyzed and embedded.
Ask questions about discussions, decisions, deliverable details,
or patterns across your meetings and notes.

Example questions:
• "What did we decide about the Q1 campaign?"
• "Summarize our last 3 meetings"
• "What deliverables are related to SEO?"
• "What themes keep coming up in our notes?"
```

**Input placeholder:** `"Ask about your notes, meetings, and deliverables..."`

### 2. Content Ops > Chat

Add a **"Chat"** nav item to the **Content Ops** section in the sidebar (between Ingestion and Config, or at the bottom). Use the MessageSquare icon.

```
CONTENT OPS
  Dashboard
  Ideas
  Assets
  Ingestion
  Chat              ← here
  Config
```

**Route:** `/compass/:contractId/content/chat`

**`source_types` sent with every request:** `["content"]`

**Page header:**
- Title: "Chat"
- Subtitle: "Ask questions about your content library"

**Empty state:**
```
Ask anything about your content library

Your published content has been analyzed and embedded.
Ask questions about themes, topics, specific posts, or
patterns across your blog posts, podcasts, and videos.

Example questions:
• "What topics do we write about most?"
• "Summarize our recent blog posts about AI"
• "Do we have any content about email marketing?"
• "What are our most popular podcast topics?"
```

**Input placeholder:** `"Ask about your content library..."`

---

## Shared Chat Component

Both chat locations should use the **same underlying chat component** — just configured with different props:

```typescript
interface ChatPageProps {
  sourceTypes: string[];        // e.g., ["content"] or ["note", "meeting", "deliverable"]
  title: string;                // Page header title
  subtitle: string;             // Page header subtitle
  placeholder: string;          // Input placeholder text
  emptyStateHeading: string;    // Empty state title
  emptyStateDescription: string;// Empty state body text
  exampleQuestions: string[];   // Clickable example chips
}
```

The chat component handles all the streaming, message display, sources, history, etc. The two pages are just thin wrappers that pass the right config:

```typescript
// Management Chat page
<ChatPage
  sourceTypes={["note", "meeting", "deliverable"]}
  title="Chat"
  subtitle="Ask questions about your notes, meetings, and deliverables"
  placeholder="Ask about your notes, meetings, and deliverables..."
  emptyStateHeading="Ask anything about your notes, meetings, and deliverables"
  emptyStateDescription="Your management documents have been analyzed and embedded. Ask questions about discussions, decisions, deliverable details, or patterns across your meetings and notes."
  exampleQuestions={[
    "What did we decide about the Q1 campaign?",
    "Summarize our last 3 meetings",
    "What deliverables are related to SEO?",
    "What themes keep coming up in our notes?",
  ]}
/>

// Content Ops Chat page
<ChatPage
  sourceTypes={["content"]}
  title="Chat"
  subtitle="Ask questions about your content library"
  placeholder="Ask about your content library..."
  emptyStateHeading="Ask anything about your content library"
  emptyStateDescription="Your published content has been analyzed and embedded. Ask questions about themes, topics, specific posts, or patterns across your blog posts, podcasts, and videos."
  exampleQuestions={[
    "What topics do we write about most?",
    "Summarize our recent blog posts about AI",
    "Do we have any content about email marketing?",
    "What are our most popular podcast topics?",
  ]}
/>
```

### Passing source_types to the API

The `source_types` prop is always sent with the request — it is NOT optional for these pages. Do not show a source type filter UI. The scoping is automatic based on which chat the user is in.

```typescript
const response = await fetch(`${API_BASE}/api/compass/chat`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: userMessage,
    contract_id: selectedContractId,
    conversation_history: conversationHistory,
    source_types: sourceTypes,  // Always included — set by the page, not the user
  }),
});
```

---

## Chat UI Layout

Build the chat as a **full page** within the Compass layout (same area where Notes, Content, etc. render — not a slide-out panel).

### Layout Structure

```
┌─────────────────────────────────────────────────────┐
│  Compass Header / Contract Selector                 │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ Sidebar  │  ┌────────────────────────────────────┐  │
│          │  │  Chat                               │  │
│ MGMT     │  │  Ask questions about your...        │  │
│  Notes   │  │                                     │  │
│  ...     │  │  (messages area)                    │  │
│  Chat    │  │                                     │  │
│          │  │  User: What topics do we cover?     │  │
│ CONTENT  │  │                                     │  │
│  ...     │  │  Assistant: Based on your content   │  │
│  Chat    │  │  library, you write most about...   │  │
│          │  │                                     │  │
│          │  │  Sources: [Blog Post A] [Video B]   │  │
│          │  │                                     │  │
│          │  ├────────────────────────────────────┤  │
│          │  │ [Ask about your...]         [Send]  │  │
│          │  └────────────────────────────────────┘  │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

### Empty State

When the user first visits Chat (no messages yet), show a centered welcome state with the heading, description, and example questions from the page props. Show the example questions as clickable chips/buttons that populate the message input when clicked.

---

## Message Components

### User Message Bubble

- Right-aligned or full-width with a subtle user background color
- Show the message text
- Show a small timestamp (optional)

### Assistant Message Bubble

- Left-aligned or full-width with a subtle assistant background color
- **Streaming text:** As `delta` events arrive, append each text chunk to the message in real time. The text should appear to "type" itself out.
- **Markdown rendering:** The assistant response may include markdown (bold, bullets, headers). Render it properly.
- **Sources section:** After the response text, show a "Sources" section with clickable source references (see below).

### Sources Display

When the `context` event arrives (before the text starts streaming), store the sources. After the assistant message is complete, show them below the response. Sources are already deduplicated by the backend — each source_id appears only once.

```
Sources (5 matched):
┌────────────────────────────────────────────────────────┐
│ 📄 Content  │  10 Ways AI is Changing B2B       │ 82% │
│ 🤝 Meeting  │  Q4 Content Strategy Meeting      │ 71% │
│ 📄 Content  │  Email Marketing Best Practices   │ 68% │
│ 📝 Note     │  Weekly Strategy Notes - Jan 15   │ 62% │
│ 📄 Content  │  YouTube: Content Marketing Tips  │ 55% │
└────────────────────────────────────────────────────────┘
```

**Each source row must show THREE things:**
1. **Type icon + type label** — so users can immediately tell what kind of source it is
2. **Title** — the content title
3. **Similarity badge** — percentage with color

**Source type labels and icons:**

| `source_type` value | Icon | Label |
|---------------------|------|-------|
| `content` | FileText icon | Content |
| `meeting` | Users icon | Meeting |
| `note` | StickyNote icon | Note |
| `deliverable` | ClipboardList icon | Deliverable |
| `process` | Settings icon | Process |
| `competitive_intel` | Search icon | Intel |

**Important:** The type label text (e.g., "Content", "Meeting", "Note") must be visible — don't rely on icons alone. Users couldn't tell sources apart when only icons were shown.

**Similarity score:** Show as a percentage (multiply by 100, round to nearest integer). Use a subtle color indicator: green for >=75%, yellow for 50-74%.

**Clicking a source:** If possible, navigate to the corresponding item:
- `content` sources → navigate to `/compass/content/assets/{source_id}`
- `meeting` sources → navigate to `/compass/meetings/{source_id}`
- `note` sources → navigate to `/compass/notes/{source_id}`
- If navigation isn't possible (e.g., the route doesn't exist yet), just show the source as informational (no link).

---

## Streaming Implementation

### Connecting to the SSE Endpoint

Use `fetch` with manual stream reading (not `EventSource`, since this is a POST request):

```typescript
const response = await fetch(`${API_BASE}/api/compass/chat`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: userMessage,
    contract_id: selectedContractId,
    conversation_history: conversationHistory,
    source_types: sourceTypes,  // From page props — always included
  }),
});

if (!response.ok) {
  const error = await response.json();
  // Show error toast
  return;
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = JSON.parse(line.slice(6));

    switch (data.type) {
      case 'context':
        // Store sources for display after response
        setSources(data.sources);
        break;
      case 'delta':
        // Append text to current assistant message
        setStreamingText(prev => prev + data.text);
        break;
      case 'done':
        // Finalize message, store usage stats
        setIsStreaming(false);
        break;
      case 'error':
        // Show error in chat
        setError(data.message);
        setIsStreaming(false);
        break;
    }
  }
}
```

### Important: Scroll behavior

- Auto-scroll to bottom as new delta text arrives (keep the latest text visible)
- If the user has manually scrolled up to read previous messages, **stop auto-scrolling** — don't jump them back down
- Resume auto-scroll when the user scrolls back to the bottom

---

## Conversation History (Client-Side State)

Maintain conversation history in React state. Do **not** persist it to a database — it resets when the user navigates away or refreshes.

Each chat location maintains its own independent history. Navigating from Management Chat to Content Chat does not carry over messages.

```typescript
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{
    title: string;
    source_type: string;
    source_id: string;
    similarity: number;
  }>;
  timestamp: Date;
}

const [messages, setMessages] = useState<ChatMessage[]>([]);
```

When sending a new message, build `conversation_history` from the existing messages array (exclude the current message, exclude sources — just `role` and `content`):

```typescript
const history = messages.map(m => ({
  role: m.role,
  content: m.content,
}));
```

### New Conversation

Add a **"New Chat"** button (top of chat area or near the header) that clears the conversation history and resets to the empty state. Use a "+" icon or a refresh/new-chat icon.

---

## Input Area

### Message Input

- Multi-line text input (textarea) that grows with content (up to ~4 lines, then scroll)
- Placeholder text: set by page props (e.g., `"Ask about your content library..."` or `"Ask about your notes, meetings, and deliverables..."`)
- **Send button** — icon button (paper plane or arrow) to the right of the input
- **Enter to send** — pressing Enter sends the message. Shift+Enter inserts a newline.
- Disable the send button and input while a response is streaming
- Show a subtle loading indicator (pulsing dot or spinner) while streaming

### Character/Message Limits

- No hard character limit on input, but reasonable UX (the textarea shouldn't grow infinitely)
- Conversation history is capped at 20 messages by the backend. The frontend doesn't need to enforce this explicitly — just let the array grow naturally. A typical chat session won't exceed 20 messages. If it does, the backend returns a 400 error; handle it gracefully with a message like "Conversation is too long. Start a new chat to continue."

---

## Loading & Error States

### While Streaming

- Show a **typing indicator** (three animated dots) before the first `delta` event arrives (between sending the request and receiving the first text)
- Replace the typing indicator with the actual text once deltas start arriving
- The send button should show a "stop" icon while streaming (optional: allow canceling a stream by aborting the fetch)

### Errors

- If the `POST` returns a non-200 status (before streaming starts):
  - **401** — "Your session has expired. Please log in again."
  - **400** — Show the error message from the response
  - **403** — "You don't have access to this contract's content."
  - **500** — "Something went wrong. Please try again."
- If an `error` event arrives during streaming, show the error message inline in the chat as a system message (red/warning styled, not a user or assistant bubble)
- If the stream disconnects unexpectedly (network error), show "Connection lost. Please try again."

### No Results

If the assistant responds with something like "I don't have enough information" (which happens when no relevant content is found), the sources list may be empty or have low similarity scores. This is normal — just display the response as-is.

---

## User Roles

- **admin / team_member** — full access to Chat for any contract
- **client** — can use Chat for contracts they have access to (the backend enforces this via `user_contract_access`)

No role-based UI differences needed — the chat is the same experience for all roles. The backend handles access control.

---

## Design Notes

- Follow existing Compass module patterns for layout consistency (same page structure as Notes, Content, etc.)
- The chat should feel conversational and lightweight — not like a complex dashboard
- Use a clean, minimal design for message bubbles. Keep it professional (this is a B2B tool, not a consumer chat app)
- The streaming text effect should feel smooth and natural
- Sources should be informative but not overwhelming — collapsed by default with an expand toggle if there are more than 3 sources, or shown inline if 3 or fewer
- On mobile/narrow screens, the chat should take the full width (no sidebar visible — rely on the existing responsive nav pattern)
- Light/dark mode: follow the existing app theme
- Both chat pages should look identical — only the header text, placeholder, empty state, and scoping differ

---

## Optional Enhancements (Nice-to-Have)

These are not required for the initial build but would improve the experience:

1. **Copy response** — a small copy icon on assistant messages to copy the response text to clipboard
2. **Retry** — if an error occurs, show a "Retry" button that resends the last message
3. **Token usage display** — show the `usage` from the `done` event in a subtle tooltip or footer (for admin users only)
4. **Suggested follow-up questions** — after a response, show 2-3 suggested follow-up questions as clickable chips (these would be hardcoded or generated client-side based on the topic)
