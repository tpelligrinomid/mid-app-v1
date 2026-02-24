# Brand Voice Editor + Content Generation — Lovable Frontend Build Prompt

## Overview

Two new features for the Content Ops section in Compass:

1. **Brand Voice Editor** — A page where strategists define each client's brand voice (tone, personality, writing guidelines, example excerpts). This gets automatically injected into every AI content generation.

2. **Content Generation on Assets** — A "Generate" button on content assets that runs a prompt sequence through AI, streams the output in real time, and saves the result to the asset.

Both backend APIs are fully built and deployed.

---

## Part 1: Brand Voice Editor

### Navigation

Add **"Brand Voice"** as a new nav item under Content Ops in the Compass sidebar:

```
CONTENT OPS
  Ideas
  Assets
  Brand Voice   <-- NEW
  Prompts
  Config
```

**Route:** `/compass/:contractId/brand-voice`

Use a Mic or Megaphone icon to represent brand voice.

---

### Backend API

**Base URL:** `https://mid-app-v1.onrender.com`

**Auth:** All requests require the Supabase JWT:
```typescript
const response = await fetch('https://mid-app-v1.onrender.com/api/compass/brand-voice...', {
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json'
  }
});
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/compass/brand-voice?contract_id={id}` | Get brand voice for a contract |
| PUT | `/api/compass/brand-voice` | Create or update (upsert) brand voice |

### GET Response

```json
{
  "brand_voice": {
    "brand_voice_id": "uuid",
    "contract_id": "uuid",
    "voice_summary": "Professional but approachable. Data-driven with practical, actionable focus. We simplify complex marketing concepts without dumbing them down.",
    "tone": ["authoritative", "approachable", "practical"],
    "personality": ["innovative", "pragmatic", "empathetic"],
    "writing_style": "Write in second person ('you'). Keep sentences under 25 words. Lead with insights, not definitions. Use concrete examples over abstract concepts.",
    "do_guidelines": [
      "Use data and statistics to support claims",
      "Include practical takeaways the reader can act on today",
      "Reference real examples and case studies",
      "Write clear, scannable headings"
    ],
    "dont_guidelines": [
      "Don't use jargon without explaining it",
      "Don't be overly salesy or promotional",
      "Don't use passive voice excessively",
      "Don't start paragraphs with 'In today's rapidly evolving landscape'"
    ],
    "example_excerpts": [
      {
        "text": "ABM isn't a silver bullet — it's a precision tool. Here's how to know if your team is ready to wield it.",
        "source": "ABM Readiness Checklist Blog Post",
        "why": "Shows our direct, no-nonsense tone while being helpful"
      },
      {
        "text": "We analyzed 47 B2B landing pages and found that 80% made the same conversion mistake.",
        "source": "Landing Page Audit",
        "why": "Demonstrates our data-driven approach with specific numbers"
      }
    ],
    "target_audience": "B2B marketing directors and VPs at mid-market companies ($10M-$500M revenue)",
    "industry_context": "B2B SaaS, professional services, manufacturing. Audience is sophisticated but time-pressed. They want strategic insights, not beginner content.",
    "is_active": true,
    "created_at": "2026-02-24T...",
    "updated_at": "2026-02-24T..."
  }
}
```

If no brand voice exists yet, `brand_voice` is `null`.

### PUT Request (Upsert)

```json
{
  "contract_id": "uuid",
  "voice_summary": "Professional but approachable...",
  "tone": ["authoritative", "approachable", "practical"],
  "personality": ["innovative", "pragmatic", "empathetic"],
  "writing_style": "Write in second person...",
  "do_guidelines": ["Use data to support claims", "..."],
  "dont_guidelines": ["Don't use jargon without explaining it", "..."],
  "example_excerpts": [
    {
      "text": "Example quote from published content",
      "source": "Blog Post Title",
      "why": "Why this is a good example of our voice"
    }
  ],
  "target_audience": "B2B marketing directors...",
  "industry_context": "B2B SaaS..."
}
```

---

### Page Layout

The Brand Voice page is a single-page editor. When no brand voice exists, show a setup state. When one exists, show the form pre-filled with current values.

