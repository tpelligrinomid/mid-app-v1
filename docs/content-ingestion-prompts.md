# Content Ingestion — Lovable + Master Marketer Prompts

Two prompts for implementing blog URL ingestion: (1) Lovable frontend for the ingestion page, (2) Master Marketer for the blog scrape endpoint.

---

# PROMPT 1: Lovable Frontend — Content Ingestion Page

## Overview

Add an **"Ingestion"** page to the Content Ops section in Compass. This is where strategists import content into the content library — either a single piece of content (manual form) or a bulk upload of blog URLs via CSV. It lives under Content Ops alongside existing Ideas, Assets, Prompts, and Config pages.

The backend API is fully built and deployed.

---

## Navigation

Add **"Ingestion"** as a new nav item under Content Ops in the Compass sidebar:

```
CONTENT OPS
  Ideas
  Assets
  Ingestion   ← NEW
  Prompts
  Config
```

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

## Page Layout

The Ingestion page has two tabs:

1. **Single Import** — manually add one content piece
2. **Bulk Import** — upload a CSV of blog URLs

---

## Tab 1: Single Import

A form for manually adding a single content asset. This is a streamlined version of the existing "New Asset" form, focused on importing existing published content (not creating drafts).

### Form Fields

- **Title** (required, text input)
- **URL** (optional, URL input — the original published URL)
- **Content Body** (optional, large textarea / markdown editor — paste in the content)
- **Content Type** (optional, dropdown — populated from `GET /api/compass/content/types?contract_id={id}`)
- **Category** (optional, dropdown — populated from `GET /api/compass/content/categories?contract_id={id}`)
- **Published Date** (optional, date picker)
- **Tags** (optional, tag input — freeform text chips)

### Submit Behavior

**API:** `POST /api/compass/content/assets`

**Request body:**
```json
{
  "contract_id": "uuid",
  "title": "10 Ways AI is Changing B2B Marketing",
  "external_url": "https://blog.example.com/ai-trends",
  "content_body": "# 10 Ways AI is Changing...\n\nMarkdown content here...",
  "content_type_id": "uuid",
  "category_id": "uuid",
  "status": "published",
  "published_date": "2025-11-15",
  "tags": ["ai", "b2b"]
}
```

**Note:** Status defaults to `"published"` for imports (this is existing content, not drafts). When status is `published` and the asset has `content_body`, the backend automatically:
1. Runs AI categorization (fills content type + category if not provided)
2. Embeds content into the knowledge base

After successful creation, show a success toast with the asset title and a link to view it in the Assets page.

---

## Tab 2: Bulk Import

Upload a CSV of blog URLs to scrape, import, and auto-categorize in bulk.

### Step 1: Upload CSV

Show a file upload area (drag-and-drop or click to browse). Accept `.csv` files only.

**CSV format:** One column of URLs, with optional header. Examples:

```
url
https://blog.example.com/post-1
https://blog.example.com/post-2
https://blog.example.com/post-3
```

or just:

```
https://blog.example.com/post-1
https://blog.example.com/post-2
https://blog.example.com/post-3
```

**Client-side parsing:** Parse the CSV in the browser. Extract all URLs (detect any column that contains URLs, or use the first column). Deduplicate. Validate that each value is a valid HTTP/HTTPS URL.

After parsing, show a preview:
- Total URLs found
- List of URLs (scrollable, max height ~300px)
- Any invalid rows highlighted in red with reason
- A count of duplicates removed

**Limit:** Maximum 100 URLs per batch. If the CSV has more, show a warning and only use the first 100.

### Step 2: Submit Batch

**Button:** "Import {N} URLs" (primary, prominent)

**API:** `POST /api/compass/content/assets/bulk-ingest`

**Request body:**
```json
{
  "contract_id": "uuid",
  "urls": [
    "https://blog.example.com/post-1",
    "https://blog.example.com/post-2",
    "https://blog.example.com/post-3"
  ]
}
```

**Response (202 Accepted):**
```json
{
  "batch_id": "uuid",
  "total": 3,
  "submitted": 3,
  "skipped_duplicates": []
}
```

