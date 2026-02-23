# Master Marketer — File Extraction + YouTube Detection

Two enhancements to Master Marketer:

1. **New endpoint:** `POST /api/intake/file-extract` — extracts text from PDF/DOCX/PPTX files
2. **Enhancement:** Existing `POST /api/intake/blog-scrape` — auto-detect YouTube URLs and extract transcripts instead of scraping HTML

---

# PART 1: File Extraction Endpoint (New)

## Overview

Add `POST /api/intake/file-extract`. The MiD backend uploads files to Supabase Storage, generates a signed URL, and submits it here. This endpoint downloads the file, extracts text based on MIME type, converts to markdown, and calls back with the result.

Follows the same pattern as `blog-scrape`: POST → 202 → Trigger.dev task → webhook callback.

---

## New Endpoint

| Endpoint | Task ID | Priority | Complexity |
|---|---|---|---|
| `POST /api/intake/file-extract` | `file-extract` | High | Medium (download + parse, no Claude) |

---

## Input Schema

### `src/types/file-extract-input.ts`

```typescript
import { z } from 'zod';

export const FileExtractInputSchema = z.object({
  file_url: z.string().url(),        // Signed URL to download the file
  file_name: z.string(),              // Original filename
  mime_type: z.enum([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]),
  callback_url: z.string().url().optional(),
  metadata: z.object({
    asset_id: z.string().uuid(),
    contract_id: z.string().uuid(),
    content_type_slug: z.string().optional(),
  }),
});

export type FileExtractInput = z.infer<typeof FileExtractInputSchema>;
```

---

## Output Type

### `src/types/file-extract-output.ts`

```typescript
export interface FileExtractOutput {
  content_markdown: string;         // Extracted text as markdown
  title?: string;                   // Extracted from document metadata if available
  word_count?: number;              // Word count of extracted text
  page_count?: number;              // Page count (PDF only)
  extraction_method: string;        // 'pdf-parse' | 'mammoth' | 'pptx-parser'
}
```

---

## Callback Payload

The task calls back to `callback_url` with this shape. Include the `x-api-key` header for authentication (same `MASTER_MARKETER_API_KEY`).

**On success:**
```json
{
  "job_id": "string",
  "status": "completed",
  "metadata": {
    "asset_id": "uuid",
    "contract_id": "uuid",
    "content_type_slug": "whitepaper"
  },
  "output": {
    "content_markdown": "# Document Title\n\nExtracted content...",
    "title": "Q4 Marketing Strategy",
    "word_count": 3847,
    "page_count": 12,
    "extraction_method": "pdf-parse"
  }
}
```

**On failure:**
```json
{
  "job_id": "string",
  "status": "failed",
  "metadata": {
    "asset_id": "uuid",
    "contract_id": "uuid"
  },
  "error": "Failed to extract text from PDF: file is encrypted"
}
```

---

## Trigger Task

### `trigger/file-extract.ts`

Trigger.dev task that downloads a file and extracts text. **No Claude call needed** — pure download + parse.

**Steps:**

1. **Download file**
   - Fetch from `file_url` (signed Supabase Storage URL)
   - Timeout: 30 seconds (files can be large)
   - Validate response: must be 200, content-length should be reasonable (< 100 MB)
   - Save to a buffer/temp file