#### Empty State (No Brand Voice)

```
Brand Voice
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ┌────────────────────────────────────────────────┐
  │                                                │
  │  📢  No brand voice defined yet               │
  │                                                │
  │  Define your client's brand voice to ensure    │
  │  all AI-generated content matches their tone,  │
  │  style, and personality.                       │
  │                                                │
  │  The brand voice is automatically applied      │
  │  when generating content for this client.      │
  │                                                │
  │  [Define Brand Voice]                          │
  │                                                │
  └────────────────────────────────────────────────┘
```

#### Editor Layout

Use a clean, card-based form layout. Group related fields into sections.

```
Brand Voice — {Contract Name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─ Voice Summary ──────────────────────────────────┐
│                                                   │
│  Describe this client's brand voice in 1-3        │
│  sentences. This is the core definition.          │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │ Professional but approachable. Data-driven │   │
│  │ with practical, actionable focus...        │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
└───────────────────────────────────────────────────┘

┌─ Tone & Personality ─────────────────────────────┐
│                                                   │
│  Tone Tags:                                       │
│  [authoritative] [approachable] [practical] [+]   │
│                                                   │
│  Personality Tags:                                │
│  [innovative] [pragmatic] [empathetic] [+]        │
│                                                   │
└───────────────────────────────────────────────────┘

┌─ Writing Style ──────────────────────────────────┐
│                                                   │
│  Detailed writing style guidelines:               │
│  ┌───────────────────────────────────────────┐   │
│  │ Write in second person ('you'). Keep       │   │
│  │ sentences under 25 words. Lead with        │   │
│  │ insights, not definitions...               │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
└───────────────────────────────────────────────────┘

┌─ Guidelines ─────────────────────────────────────┐
│                                                   │
│  DO ✓                                             │
│  ┌───────────────────────────────────── [+] ┐    │
│  │ • Use data and statistics to support claims│    │
│  │ • Include practical takeaways              │    │
│  │ • Reference real examples and case studies │    │
│  │ • Write clear, scannable headings          │    │
│  └───────────────────────────────────────────┘    │
│                                                   │
│  DON'T ✗                                          │
│  ┌───────────────────────────────────── [+] ┐    │
│  │ • Don't use jargon without explaining it   │    │
│  │ • Don't be overly salesy or promotional    │    │
│  │ • Don't use passive voice excessively      │    │
│  └───────────────────────────────────────────┘    │
│                                                   │
└───────────────────────────────────────────────────┘

┌─ Example Excerpts ───────────────────────────────┐
│                                                   │
│  Paste examples of content that nails the voice:  │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ "ABM isn't a silver bullet — it's a         │ │
│  │  precision tool."                            │ │
│  │  Source: ABM Readiness Checklist Blog Post   │ │
│  │  Why: Shows our direct, no-nonsense tone     │ │
│  │                              [Edit] [Delete] │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  [+ Add Example]                                  │
│                                                   │
└───────────────────────────────────────────────────┘

┌─ Audience Context ───────────────────────────────┐
│                                                   │
│  Target Audience:                                 │
│  ┌───────────────────────────────────────────┐   │
│  │ B2B marketing directors and VPs at mid-    │   │
│  │ market companies ($10M-$500M revenue)      │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  Industry Context:                                │
│  ┌───────────────────────────────────────────┐   │
│  │ B2B SaaS, professional services. Audience  │   │
│  │ is sophisticated but time-pressed.         │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
└───────────────────────────────────────────────────┘

                                    [Save Brand Voice]
```

### Field Details

**Voice Summary**
- Textarea, required
- 1-3 sentences
- Placeholder: "Describe how this client's content should sound (e.g., 'Professional but approachable, data-driven with practical focus')"

**Tone Tags**
- Tag/chip input — type to add, click X to remove
- Common suggestions as autocomplete: authoritative, approachable, technical, casual, formal, conversational, data-driven, playful, serious, empathetic, bold, measured, warm, clinical
- Stored as a string array