If `skipped_duplicates` is non-empty, show an info message: "X URLs were skipped because they already exist in the content library."

After submission, transition to the progress view (Step 3).

### Step 3: Progress Tracking

After submitting a batch, show a live progress view. Poll the batch status endpoint every 5 seconds.

**API:** `GET /api/compass/content/assets/bulk-ingest/{batch_id}`

**Response:**
```json
{
  "batch": {
    "batch_id": "uuid",
    "contract_id": "uuid",
    "total": 3,
    "completed": 2,
    "failed": 0,
    "status": "in_progress",
    "created_at": "2026-02-22T...",
    "completed_at": null
  },
  "items": [
    {
      "item_id": "uuid",
      "url": "https://blog.example.com/post-1",
      "status": "categorized",
      "asset_id": "uuid",
      "error": null
    },
    {
      "item_id": "uuid",
      "url": "https://blog.example.com/post-2",
      "status": "asset_created",
      "asset_id": "uuid",
      "error": null
    },
    {
      "item_id": "uuid",
      "url": "https://blog.example.com/post-3",
      "status": "submitted",
      "asset_id": null,
      "error": null
    }
  ]
}
```

#### Progress UI

**Overall progress bar** at the top:
- Shows `completed + failed` / `total`
- Color: green portion = completed, red portion = failed, gray = remaining
- Text: "2 of 3 processed" or "3 of 3 complete"

**Item status list** below the progress bar. Each row shows:
- **URL** (truncated if long, full URL on hover)
- **Status badge** with these states and colors:
  - `submitted` — gray — "Queued" — scraping hasn't started yet
  - `scraped` — blue — "Scraped" — content extracted, creating asset
  - `asset_created` — yellow — "Imported" — asset created, AI categorizing
  - `categorized` — green — "Complete" — fully processed
  - `failed` — red — "Failed" — show error message on hover or expansion
- **Asset link** — if `asset_id` is set, show a small link icon that navigates to the asset detail view

**Batch status states:**
- `in_progress` — still processing, keep polling
- `completed` — all done, stop polling, show success message
- `completed_with_errors` — all done but some failed, stop polling, show warning

When the batch reaches a terminal state (`completed` or `completed_with_errors`):
- Stop polling
- Show a summary: "Import complete: {completed} imported, {failed} failed"
- Show a "View in Content Library" button that navigates to the Assets page
- Show a "Import More" button to reset back to Step 1

### Batch History

Below the upload area (on initial load before any active batch), show a list of recent batches for this contract. This lets users check on previously submitted batches.

**Data source:** Use the same batch status endpoint. To list recent batches, we'll use the items from the most recent poll. For now, just show the active/most recent batch. Future enhancement: add a list endpoint.

---

## User Roles

- **admin / team_member** — full access to single import and bulk import
- **client** — no access to the Ingestion page (hide nav item for clients)

---

## Error Handling

Standard API error responses:
```json
{ "error": "Error message" }
```

- **400** — validation error (invalid URLs, too many URLs, missing contract_id)
- **403** — access denied
- **404** — batch not found
- **500** — server error

Show validation errors inline. For submission failures, show a toast with the error message and keep the form state so the user can retry.

---

## Design Notes

- Follow existing Compass module patterns for layout consistency
- The bulk import flow should feel like a wizard: Upload → Preview → Progress
- The progress view should auto-update without requiring manual refresh
- Failed items should have clear, actionable error messages (not raw stack traces)
- Use the same status badge color system as the Assets page where applicable
- The CSV upload area should support drag-and-drop and look inviting (dashed border, upload icon, "Drop your CSV here or click to browse")
- Keep the single import form simple — it's a quick way to add one piece of content, not a full content editor

---
---

# PROMPT 2: Master Marketer — Blog Scrape Endpoint

## Overview

Add a new async endpoint to Master Marketer: `POST /api/intake/blog-scrape`. This endpoint receives a blog URL, scrapes the HTML, extracts the content as clean markdown, pulls metadata (title, author, published date, description), and calls back to the MiD backend when done.

