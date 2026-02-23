# Content Ingestion — File Upload + YouTube (Lovable Prompt)

## Overview

Update the Ingestion page to support two new content sources:

1. **File Upload** — upload PDF/DOCX/PPTX/TXT/MD files. Text is extracted automatically, asset is created, AI categorization + embeddings run.
2. **YouTube URLs** — paste a YouTube URL in the existing URL import. Transcripts are extracted automatically using the same pipeline as blog posts.

The backend API for file upload is fully built and deployed. YouTube works through the existing bulk-ingest endpoint with zero changes — Master Marketer auto-detects YouTube URLs.

---

## Change 1: Enable "From File" Toggle

The "From File" toggle in Single Import was previously built as a "coming soon" placeholder. Now wire it up to the real backend.

### Remove Coming Soon State

- Remove the disabled state from the Import Content button when "From File" is selected
- Remove the "File import is coming soon" notice
- The file upload dropzone should already exist — keep it as-is

### Updated "From File" Form Fields

When "From File" is selected, show:

- **Content Type** (REQUIRED, dropdown) — populated from `GET /api/compass/content/types?contract_id={id}`
  - **No default value** — user must explicitly select
  - Helper text: "Required — select the type of content in this file"
  - Show this field **first**, above the file upload zone
  - If no content type is selected when the user tries to submit, show a validation error
- **File Upload** — drag-and-drop zone or click to browse
  - Accepted types: `.pdf`, `.docx`, `.pptx`, `.txt`, `.md`
  - Max file size: 25 MB
  - Text: "Drop a file here or click to browse"
  - Subtext: "PDF, Word, PowerPoint, or text files (max 25 MB)"
  - After selecting a file, show the file name + size with a remove/change button
- **Category** (optional, dropdown) — populated from `GET /api/compass/content/categories?contract_id={id}`
  - Helper text: "Auto-detected by AI if left blank"
- **Title** (optional, text input)
  - Helper text: "Auto-detected from file if left blank"
  - Placeholder: filename without extension as placeholder text
- **Tags** (optional, tag input)

### Upload + Submit Flow

The file upload is a two-step process: first upload the file to Supabase Storage, then tell the backend to process it.

**Step 1: Upload to Supabase Storage**

When the user clicks "Import Content":

```typescript
import { v4 as uuidv4 } from 'uuid';

const fileId = uuidv4();
const storagePath = `${contractId}/${fileId}_${file.name}`;

const { data, error } = await supabase.storage
  .from('content-assets')
  .upload(storagePath, file, {
    cacheControl: '3600',
    upsert: false,
  });
```

Show progress: **"Uploading..."** with a spinner during this step.

**Step 2: Submit to backend for processing**

After storage upload succeeds:

```typescript
const response = await fetch(`${API_BASE}/api/compass/content/assets/file-ingest`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    contract_id: contractId,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type,
    content_type_id: selectedContentTypeId,  // REQUIRED
    category_id: selectedCategoryId || undefined,
    title: customTitle || undefined,
  }),
});
```

**Response handling:**

- **201 Created** (TXT/MD files) — text was read directly, asset is ready
  ```json
  { "asset_id": "uuid", "extraction": "direct" }
  ```
  Show: "Import complete! Content extracted and AI analysis started."

- **202 Accepted** (PDF/DOCX/PPTX files) — file submitted for text extraction
  ```json
  { "asset_id": "uuid", "extraction": "submitted", "job_id": "string" }
  ```
  Show: "File uploaded! Text extraction in progress. The asset will be updated automatically when processing completes."

- **400** — validation error (show inline)
- **500** — server error (show toast)

### Progress States

Show a progress indicator during submission:

1. **"Uploading file..."** — while uploading to Supabase Storage (show upload progress if available)
2. **"Processing..."** — while calling the backend API
3. **"Complete!"** — on 201 response (TXT/MD)
4. **"Submitted for processing"** — on 202 response (PDF/DOCX/PPTX)

After success (either 201 or 202):
- Show the asset_id with a **"View Asset"** button that navigates to the asset detail page
- Show an **"Upload Another"** button that resets the form

### MIME Type Mapping

Map file extensions to MIME types for the `mime_type` field:

| Extension | MIME Type |
|-----------|-----------|
| `.pdf` | `application/pdf` |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| `.txt` | `text/plain` |
| `.md` | `text/markdown` |

The browser's `file.type` should handle most of these. For `.md` files, browsers often report an empty type — default to `text/markdown` if the extension is `.md`.

---

## Change 2: YouTube Support in URL Import

YouTube URLs work through the **existing bulk-ingest pipeline** with zero API changes. Master Marketer auto-detects YouTube URLs and extracts transcripts instead of scraping HTML. The callback payload is identical.

### UI Updates

In the "From URL" form (both Single Import and Bulk Import):

**Update the URL input placeholder:**
- Old: `https://example.com/blog/my-post`
- New: `https://example.com/article or YouTube URL`

**Add helper text** below the URL input (or below the CSV upload area for Bulk Import):
> "Supports blog posts and YouTube videos. Transcripts are extracted automatically from YouTube."

**Update the Bulk Import CSV section** helper text:
> "One URL per line — blog posts, articles, or YouTube video URLs"

### No Other Changes Needed

- The submit button, API calls, progress tracking, and error handling all stay exactly the same
- YouTube URLs go through `POST /assets/bulk-ingest` just like blog URLs
- The progress view works identically (submitted → scraped → asset_created → categorized)
- The created asset will have the video title as its title and the transcript as content_body

---

## Design Notes

- Content Type being required for file upload (but optional for URL import) is intentional — AI can detect type from article content but not reliably from raw file text without context
- The file upload zone should give clear feedback at every stage (selected → uploading → processing → done)
- Keep the "From URL" / "From File" toggle behavior exactly as currently implemented — just enable the File path
- Don't add a separate "YouTube" tab or toggle — YouTube URLs just work in the existing URL flow
- For PDF/DOCX/PPTX, the asset will initially appear in the content library as a draft with no content_body. It will be populated automatically when processing completes (usually within 30-60 seconds). Consider showing a note about this on the 202 response.