**Personality Tags**
- Same tag/chip input pattern
- Common suggestions: innovative, pragmatic, empathetic, expert, educator, challenger, supportive, visionary, analytical, creative

**Writing Style**
- Textarea, optional
- Multi-line guidelines about sentence structure, vocabulary, perspective
- Placeholder: "Describe writing conventions (e.g., 'Write in second person. Keep paragraphs under 4 sentences. Use active voice.')"

**Do Guidelines**
- Editable list — each item is a text input with a delete button
- [+ Add Guideline] button to add a new empty row
- Placeholder for new row: "What should the AI do when writing for this client?"

**Don't Guidelines**
- Same editable list pattern
- Placeholder for new row: "What should the AI avoid when writing for this client?"

**Example Excerpts**
- Expandable cards — each has three fields:
  - **Text** (textarea, required): The actual excerpt
  - **Source** (text input, optional): Where this excerpt comes from (blog title, etc.)
  - **Why** (text input, optional): Why this is a good example of the brand voice
- [+ Add Example] button to add a new blank excerpt card
- Each card has Edit/Delete actions
- Limit to 10 examples max
- Stored as a JSONB array

**Target Audience**
- Textarea, optional
- Who the content is for
- Placeholder: "Who is the primary audience for this client's content?"

**Industry Context**
- Textarea, optional
- Industry-specific notes about language, topics, sensitivities
- Placeholder: "Any industry-specific language or context the AI should know about?"

### Save Behavior

- **Save Brand Voice** button at the bottom
- Calls `PUT /api/compass/brand-voice` with all fields
- On success: toast "Brand voice saved" with a green checkmark
- On error: toast with error message
- The button should show a loading spinner while saving
- Track dirty state — only enable the Save button when the user has made changes

### User Roles

- **admin / team_member** — full access: view, edit, save
- **client** — no access to Brand Voice (hide the nav item for client users)

---

## Part 2: Content Generation on Assets

### Where It Lives

This is **not** a new page — it adds new capabilities to the **existing Assets list and detail views**.

### Assets List Page — New Action Buttons

On the Assets list page, replace the current `+ New Asset` button with **two buttons**:

```
Assets                                    [✨ Generate] [+ New Asset]
Content assets and production
```

- **Generate** (primary, with Sparkles/AI icon) — Creates a new asset and opens the AI generation flow. This is the main action for creating AI-powered content.
- **New Asset** (secondary/outline) — Creates a new blank asset for manual writing (existing behavior).

The "Generate" button should be visually more prominent than "New Asset" since AI generation is the primary workflow.

**Generate button flow on list page:**
1. User clicks "Generate"
2. Opens a modal/drawer with:
   - **Title** (required text input) — the topic/title for the new content
   - **Content Type** (required dropdown) — select from configured content types (Blog Post, Newsletter, etc.)
   - **Category** (optional dropdown) — select from configured categories
   - Sequence selector, additional instructions, and library context toggle (same as detail page — see below)
3. On submit: creates the asset via the existing `POST /api/compass/content/assets` endpoint, then immediately kicks off generation via `POST /api/compass/content/assets/:id/generate`
4. Navigates to the asset detail page showing the streaming output

### Asset Detail Page — Generate Button

On the **existing Asset detail view** (`/compass/:contractId/content/assets/:id`), add a **"Generate"** button in the header alongside existing action buttons:

```
← Back    Blog Post Title    [draft]     [✨ Generate] [Edit] [Delete]
```

- Only visible for **admin / team_member** roles
- Use a Sparkles/Wand icon on the button
- This regenerates content for an existing asset (useful for re-generating or generating for manually-created assets)

### Generation Panel

When the user clicks "Generate", open a **slide-out drawer** (from the right) or a **modal** with the generation interface.

```
┌─ Generate Content ────────────────────── [×] ─┐
│                                                │
│  Sequence: Standard Blog Post (default)   [▼]  │
│                                                │
│  Additional Instructions (optional):           │
│  ┌──────────────────────────────────────────┐  │
│  │ Focus on budget-friendly approaches.     │  │
│  │ Keep it under 1200 words.                │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ☑ Use content library for context             │
│                                                │
│              [Generate Content]                │
│                                                │
└────────────────────────────────────────────────┘
```

