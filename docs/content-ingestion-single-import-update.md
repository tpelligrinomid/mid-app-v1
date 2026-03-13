# Content Ingestion — Single Import Update (Lovable Prompt)

## What Changed

The Single Import tab needs to be redesigned. The current version has a "Content Body" textarea where users paste markdown — remove that. Users don't have markdown; they have blog post URLs. The single import should use the **same scraping pipeline** as bulk import, just for one URL at a time.

---

## Updated Tab 1: Single Import

Import a single blog post by URL. The backend scrapes the page, extracts the content as markdown, creates the asset, and runs AI categorization automatically.

### Form Fields

- **Blog URL** (required, URL input) — the published blog post URL to scrape
  - Placeholder: `https://example.com/blog/my-post`
  - Validate: must be a valid HTTP/HTTPS URL
  - This is the primary input — make it prominent at the top of the form
- **External Link** (optional, URL input) — permanent link to the content's home (Google Drive, Dropbox, etc.). If not provided, the blog URL is used as the external link on the asset.
  - Placeholder: `https://drive.google.com/... (optional)`
  - Helper text: "Where does this content permanently live? Leave blank to use the blog URL."
- **Content Type** (optional, dropdown — populated from `GET /api/compass/content/types?contract_id={id}`)
  - Defaults to "Blog Post" if available in the list (pre-select it)
  - Helper text: "Auto-detected by AI if left blank"
- **Category** (optional, dropdown — populated from `GET /api/compass/content/categories?contract_id={id}`)
  - Helper text: "Auto-detected by AI if left blank"
- **Tags** (optional, tag input — freeform text chips)

**Remove these fields from the current form:**
- ~~Content Body~~ (the backend extracts this from the URL)
- ~~Title~~ (extracted from the scraped page — users shouldn't have to type it)
- ~~Published Date~~ (extracted from the scraped page metadata)

### Submit Behavior

The single import uses the **same bulk-ingest API** as the Bulk Import tab, just with one URL. This way it goes through the same scrape pipeline: Master Marketer scrapes the URL, calls back, backend creates the asset and runs AI categorization.

**API:** `POST /api/compass/content/assets/bulk-ingest`

**Request body:**
```json
{
  "contract_id": "uuid",
  "urls": ["https://blog.example.com/my-post"]
}
```

**Response (202 Accepted):**
```json
{
  "batch_id": "uuid",
  "total": 1,
  "submitted": 1,
  "skipped_duplicates": []
}
```

If `skipped_duplicates` includes the URL, show an info message: "This URL has already been imported to the content library."

### After Submission: Progress View

After submitting, transition the form into a progress view (same pattern as bulk import, simplified for one item).

**Poll:** `GET /api/compass/content/assets/bulk-ingest/{batch_id}` every 5 seconds.

Show:
- **Status indicator** — a single status badge/spinner for the one URL:
  - `submitted` — "Scraping..." with a spinner
  - `scraped` — "Creating asset..." with a spinner
  - `asset_created` — "Running AI analysis..." with a spinner
  - `categorized` — "Complete" with a green checkmark
  - `failed` — "Failed" with red icon and the error message
- **URL** being processed

When complete (`categorized`):
- Show success state: "Blog post imported successfully"
- Show the extracted title (from the asset that was created)
- "View Asset" button — navigates to the asset detail page (use the `asset_id` from the item response)
- "Import Another" button — resets the form for a new URL

When failed:
- Show the error message from the item
- "Try Again" button — resets the form with the URL pre-filled

### Post-Processing: External Link

After the asset is created via scraping, if the user provided a separate **External Link** that's different from the blog URL, update the asset to use that link:

**API:** `PUT /api/compass/content/assets/{asset_id}`
```json
{
  "external_url": "https://drive.google.com/file/d/..."
}
```

This should happen automatically after the batch completes and the `asset_id` is available from the progress response. If no external link was provided, the asset keeps the blog URL as its `external_url` (set during scraping).

---

## Design Notes

- The single import form should feel simple and fast — one main field (URL), a couple optional fields, and a submit button
- The progress view should feel like a mini-pipeline visualization, not a loading spinner — users should see each stage happening
- Pre-select "Blog Post" as the content type since that's the primary use case for URL imports
- The form-to-progress transition should be smooth (don't navigate away — transform in place)
- Keep the form state if the user navigates away and comes back (in case they want to check on an import)

---

## Summary of Changes from Current Implementation

1. **Remove** the "Content Body" textarea — users don't paste markdown
2. **Remove** the "Title" field — extracted from scrape
3. **Remove** the "Published Date" field — extracted from scrape
4. **Change** "URL" to "Blog URL" and make it **required** (was optional)
5. **Add** "External Link" optional field for permanent content home
6. **Change** submit to use `POST /assets/bulk-ingest` with `urls: [url]` instead of `POST /assets`
7. **Add** progress tracking view after submission (poll for scrape status)
8. **Add** post-completion "View Asset" and "Import Another" actions