This follows the existing Master Marketer job pattern: POST → 202 → Trigger.dev task → webhook callback.

---

## New Endpoint

| Endpoint | Task ID | Priority | Complexity |
|---|---|---|---|
| `POST /api/intake/blog-scrape` | `scrape-blog-url` | High | Simple (fetch + parse, no Claude) |

---

## Shared Changes

### `src/lib/task-callback.ts`

The callback payload for blog scrapes uses a different shape than deliverable generation. The task callback function needs to handle the blog scrape output format:

- The callback `metadata` will contain `batch_id`, `item_id`, and `contract_id` (instead of `deliverable_id`)
- The `output` will be the `BlogScrapeOutput` shape (not `full_document_markdown`)

The simplest approach: the Trigger task itself calls the `callback_url` directly with the blog-scrape-specific payload shape, bypassing the generic `deliverTaskResult` function. This avoids modifying the shared callback code.

### `src/routes/intake.routes.ts`

Add the route handler:

```typescript
import { blogScrapeHandler } from './handlers/blog-scrape.js';

router.post('/blog-scrape', blogScrapeHandler);
```

---

## Input Schema

### `src/types/blog-scrape-input.ts`

```typescript
import { z } from 'zod';

export const BlogScrapeInputSchema = z.object({
  url: z.string().url(),
  callback_url: z.string().url().optional(),
  metadata: z.object({
    batch_id: z.string().uuid(),
    item_id: z.string().uuid(),
    contract_id: z.string().uuid(),
  }),
});

export type BlogScrapeInput = z.infer<typeof BlogScrapeInputSchema>;
```

---

## Output Type

### `src/types/blog-scrape-output.ts`

```typescript
export interface BlogScrapeOutput {
  url: string;
  title: string;
  content_markdown: string;
  published_date?: string;    // ISO date string, extracted from HTML
  author?: string;            // extracted from byline or meta tags
  meta_description?: string;  // from <meta name="description">
  word_count?: number;        // word count of the markdown content
}
```

---

## Callback Payload

The task calls back to `callback_url` with this shape:

**On success:**
```json
{
  "job_id": "string",
  "status": "completed",
  "metadata": {
    "batch_id": "uuid",
    "item_id": "uuid",
    "contract_id": "uuid"
  },
  "output": {
    "url": "https://blog.example.com/post-1",
    "title": "10 Ways AI is Changing B2B Marketing",
    "content_markdown": "# 10 Ways AI is Changing B2B Marketing\n\nMarkdown content...",
    "published_date": "2025-11-15",
    "author": "Jane Smith",
    "meta_description": "Discover how AI is transforming...",
    "word_count": 1523
  }
}
```

**On failure:**
```json
{
  "job_id": "string",
  "status": "failed",
  "metadata": {
    "batch_id": "uuid",
    "item_id": "uuid",
    "contract_id": "uuid"
  },
  "error": "Failed to fetch URL: 404 Not Found"
}
```

The callback request includes the `x-api-key` header (same `MASTER_MARKETER_API_KEY` used for authentication), so the MiD backend can verify the callback is legitimate.

---

## Trigger Task

### `trigger/scrape-blog-url.ts`

This is the Trigger.dev task that does the actual work. **No Claude call needed** — this is pure fetch + parse.

**Steps:**

1. **Fetch the URL**
   - Use `fetch()` with a browser-like User-Agent header:
     ```
     Mozilla/5.0 (compatible; MasterMarketerBot/1.0; +https://mid.marketing)
     ```
   - Timeout: 15 seconds
   - Follow redirects (up to 5)
   - If the response is not 200 or content-type is not HTML, fail with descriptive error

2. **Parse HTML for metadata**
   - Extract from `<head>`:
     - `<title>` tag → title (fallback)
     - `<meta property="og:title">` → title (preferred)
     - `<meta name="description">` or `<meta property="og:description">` → meta_description
     - `<meta property="article:published_time">` or `<meta name="date">` → published_date
     - `<meta name="author">` or `<meta property="article:author">` → author
   - Extract from `<body>`:
     - `<h1>` → title (highest priority if it exists, likely the actual post title)
     - Look for author in common byline patterns: `.author`, `.byline`, `[rel="author"]`
     - Look for date in common patterns: `<time datetime="...">`, `.published-date`, `.post-date`

