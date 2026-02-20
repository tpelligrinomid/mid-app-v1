# Content Ops — Prompts Page (Lovable Frontend Build Prompt)

## Overview

Add a **"Prompts"** page to the Content Ops section in Compass. This is where strategists configure **prompt sequences** — multi-step AI generation pipelines tied to each content type. Each sequence is an ordered list of prompt steps (e.g., draft → review → enrich) that the AI executes sequentially when generating content.

The backend API is fully built and deployed.

---

## Navigation

Add **"Prompts"** as a new nav item under Content Ops in the Compass sidebar, alongside the existing Ideas, Assets, and Config items:

```
CONTENT OPS
  Ideas
  Assets
  Prompts    ← NEW
  Config
```

---

## Backend API

**Base URL:** `https://mid-app-v1.onrender.com`

**Auth:** All requests require the Supabase JWT:
```typescript
const response = await fetch('https://mid-app-v1.onrender.com/api/compass/content/prompt-sequences...', {
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json'
  }
});
```

---

## Prompts List View

The main Prompts page shows all prompt sequences for the selected contract, **grouped by content type**.

### API

**List sequences:** `GET /api/compass/content/prompt-sequences?contract_id={id}`

Optional query param: `content_type_slug` to filter to a single content type.

**Response:**
```json
{
  "sequences": [
    {
      "sequence_id": "uuid",
      "contract_id": "uuid",
      "content_type_slug": "blog_post",
      "name": "Standard Blog Post",
      "description": "Two-step pipeline: draft a comprehensive blog post, then review and polish for quality.",
      "steps": [
        {
          "step_order": 1,
          "name": "draft",
          "system_prompt": "You are an expert content writer...",
          "user_prompt": "Write a comprehensive blog post...",
          "output_key": "draft"
        },
        {
          "step_order": 2,
          "name": "review",
          "system_prompt": "You are a senior content editor...",
          "user_prompt": "Review and improve this blog post draft:\n\n{{step:draft}}...",
          "output_key": "final"
        }
      ],
      "variables": [
        {"name": "topic", "label": "Topic", "type": "text", "required": true},
        {"name": "angle", "label": "Angle", "type": "text", "required": true},
        {"name": "audience", "label": "Target Audience", "type": "text", "required": true}
      ],
      "is_default": true,
      "is_active": true,
      "sort_order": 1,
      "created_at": "2026-02-20T...",
      "updated_at": "2026-02-20T..."
    }
  ]
}
```

### Display

Group sequences by `content_type_slug`. Each group shows as an expandable section:

```
Blog Post (2 sequences)
  ⭐ Standard Blog Post — 2 steps (draft → review)     [Edit] [Duplicate] [Delete]
     Thought Leadership  — 2 steps (draft → review)     [Edit] [Duplicate] [Delete]

Newsletter (1 sequence)
  ⭐ Standard Newsletter — 2 steps (draft → review)     [Edit] [Duplicate] [Delete]

Case Study (1 sequence)
  ⭐ Standard Case Study — 2 steps (draft → review)     [Edit] [Duplicate] [Delete]

Social Media (1 sequence)
  ⭐ Social Post — 1 step (generate)                     [Edit] [Duplicate] [Delete]

Video Script (1 sequence)
  ⭐ Standard Video Script — 2 steps (draft → review)   [Edit] [Duplicate] [Delete]
```

**Each sequence card/row shows:**
- **Name** (prominent)
- **Default badge** (star icon) if `is_default` is true
- **Step count** and step names as a pipeline visualization: `draft → review` or `generate`
- **Description** (truncated, show full on hover or expand)
- **Actions:** Edit, Duplicate, Delete

**"+ New Sequence" button** at the top of each content type group.

### Content Type Labels

Map `content_type_slug` to display names using the content types from the config API:
`GET /api/compass/content/types?contract_id={id}`

Match `content_type_slug` on the sequence to the `slug` field on content types to get the display `name`.

---

## Sequence Detail / Editor

When clicking **Edit** on a sequence (or **+ New Sequence**), show a full-page or modal editor.

### API

**Get single:** `GET /api/compass/content/prompt-sequences/{sequence_id}`

**Create:** `POST /api/compass/content/prompt-sequences`

**Update:** `PUT /api/compass/content/prompt-sequences/{sequence_id}`

### Editor Layout

#### Header Section

- **Name** (text input, required)
- **Content Type** (dropdown, populated from `/api/compass/content/types?contract_id={id}`, required) — maps to `content_type_slug`
- **Description** (textarea, optional)
- **Set as Default** toggle (boolean) — when enabled, this becomes the default sequence for this content type

#### Variables Section

A list of template variables available across all steps. These are the inputs the strategist fills in when generating content.

Each variable row:
- **Name** (slug format, e.g. `topic`) — used in prompts as `{{topic}}`
- **Label** (display name, e.g. "Topic") — shown to strategist in the generation form
- **Type** (always "text" for now)
- **Required** (checkbox)

Add/remove variable rows dynamically. Show a hint: "Use `{{variable_name}}` in your prompts to reference these variables."

#### Steps Section

The core of the editor — an ordered list of prompt step cards. Each card represents one AI generation step.