2. **Extract text based on MIME type**

   **PDF** (`application/pdf`):
   - Use `pdf-parse` package
   - Extract all text content
   - Get page count from `data.numpages`
   - Get title from PDF metadata (`data.info?.Title`) if available
   - Convert to markdown: use heading detection heuristics (large/bold text → `#` headings), preserve paragraph breaks

   ```typescript
   import pdf from 'pdf-parse';

   const dataBuffer = Buffer.from(await response.arrayBuffer());
   const data = await pdf(dataBuffer);
   // data.text = raw text
   // data.numpages = page count
   // data.info.Title = PDF title metadata
   ```

   **DOCX** (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`):
   - Use `mammoth` package to convert to HTML
   - Then use **Turndown** to convert HTML to markdown (same Turndown config as blog-scrape)
   - Mammoth preserves headings, bold, italic, lists, and tables

   ```typescript
   import mammoth from 'mammoth';
   import TurndownService from 'turndown';

   const buffer = Buffer.from(await response.arrayBuffer());
   const result = await mammoth.convertToHtml({ buffer });
   // result.value = HTML string
   // result.messages = any conversion warnings

   const turndown = new TurndownService({
     headingStyle: 'atx',
     codeBlockStyle: 'fenced',
   });
   const markdown = turndown.turndown(result.value);
   ```

   **PPTX** (`application/vnd.openxmlformats-officedocument.presentationml.presentation`):
   - Use `pptx-parser` or manually unzip and parse XML
   - Extract text from each slide
   - Format as markdown with slide separators:

   ```markdown
   # Slide 1: Title Slide

   Presentation Title
   Subtitle text

   ---

   # Slide 2: Overview

   - Bullet point 1
   - Bullet point 2
   - Bullet point 3

   Speaker notes: These are the speaker notes for this slide.

   ---
   ```

   A simpler approach if `pptx-parser` is unreliable: use `officegen` for reading, or unzip the .pptx (it's a ZIP file) and parse `ppt/slides/slide{N}.xml` files directly using a lightweight XML parser.

   Recommended approach using the raw XML:
   ```typescript
   import JSZip from 'jszip';

   const zip = await JSZip.loadAsync(buffer);
   const slides: string[] = [];

   // Iterate slide files in order
   let slideNum = 1;
   while (zip.files[`ppt/slides/slide${slideNum}.xml`]) {
     const xml = await zip.files[`ppt/slides/slide${slideNum}.xml`].async('text');
     // Parse XML, extract text from <a:t> elements
     // Group by <a:p> for paragraphs
     slides.push(extractedText);
     slideNum++;
   }
   ```

3. **Post-process markdown**
   - Collapse 3+ consecutive newlines into 2
   - Trim leading/trailing whitespace
   - Count words: `markdown.split(/\s+/).filter(Boolean).length`

4. **Call back**
   - POST to `callback_url` with success/failure payload
   - Include `x-api-key` header for authentication
   - If no `callback_url`, return output directly

**Error handling:** Call back with `status: "failed"` and a descriptive error:
- File download failed (timeout, 403 expired URL, 404)
- File is encrypted/password-protected
- File is corrupted or not a valid PDF/DOCX/PPTX
- Extraction produced no text (empty document)
- Content too short (less than 10 words)

---

## Route Handler

### `src/routes/handlers/file-extract.ts`

Standard intake handler pattern (same as blog-scrape):

```typescript
export async function fileExtractHandler(req, res) {
  // 1. Validate input with FileExtractInputSchema
  // 2. Create job record
  // 3. Trigger the file-extract task with { file_url, file_name, mime_type, callback_url, metadata }
  // 4. Return 202 with { jobId, triggerRunId, status: 'accepted' }
}
```

### `src/routes/intake.routes.ts`

Add the route:
```typescript
import { fileExtractHandler } from './handlers/file-extract.js';

router.post('/file-extract', fileExtractHandler);
```

---

## Dependencies

```bash
npm install pdf-parse mammoth jszip
npm install -D @types/pdf-parse
```

Note: `turndown` should already be installed from the blog-scrape feature. If not:
```bash
npm install turndown
npm install -D @types/turndown
```

---

## Files Created (4 new)

| File | Purpose |
|---|---|
| `src/types/file-extract-input.ts` | Zod input schema |
| `src/types/file-extract-output.ts` | Output interface |
| `src/routes/handlers/file-extract.ts` | Route handler |
| `trigger/file-extract.ts` | Trigger.dev task |

## Files Modified (1)

| File | Change |
|---|---|
| `src/routes/intake.routes.ts` | Add file-extract route |

---

---

# PART 2: YouTube Detection (Enhancement to Existing)

## Overview

Enhance the existing `blog-scrape` Trigger task to auto-detect YouTube URLs. When a YouTube URL is submitted, extract the transcript and metadata instead of scraping HTML. The callback payload shape is **identical** to blog scrape — the MiD backend doesn't need to know or care that it was a YouTube video.

This means YouTube URLs "just work" when pasted into the existing bulk-ingest flow.

---

## Changes to Existing Task

### `trigger/scrape-blog-url.ts`

At the **top** of the task, before the HTML fetch, add YouTube detection:

```typescript
// YouTube URL detection
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

const youtubeMatch = input.url.match(YOUTUBE_REGEX);
if (youtubeMatch) {
  const videoId = youtubeMatch[1];
  return await extractYouTubeContent(videoId, input);
}

// ... existing HTML scrape logic continues unchanged ...
```

### New Helper: `src/lib/youtube-extract.ts`

```typescript
import { YoutubeTranscript } from 'youtube-transcript';

interface YouTubeResult {
  url: string;
  title: string;
  content_markdown: string;
  published_date?: string;
  author?: string;
  meta_description?: string;
  word_count?: number;
  // Extra fields (included in same payload — backend ignores what it doesn't use)
  video_id?: string;
  duration_seconds?: number;
  source_type?: string;
}

export async function extractYouTubeContent(
  videoId: string,
  input: { url: string; metadata: Record<string, unknown> }
): Promise<YouTubeResult> {
  // 1. Fetch transcript
  const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);

  if (!transcriptItems || transcriptItems.length === 0) {
    throw new Error('No transcript available for this video. The video may not have captions enabled.');
  }

  // 2. Fetch video metadata via oEmbed (no API key needed)
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  let title = `YouTube Video ${videoId}`;
  let author: string | undefined;

  try {
    const oembedResponse = await fetch(oembedUrl);
    if (oembedResponse.ok) {
      const oembed = await oembedResponse.json();
      title = oembed.title || title;
      author = oembed.author_name;
    }
  } catch {
    // oEmbed is best-effort — transcript is the important part
  }

  // 3. Format transcript as markdown
  let markdown = `# ${title}\n\n`;
  markdown += `*Video transcript — [Watch on YouTube](https://www.youtube.com/watch?v=${videoId})*\n\n`;
  markdown += '---\n\n';

  // Group transcript into paragraphs (every ~60 seconds)
  let currentParagraph: string[] = [];
  let lastTimestamp = 0;
  const PARAGRAPH_INTERVAL = 60; // seconds

  for (const item of transcriptItems) {
    const seconds = Math.floor(item.offset / 1000);

    // Start a new paragraph every ~60 seconds
    if (seconds - lastTimestamp >= PARAGRAPH_INTERVAL && currentParagraph.length > 0) {
      const mins = Math.floor(lastTimestamp / 60);
      const secs = lastTimestamp % 60;
      const timestamp = `${mins}:${secs.toString().padStart(2, '0')}`;
      markdown += `**[${timestamp}]** ${currentParagraph.join(' ')}\n\n`;
      currentParagraph = [];
      lastTimestamp = seconds;
    }

    if (currentParagraph.length === 0) {
      lastTimestamp = seconds;
    }

    currentParagraph.push(item.text.trim());
  }

  // Flush remaining paragraph
  if (currentParagraph.length > 0) {
    const mins = Math.floor(lastTimestamp / 60);
    const secs = lastTimestamp % 60;
    const timestamp = `${mins}:${secs.toString().padStart(2, '0')}`;
    markdown += `**[${timestamp}]** ${currentParagraph.join(' ')}\n\n`;
  }

  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  // Calculate total duration from last transcript item
  const lastItem = transcriptItems[transcriptItems.length - 1];
  const durationSeconds = lastItem
    ? Math.ceil((lastItem.offset + (lastItem.duration || 0)) / 1000)
    : undefined;

  return {
    url: input.url,
    title,
    content_markdown: markdown.trim(),
    author,
    meta_description: `Transcript of "${title}" on YouTube`,
    word_count: wordCount,
    video_id: videoId,
    duration_seconds: durationSeconds,
    source_type: 'youtube',
  };
}
```

### Callback Behavior

The YouTube result uses **the exact same callback payload shape** as blog scrape:

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
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "title": "Video Title Here",
    "content_markdown": "# Video Title Here\n\n*Video transcript...*\n\n---\n\n**[0:00]** First paragraph...\n\n**[1:00]** Second paragraph...",
    "author": "Channel Name",
    "meta_description": "Transcript of \"Video Title Here\" on YouTube",
    "word_count": 2341,
    "video_id": "dQw4w9WgXcQ",
    "duration_seconds": 212,
    "source_type": "youtube"
  }
}
```