### Pre-Generation Form Fields

**Sequence Selector** (optional)
- Dropdown showing available prompt sequences for this asset's content type
- Pre-selects the default sequence
- Fetched from `GET /api/compass/content/prompt-sequences?contract_id={id}&content_type_slug={slug}`
- Show sequence name + step count (e.g., "Standard Blog Post (2 steps)")
- If no sequences exist for this content type, show a message: "No prompt sequences found for this content type. Create one in the Prompts page."

**Additional Instructions** (optional)
- Textarea
- Placeholder: "Any specific instructions for this generation (e.g., 'Keep under 800 words', 'Focus on the budget angle', 'Include a comparison table')"
- This is the main user input — everything else is auto-resolved

**Use Content Library for Context** (checkbox)
- Default: checked
- When checked, the backend searches the RAG knowledge base for relevant content and injects it as context
- When unchecked, generates without reference content (maps to `auto_retrieve: false`)

### Generation API

**Endpoint:** `POST /api/compass/content/assets/:id/generate`

**Request:**
```json
{
  "sequence_id": "uuid (optional — uses default if omitted)",
  "additional_instructions": "Keep under 800 words (optional)",
  "auto_retrieve": true
}
```

**Response:** Server-Sent Events (SSE) stream

### SSE Event Types

The response is streamed as SSE events. Each event is a JSON object on a `data:` line.

```
data: {"type":"context","sources":[{"title":"ABM Blog Post","source_type":"content","source_id":"uuid","similarity":0.82}]}

data: {"type":"step_start","step":"draft","step_number":1,"total_steps":2}

data: {"type":"delta","text":"# ABM Strategies"}

data: {"type":"delta","text":" for B2B SaaS"}

data: {"type":"delta","text":"\n\nAccount-based marketing..."}

data: {"type":"step_complete","step":"draft","tokens":{"input":8500,"output":1200}}

data: {"type":"step_start","step":"review","step_number":2,"total_steps":2}

data: {"type":"delta","text":"# ABM Strategies for B2B SaaS (Revised)"}

data: {"type":"delta","text":"\n\nIn the competitive world..."}

data: {"type":"step_complete","step":"review","tokens":{"input":10200,"output":1400}}

data: {"type":"done","total_tokens":{"input":18700,"output":2600}}
```

**Error event:**
```
data: {"type":"error","message":"Asset has no content type assigned. Please set a content type before generating."}
```

### Streaming UI

Once the user clicks "Generate Content", replace the pre-generation form with the streaming output view:

```
┌─ Generate Content ────────────────────── [×] ─┐
│                                                │
│  Sources used:                                 │
│  📄 ABM Readiness Checklist (0.82)             │
│  📄 Q4 Content Strategy (0.76)                 │
│  📄 B2B Landing Page Audit (0.71)              │
│                                                │
│  ─────────────────────────────────────────     │
│                                                │
│  Step 1 of 2: draft ✓  (8,500 in / 1,200 out) │
│  Step 2 of 2: review ⏳                        │
│                                                │
│  ─────────────────────────────────────────     │
│                                                │
│  # ABM Strategies for B2B SaaS                 │
│                                                │
│  In the competitive world of B2B SaaS,         │
│  account-based marketing has emerged as the    │
│  go-to strategy for companies looking to       │
│  maximize their marketing ROI...               │
│  █ (cursor blinking as content streams in)     │
│                                                │
│                                                │
└────────────────────────────────────────────────┘
```

### Streaming UI Details

**Sources Panel (top)**
- Shown when the `context` event arrives
- List the sources with their titles and similarity scores
- Collapsible — start expanded, user can collapse to see more content
- If no sources (auto_retrieve was false or nothing found), don't show this section

**Step Progress (middle)**
- Show each step's status:
  - Pending: gray text, no icon
  - In progress: spinning icon, active text
  - Complete: green checkmark, token counts in muted text
- Update when `step_start` and `step_complete` events arrive