**Step Card:**
```
┌─ Step 1: draft ────────────────────────────────────────────────────┐
│                                                                      │
│  Step Name: [draft]          Output Key: [draft]                    │
│                                                                      │
│  System Prompt:                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ You are an expert content writer for {{company_name}}, a        ││
│  │ {{industry}} company. Brand voice: {{brand_voice}}...           ││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  User Prompt:                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ Write a comprehensive blog post.                                 ││
│  │                                                                  ││
│  │ Topic: {{topic}}                                                 ││
│  │ Angle: {{angle}}                                                 ││
│  │ Target Audience: {{audience}}                                    ││
│  │ ...                                                              ││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  [↑ Move Up] [↓ Move Down] [Delete Step]                            │
└──────────────────────────────────────────────────────────────────────┘
```

**Step fields:**
- **Step Name** (text, e.g. "draft", "review", "enrich") — descriptive label
- **Output Key** (text, e.g. "draft", "final") — the identifier for this step's output. Must be unique across steps. Other steps reference it as `{{step:output_key}}`
- **System Prompt** (textarea/code editor, monospace font) — the system message for this step
- **User Prompt** (textarea/code editor, monospace font) — the user message. Can include `{{variables}}` and `{{step:output_key}}` references

**Step actions:**
- **Move Up / Move Down** — reorder steps (updates `step_order`)
- **Delete Step** — remove a step (confirm first)
- **+ Add Step** button at the bottom of the steps list

**Prompt helpers:**
- Highlight `{{variable}}` and `{{step:key}}` references in the prompt text with a distinct color
- Show a sidebar or tooltip listing available variables: "Available: {{topic}}, {{angle}}, {{audience}}, {{company_name}}, {{industry}}, {{brand_voice}}"
- For steps after the first, also show available step references: "Previous step outputs: {{step:draft}}"

#### Save / Cancel

- **Save** button — calls POST (create) or PUT (update) with the full sequence data
- **Cancel** — return to list view without saving

### Create Request Body

```json
{
  "contract_id": "uuid",
  "content_type_slug": "blog_post",
  "name": "My Custom Blog Sequence",
  "description": "Custom 3-step pipeline",
  "steps": [
    {
      "step_order": 1,
      "name": "draft",
      "system_prompt": "...",
      "user_prompt": "...",
      "output_key": "draft"
    },
    {
      "step_order": 2,
      "name": "review",
      "system_prompt": "...",
      "user_prompt": "Review: {{step:draft}}...",
      "output_key": "final"
    }
  ],
  "variables": [
    {"name": "topic", "label": "Topic", "type": "text", "required": true}
  ],
  "is_default": false
}
```

### Update Request Body

Same shape, send only changed fields. But `steps` and `variables` are always sent as complete arrays (not partial updates).

---

## Duplicate Sequence

**API:** `POST /api/compass/content/prompt-sequences/{sequence_id}/duplicate`

**Request body:**
```json
{
  "contract_id": "uuid",
  "name": "Standard Blog Post (Custom)"
}
```

**Response:**
```json
{
  "sequence": {
    "sequence_id": "new-uuid",
    "name": "Standard Blog Post (Custom)",
    "...all other fields copied from source..."
  }
}
```

When clicking **Duplicate**, show a small dialog to optionally rename, then create the copy. Navigate to the new sequence's editor.

This is especially useful for:
- Copying a global default to customize for a specific contract
- Creating variations of an existing sequence

---

## Delete Sequence

**API:** `DELETE /api/compass/content/prompt-sequences/{sequence_id}`

Soft delete (sets `is_active` to false). Confirm before deleting: "This will deactivate this prompt sequence. It won't be available for content generation."

Returns 204 No Content.

---

## Validation Rules

### Sequences
- `name`: required, text
- `content_type_slug`: required, must match an existing content type slug
- `steps`: required, must have at least 1 step
- Each step must have: `name`, `system_prompt`, `user_prompt`, `output_key`, `step_order`
- `output_key` values must be unique across steps in the same sequence

### Variables
- `name`: required (slug format, no spaces)
- `label`: required (display name)
- `type`: "text" (for now)
- `required`: boolean

---

## User Roles

- **admin / team_member** — full access: view, create, edit, delete, duplicate prompt sequences
- **client** — no access to the Prompts page (hide the nav item for client users)

---

## Error Handling

Standard error responses:
```json
{ "error": "Error message" }
{ "error": "Validation failed", "details": ["Step 1: output_key is required", "Duplicate output_key values: draft"] }
```

- **400** — validation error
- **404** — sequence not found
- **500** — server error

---

## Design Notes

- The Prompts page should feel like a **prompt engineering workspace** — clean, focused on the text
- Use monospace font for system_prompt and user_prompt textareas (like a code editor)
- The step pipeline visualization (`draft → review → enrich`) should be clear and visual — consider using connected cards or a flow-like layout
- Variable references (`{{topic}}`) and step references (`{{step:draft}}`) should be visually highlighted in the prompt text
- Keep the step cards spacious — strategists will be reading and editing long prompts
- Follow the same visual patterns as the existing Config page (tabs, cards, buttons)
- The "Set as Default" toggle should be prominent — it determines which sequence is auto-selected when generating content
