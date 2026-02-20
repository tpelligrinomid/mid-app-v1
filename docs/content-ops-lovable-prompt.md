# Content Ops Module — Lovable Frontend Build Prompt

## Overview

Build the **Content Ops** module for Compass. This is a content lifecycle manager: ideas, assets, content library, and configuration — all scoped per contract. It lives within the existing Compass section of the app.

The backend API is fully built and deployed. All endpoints are at `/api/compass/content/*` and require the user's Supabase JWT in the Authorization header.

---

## Backend API

**Base URL:** `https://mid-app-v1.onrender.com`

**Auth:** All requests require the Supabase JWT:
```typescript
const response = await fetch('https://mid-app-v1.onrender.com/api/compass/content/...', {
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json'
  }
});
```

---

## Navigation

Add a **"Content"** navigation item to the Compass sidebar (alongside existing Notes, Meetings, Deliverables, etc.). When a user selects a contract and navigates to Content, they see:

1. **Ideas** — the idea pipeline (default view)
2. **Assets** — the content library / asset list
3. **Config** — content types, categories, custom attributes (settings/gear icon)

Use tabs or sub-navigation within the Content section.

---

## Page 1: Ideas Pipeline

The ideas view shows all content ideas for the selected contract, with a Kanban-style or list view grouped by status.

### Statuses
- `idea` — new, unreviewed
- `approved` — ready to promote to asset
- `rejected` — declined

### List/Filter View

**API:** `GET /api/compass/content/ideas?contract_id={id}`

Optional query params: `status`, `category_id`, `content_type_id`, `limit`, `offset`

**Response:**
```json
{
  "ideas": [
    {
      "idea_id": "uuid",
      "contract_id": "uuid",
      "title": "10 Ways AI is Changing B2B Marketing",
      "description": "Blog post covering AI trends...",
      "content_type_id": "uuid",
      "category_id": "uuid",
      "source": "manual",
      "status": "idea",
      "priority": 3,
      "target_date": "2026-03-15",
      "custom_attributes": { "target_persona": "cmo" },
      "tags": ["ai", "trends"],
      "created_by": "uuid",
      "created_at": "2026-02-19T...",
      "updated_at": "2026-02-19T..."
    }
  ]
}
```

### Idea Card / Row Display
- **Title** (prominent)
- **Status** badge (color-coded: idea=blue, approved=green, rejected=red)
- **Content type** label (e.g., "Blog Post", "Newsletter")
- **Category** label with color dot
- **Priority** (1-5 stars or number)
- **Target date** if set
- **Source** indicator (manual vs ai_generated — show a small AI icon for ai_generated)
- **Tags** as pills

### Create Idea

**Trigger:** "New Idea" button at the top of the ideas view.

**API:** `POST /api/compass/content/ideas`

**Form fields:**
- Title (required, text input)
- Description (optional, textarea or rich text)
- Content Type (optional, dropdown — populated from `/api/compass/content/types?contract_id={id}`)
- Category (optional, dropdown — populated from `/api/compass/content/categories?contract_id={id}`)
- Priority (optional, 1-5 selector)
- Target Date (optional, date picker)
- Tags (optional, tag input — freeform text chips)

**Request body:**
```json
{
  "contract_id": "uuid",
  "title": "Blog post about AI trends",
  "description": "Cover the top 10 ways...",
  "content_type_id": "uuid",
  "category_id": "uuid",
  "priority": 3,
  "target_date": "2026-03-15",
  "tags": ["ai", "trends"]
}
```

### Edit Idea

**API:** `PUT /api/compass/content/ideas/{idea_id}`

Same form as create, pre-populated. Send only changed fields.

### Change Idea Status

**API:** `PUT /api/compass/content/ideas/{idea_id}`

Quick actions (buttons or dropdown):
- **Approve** → `{ "status": "approved" }`
- **Reject** → `{ "status": "rejected" }`
- **Back to Idea** → `{ "status": "idea" }`

### Promote Idea to Asset

Only available when idea status is `approved`. Show a prominent "Promote to Asset" button.

**API:** `POST /api/compass/content/ideas/{idea_id}/promote`

No request body needed. Returns the new asset:
```json
{
  "asset": { "asset_id": "uuid", "title": "...", "status": "draft", ... },
  "idea_id": "uuid"
}
```

After promotion, navigate to the new asset detail view or show a success message with a link.

### Delete Idea

**API:** `DELETE /api/compass/content/ideas/{idea_id}`