**Content Output (main area)**
- Render the streaming text as markdown (use your existing markdown renderer)
- Accumulate text from `delta` events
- Show a blinking cursor at the end while streaming
- When a new step starts, **replace** the content area with the new step's output (the final step is what gets saved, so show the most recent step)
- Alternatively: show only the final step output, with a small "Show draft" toggle to peek at intermediate outputs
- Scroll to follow the streaming content

**Done State**
- When the `done` event arrives, stop the blinking cursor
- Show total token usage in muted text at the bottom
- Show two buttons:
  - **"Use This Content"** (primary) — closes the drawer, refreshes the asset detail to show the new content
  - **"Regenerate"** (secondary) — goes back to the pre-generation form to try again

**Error State**
- When an `error` event arrives, show the error message prominently
- Show a "Try Again" button that goes back to the pre-generation form

### SSE Connection Code

```typescript
const response = await fetch(`${API_URL}/api/compass/content/assets/${assetId}/generate`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    sequence_id: selectedSequenceId || undefined,
    additional_instructions: instructions || undefined,
    auto_retrieve: useLibraryContext,
  }),
});

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
        setSources(data.sources);
        break;
      case 'step_start':
        setCurrentStep(data);
        setStreamedText(''); // Reset for new step
        break;
      case 'delta':
        setStreamedText(prev => prev + data.text);
        break;
      case 'step_complete':
        updateStepStatus(data.step, 'complete', data.tokens);
        break;
      case 'done':
        setGenerationComplete(true);
        setTotalTokens(data.total_tokens);
        break;
      case 'error':
        setError(data.message);
        break;
    }
  }
}
```

### After Generation

When generation completes and the user clicks "Use This Content":
1. Close the generation drawer
2. Refresh the asset data from the API (the content_body is already saved by the backend)
3. The asset detail view should now show the generated content
4. The asset's `metadata.generation` field will contain info about the generation (sequence used, timestamp, tokens)

### Edge Cases

- **No content type on asset**: The backend returns an error: "Asset has no content type assigned." Show this in the error state with guidance to set the content type first. (This can't happen from the list page Generate flow since content type is required.)
- **No prompt sequences for type**: The backend returns an error: "No prompt sequence found for content type 'X'." Show this with a link to the Prompts page.
- **No brand voice**: The backend falls back to "Professional, clear, and engaging tone" — no error, just a note in the sources section: "No brand voice defined — using default tone."
- **Asset already has content**: Generation overwrites `content_body`. Show a confirmation if the asset already has content: "This will replace the existing content. Continue?" (Only applies when generating from the detail page.)
- **Client disconnect**: If the user closes the drawer mid-generation, the backend continues but the frontend stops listening. The content still gets saved to the asset.
- **List page Generate flow**: If asset creation succeeds but generation fails, the asset still exists (user can retry from the detail page). Don't delete the asset on generation failure.

---

## Design Notes

- **Brand Voice page** should feel like a **document editor** — clean, spacious, focused on writing
- The tag/chip inputs for tone and personality should have a nice typeahead/autocomplete feel
- The Do/Don't guidelines should be easy to reorder (drag handles) and add/remove
- Example excerpts should feel like quote cards — slightly indented or styled differently from regular form fields
- **Generation drawer** should feel responsive and alive — the streaming text should visibly flow in, not appear in chunks
- Use a semi-transparent overlay or slide-out drawer so the user can still see the asset behind it
- The step progress indicators should feel like a pipeline/progress tracker
- Follow existing Compass module patterns for layout consistency
- All toast notifications should be non-blocking (bottom-right corner)

---

## User Roles

- **admin / team_member** — full access to both brand voice and content generation
- **client** — no access to Brand Voice page, no Generate button on assets (hide for client users)

---

## Error Handling

| Status | Context | Message |
|--------|---------|---------|
| 400 | PUT brand voice without voice_summary | "Voice summary is required" |
| 401 | No auth token | Redirect to login |
| 404 | Asset not found | "Asset not found" |
| 503 | ANTHROPIC_API_KEY missing | "AI generation is not configured" |
| SSE error | Various | Show the error message from the event in the generation panel |