3. **Extract article content**
   - Use Mozilla's **Readability** algorithm (npm: `@mozilla/readability`) to extract the main article content, stripping navigation, sidebars, footers, ads, and boilerplate
   - If Readability fails to extract content, fall back to the full `<body>` text
   - The Readability output gives you a clean HTML fragment of just the article

4. **Convert HTML to Markdown**
   - Use **Turndown** (npm: `turndown`) to convert the clean HTML to markdown
   - Configure Turndown:
     - Heading style: ATX (`# Heading`)
     - Code block style: fenced (triple backticks)
     - Strip empty links and images with no src
   - Post-process: collapse 3+ consecutive newlines into 2, trim whitespace

5. **Count words**
   - Split markdown on whitespace, filter empty strings, count

6. **Call back**
   - POST to `callback_url` with the success/failure payload
   - Include `x-api-key` header for authentication
   - If no `callback_url` was provided, just return the output (for direct polling)

**Error handling:** If any step fails, call back with `status: "failed"` and a clear error message. Common failures:
- URL unreachable (timeout, DNS, connection refused)
- Non-HTML content type (PDF, image, etc.)
- HTTP error status (404, 403, 500)
- Readability extraction failed (empty content)
- Content too short (less than 50 words — likely not a real article)

---

## Dependencies

Two new npm packages:

```bash
npm install @mozilla/readability turndown
npm install -D @types/turndown
```

Note: `@mozilla/readability` requires a DOM parser. Use `linkedom` or `jsdom` to create a DOM from the HTML string:

```bash
npm install linkedom
```

Example usage:
```typescript
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const { document } = parseHTML(htmlString);
const article = new Readability(document).parse();
// article.content = clean HTML
// article.title = extracted title
// article.byline = extracted author
```

---

## Route Handler

### `src/routes/handlers/blog-scrape.ts`

Standard intake handler pattern:

```typescript
export async function blogScrapeHandler(req, res) {
  // 1. Validate input with BlogScrapeInputSchema
  // 2. Create job record
  // 3. Trigger the scrape-blog-url task with { url, callback_url, metadata }
  // 4. Return 202 with { jobId, triggerRunId, status: 'accepted' }
}
```

---

## Files Created (5 new)

| File | Purpose |
|---|---|
| `src/types/blog-scrape-input.ts` | Zod input schema |
| `src/types/blog-scrape-output.ts` | Output interface |
| `src/routes/handlers/blog-scrape.ts` | Route handler |
| `trigger/scrape-blog-url.ts` | Trigger.dev task |
| `src/lib/html-to-markdown.ts` | Shared utility: Readability + Turndown |

## Files Modified (1)

| File | Change |
|---|---|
| `src/routes/intake.routes.ts` | Add blog-scrape route |

---

## Implementation Order

1. Install dependencies (`@mozilla/readability`, `turndown`, `linkedom`)
2. Create `src/lib/html-to-markdown.ts` (Readability + Turndown utility)
3. Create types (input schema + output interface)
4. Create Trigger task (`trigger/scrape-blog-url.ts`)
5. Create route handler + register route
6. Test with a real blog URL

---

## Verification

1. `npx tsc --noEmit` — clean compile
2. `npm run deploy` — deploy task
3. Test: `POST /api/intake/blog-scrape` with a real blog URL
4. Verify 202 response with jobId
5. Verify callback fires with scraped content:
   - `title` extracted correctly
   - `content_markdown` is clean, readable markdown (no nav/footer/ads)
   - `published_date` extracted if available
   - `author` extracted if available
   - `meta_description` extracted
   - `word_count` is reasonable
6. Test error cases:
   - 404 URL → callback with `status: "failed"`
   - Non-HTML URL (PDF) → callback with `status: "failed"`
   - Timeout → callback with `status: "failed"`