The `video_id`, `duration_seconds`, and `source_type` fields are **extra** — the MiD backend ignores fields it doesn't expect, but they'll be preserved in the asset metadata for future use.

---

## Dependencies

```bash
npm install youtube-transcript
```

No types package needed — `youtube-transcript` ships its own TypeScript types.

---

## Files Created (1 new)

| File | Purpose |
|---|---|
| `src/lib/youtube-extract.ts` | YouTube transcript extraction + formatting |

## Files Modified (1)

| File | Change |
|---|---|
| `trigger/scrape-blog-url.ts` | Add YouTube URL detection at top of task, route to `extractYouTubeContent` |

---

## Error Handling

YouTube-specific failures to handle:
- **No transcript available** — video has no captions. Error: "No transcript available for this video. The video may not have captions enabled."
- **Video is private/deleted** — transcript fetch will fail. Error: "Could not access video — it may be private or deleted."
- **Invalid video ID** — regex matched but ID is wrong. Error: "Invalid YouTube video."
- **Transcript in wrong language** — `youtube-transcript` fetches the default language. This is acceptable for now.

All errors use the same `status: "failed"` callback shape as blog scrape failures.

---

---

# Implementation Order

1. **File extraction** (Part 1) — new endpoint, independent of everything else
   - Install deps: `pdf-parse`, `mammoth`, `jszip`
   - Create types, handler, Trigger task
   - Register route
   - Test with real files
2. **YouTube detection** (Part 2) — enhancement to existing task
   - Install dep: `youtube-transcript`
   - Create `youtube-extract.ts`
   - Add detection to `scrape-blog-url.ts`
   - Test with YouTube URLs through the existing blog-scrape endpoint
3. Deploy both

---

# Verification

### File Extraction
1. Submit a PDF URL → 202 → task extracts text → callback with markdown + page count
2. Submit a DOCX URL → 202 → task extracts via mammoth → callback with markdown
3. Submit a PPTX URL → 202 → task extracts slide text → callback with markdown
4. Encrypted PDF → callback with `status: "failed"` and descriptive error
5. Expired signed URL → callback with `status: "failed"` (download failure)

### YouTube
1. Submit `https://www.youtube.com/watch?v=VIDEO_ID` via blog-scrape → auto-detects YouTube → extracts transcript → callback with identical payload shape
2. Submit `https://youtu.be/VIDEO_ID` (short URL) → same behavior
3. Submit `https://www.youtube.com/shorts/VIDEO_ID` → same behavior
4. Submit a video with no captions → callback with `status: "failed"`
5. Submit a normal blog URL → existing HTML scrape behavior unchanged
