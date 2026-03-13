# Content Ingestion — Single Import Source Toggle (Lovable Prompt)

## Overview

Update the Single Import tab to support two content sources: **URL** (scrape from the web) and **File** (upload a document). These are two ways to provide content for the same import action. Use a toggle at the top of the form to switch between them.

File upload is coming soon — build the UI now but disable submission until the backend is ready.

---

## Changes to Single Import

### Add Source Toggle

At the top of the form (below the tab bar, above the first field), add a segmented control / toggle with two options:

**From URL** | **From File**

"From URL" is selected by default.

### From URL (active — current behavior)

When "From URL" is selected, show the existing form:

- **Content URL** (required) — `https://example.com/article`
- **External Link** (optional) — permanent home (Google Drive, Dropbox)
  - Helper text: "Where does this content permanently live? Leave blank to use the content URL."
- **Content Type** (optional, dropdown, defaults to Blog Post)
  - Helper text: "Auto-detected by AI if left blank"
- **Category** (optional, dropdown)
  - Helper text: "Auto-detected by AI if left blank"
- **Tags** (optional)
- **Import Content** button (enabled, calls `POST /assets/bulk-ingest`)

This is what's already built — no changes needed to this path.

### From File (new — coming soon)

When "From File" is selected, show:

- **File Upload** — drag-and-drop zone or click to browse
  - Accepted types: `.pdf`, `.docx`, `.doc`, `.pptx`, `.txt`, `.md`
  - Icon: upload/document icon
  - Text: "Drop a file here or click to browse"
  - Subtext: "PDF, Word, PowerPoint, or text files"
  - Max file size: 25 MB
  - After selecting a file, show the file name + size with a remove/change button
- **External Link** (optional) — same as URL mode
  - Helper text: "Link to the permanent version of this file (Google Drive, Dropbox, etc.)"
- **Content Type** (optional, dropdown)
  - Helper text: "Auto-detected by AI if left blank"
- **Category** (optional, dropdown)
  - Helper text: "Auto-detected by AI if left blank"
- **Tags** (optional)
- **Import Content** button — **disabled** with a visual indicator

**Coming Soon state:** Below the file upload zone (or overlaid on the submit button), show a subtle notice:

> "File import is coming soon. Use URL import for now, or check back shortly."

The file upload dropzone should still work (user can select a file and see it listed), but the Import Content button stays disabled. This shows the feature is real and almost ready, just not wired up yet.

---

## Design Notes

- The toggle should look like a segmented control (two buttons side by side, selected state highlighted) — not radio buttons or a dropdown
- Both modes share the same lower half of the form (External Link, Content Type, Category, Tags) — only the top section changes between URL input and file upload
- The transition between modes should be instant (no page reload, just swap the top field)
- Keep the form compact — the toggle + source input + shared fields should all be visible without scrolling on a standard screen
- The "Coming soon" state on file upload should feel polished, not like an error — muted text, maybe a small icon, not a big warning banner