Confirm before deleting. Returns 204 No Content.

---

## Page 2: Content Library (Assets)

The assets view is the content library — all content items for the contract, filterable by status and type.

### Statuses
- `draft` — initial state, being created
- `in_production` — actively being written/produced
- `review` — ready for review
- `approved` — reviewed and approved
- `published` — live/final (this triggers embedding into the knowledge base)

### List/Filter View

**API:** `GET /api/compass/content/assets?contract_id={id}`

Optional query params: `status`, `content_type_id`, `category_id`, `limit`, `offset`

**Response:**
```json
{
  "assets": [
    {
      "asset_id": "uuid",
      "contract_id": "uuid",
      "idea_id": "uuid or null",
      "title": "10 Ways AI is Changing B2B Marketing",
      "description": "Comprehensive blog post...",
      "content_type_id": "uuid",
      "category_id": "uuid",
      "status": "draft",
      "file_name": "ai-trends.pdf",
      "mime_type": "application/pdf",
      "external_url": null,
      "clickup_task_id": null,
      "tags": ["ai", "trends"],
      "custom_attributes": {},
      "published_date": null,
      "metadata": {},
      "created_by": "uuid",
      "created_at": "2026-02-19T...",
      "updated_at": "2026-02-19T..."
    }
  ]
}
```

### Asset Card / Row Display
- **Title** (prominent)
- **Status** badge (draft=gray, in_production=yellow, review=orange, approved=blue, published=green)
- **Content type** label
- **Category** with color dot
- **Source indicator** — show "From idea" link if `idea_id` is set
- **File info** — if `file_name` is set, show file icon + name
- **External URL** — if set, show link icon
- **Published date** if set
- **Tags** as pills

### Asset Detail View

**API:** `GET /api/compass/content/assets/{asset_id}`

Returns full asset including `content_body` and `content_structured` (not included in list view for performance).

The detail view should show:
- All fields from list view
- **Content body** — rendered markdown if `content_body` is set
- **File attachment** — download/preview link if `file_path` is set
- **External URL** — clickable link
- **ClickUp link** — if `clickup_task_id` is set, link to ClickUp
- **Custom attributes** — render based on attribute definitions
- **Metadata** — show ingestion status if available (e.g., "Embedded: 12 chunks" from `metadata.chunks_created`)
- **Status workflow** — buttons to move through the pipeline

### Create Asset

**Trigger:** "New Asset" button at the top of the assets view.

**API:** `POST /api/compass/content/assets`

**Form fields:**
- Title (required, text input)
- Description (optional, textarea)
- Content Type (optional, dropdown from types endpoint)
- Category (optional, dropdown from categories endpoint)
- Content Body (optional, markdown editor / textarea)
- Status (optional, dropdown — defaults to "draft")
- External URL (optional, URL input — for published blog links, YouTube links, etc.)
- File upload fields (optional — file_path, file_name, file_size_bytes, mime_type)
- Published Date (optional, date picker)
- Tags (optional, tag input)

**Request body:**
```json
{
  "contract_id": "uuid",
  "title": "AI Trends Blog Post",
  "description": "Long-form blog about AI in B2B",
  "content_type_id": "uuid",
  "category_id": "uuid",
  "content_body": "# 10 Ways AI is Changing B2B Marketing\n\n...",
  "status": "draft",
  "external_url": "https://blog.example.com/ai-trends",
  "tags": ["ai", "trends"]
}
```

### Edit Asset

**API:** `PUT /api/compass/content/assets/{asset_id}`

Same form as create, pre-populated. Send only changed fields.

### Status Transitions

Show contextual action buttons based on current status:
- `draft` → "Start Production" (`in_production`), or jump to any status
- `in_production` → "Send for Review" (`review`)
- `review` → "Approve" (`approved`), "Back to Production" (`in_production`)
- `approved` → "Publish" (`published`)
- `published` → show a "Published" badge with the published date

**Important:** When status changes to `published`, the backend automatically creates embeddings for the knowledge base. Show a brief indicator like "Added to content library" after publishing.

**API:** `PUT /api/compass/content/assets/{asset_id}`
```json
{ "status": "published" }
```

### Delete Asset

**API:** `DELETE /api/compass/content/assets/{asset_id}`

Confirm before deleting ("This will also remove the content from the knowledge base"). Returns 204.

---

## Page 3: Configuration

A settings page for the content module, accessible via a gear/settings icon. Three tabs:

### Tab 1: Content Types

What kinds of content this contract produces.

**API:** `GET /api/compass/content/types?contract_id={id}`

Shows a list of content types. Each has: name, slug, description, icon, sort_order, is_active.

**Note:** Types with `contract_id: null` are global defaults. Types with the contract's ID are contract-specific. Display both, but indicate which are defaults vs custom.

**Actions:**
- Add type: `POST /api/compass/content/types` with `{ contract_id, name, slug, description }`
- Edit type: `PUT /api/compass/content/types/{type_id}`
- Remove type: `DELETE /api/compass/content/types/{type_id}` (soft delete — sets is_active=false)

### Tab 2: Categories

Organizational grouping / taxonomy for content.

**API:** `GET /api/compass/content/categories?contract_id={id}`

Same pattern as types. Each has: name, slug, description, color, sort_order.

**Actions:**
- Add: `POST /api/compass/content/categories` with `{ contract_id, name, slug, description, color }`
- Edit: `PUT /api/compass/content/categories/{category_id}`
- Remove: `DELETE /api/compass/content/categories/{category_id}`

Include a color picker for the `color` field (hex value).

### Tab 3: Custom Attributes

Per-contract custom metadata fields that appear on ideas and/or assets.

**API:** `GET /api/compass/content/attributes?contract_id={id}`

Each attribute has:
- **name** — display label ("Target Persona")
- **slug** — internal key ("target_persona")
- **field_type** — `single_select`, `multi_select`, `boolean`, `text`
- **options** — for select types: `[{"value": "cmo", "label": "CMO"}, ...]`
- **is_required** — whether the field is required
- **applies_to** — `ideas`, `assets`, or `both`

**Actions:**
- Add: `POST /api/compass/content/attributes`
- Edit: `PUT /api/compass/content/attributes/{attribute_id}`
- Delete: `DELETE /api/compass/content/attributes/{attribute_id}` (hard delete)

When adding/editing a select-type attribute, show a dynamic options builder (add/remove option rows with value + label).

**Rendering custom attributes on ideas/assets:** When creating or editing an idea/asset, fetch the attribute definitions and render the appropriate form fields. Store values in the `custom_attributes` JSON field:
```json
{
  "target_persona": "cmo",
  "funnel_stage": ["top", "middle"],
  "gated": true
}
```

### Config Initialization

When a contract has no content types yet (first visit to the content module), show a setup screen:

> "Initialize content configuration for this contract? This will set up default content types and categories that you can customize."

**Button:** "Initialize"

**API:** `POST /api/compass/content/config/initialize?contract_id={id}`

**Response:**
```json
{
  "message": "Content config initialized",
  "types_created": 10,
  "categories_created": 6
}
```

After initialization, reload and show the normal config view.

To detect whether initialization is needed, call `GET /api/compass/content/config?contract_id={id}` and check if `types` array is empty.

---

## Validation Rules

### Ideas
- `status`: must be `idea`, `approved`, or `rejected`
- `source`: must be `manual` or `ai_generated`
- `priority`: 1-5 integer or null
- `target_date`: YYYY-MM-DD format

### Assets
- `status`: must be `draft`, `in_production`, `review`, `approved`, or `published`
- `published_date`: YYYY-MM-DD format

### Attribute Definitions
- `field_type`: must be `single_select`, `multi_select`, `boolean`, or `text`
- `applies_to`: must be `ideas`, `assets`, or `both`

---

## User Roles

- **admin / team_member** — full access: create, edit, delete, promote, publish, configure
- **client** — read-only: can view ideas and assets for their contract, cannot create/edit/delete anything

The backend handles role enforcement. The frontend should:
- Hide create/edit/delete/promote/publish buttons for client users
- Show ideas and assets in read-only mode for clients

---

## Error Handling

The API returns standard error responses:
```json
{ "error": "Error message" }
{ "error": "Validation failed", "details": ["Invalid status: xyz. Valid values: idea, approved, rejected"] }
```

- **400** — validation error (show details to user)
- **403** — access denied (redirect or show permission message)
- **404** — not found
- **409** — conflict (e.g., duplicate slug, idea already promoted)
- **500** — server error

---

## Design Notes

- Follow existing Compass module patterns (Notes, Deliverables) for layout consistency
- Status badges should use consistent colors across ideas and assets
- The content library (assets) should feel like a proper media library — not just a data table
- Markdown content should be rendered nicely in the detail view (use a markdown renderer)
- The promote flow (idea → asset) should feel smooth — clear visual connection between the idea and its resulting asset
