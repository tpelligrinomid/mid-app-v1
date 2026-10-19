# Spec: Project Intake Form — Tally → Lovable

**Type:** Front-end migration. Replace the Tally project intake form with a Lovable-built form; the backend webhook stays exactly as it is.
**Status:** Spec — field inventory (§3) to be completed from the live Tally form before build
**Audience:** **Lovable** (form page + Supabase edge function), **MiD App v1** (this repo — config only, no code change)

Today a client fills in a Tally form at a per-contract link (`?contract=<external_id>`). Tally POSTs the submission to `https://mid-app-v1.onrender.com/api/webhooks/tally/project-intake`, which creates a triage task in the contract's ClickUp "To Dos" list, assigns the account manager, and posts to the contract's internal Slack channel. We want the form in Lovable so it can carry our styling. The handler (`backend/src/routes/webhooks-tally.ts`) does not change.

---

## Work split

| | Lovable | Backend (this repo) |
|---|---|---|
| **Form page** | Public route `/intake?contract=<external_id>`, styled per brand | — |
| **File uploads** | Supabase Storage bucket `project-intake` | — |
| **Signer / forwarder** | Edge function `submit-project-intake` | — |
| **Webhook** | — | Unchanged: `POST /api/webhooks/tally/project-intake` |
| **Signing secret** | Edge function secret `TALLY_SIGNING_SECRET` | Render env `TALLY_SIGNING_SECRET` — same value, must be set |

---

## 1. The constraint: the browser cannot call the webhook

The webhook verifies `tally-signature` = base64 HMAC-SHA256 of the raw request body, using `TALLY_SIGNING_SECRET`. A browser can't hold that secret, so the Lovable page **must not POST to the webhook directly**. It calls a Supabase edge function, which builds the payload, signs it, and forwards it.

The tempting shortcut is to leave `TALLY_SIGNING_SECRET` unset so the page can post unsigned. Don't take it: the URL is public, and without the signature anyone can create ClickUp tasks and Slack posts in any client's folder by guessing contract IDs. The secret must be set on Render before the Lovable form goes live, and should be set now if it isn't already.

```
Browser (/intake?contract=MID…)
   │  form values + uploaded file URLs
   ▼
Edge function submit-project-intake   ← holds TALLY_SIGNING_SECRET
   │  Tally-shaped JSON, signed
   ▼
POST /api/webhooks/tally/project-intake   (unchanged)
   │
   ├─► ClickUp task in contract's To Dos, due today, assigned to AM
   └─► Slack: contract's internal channel (or fallback channel on failure)
```

---

## 2. Payload contract — what the edge function must send

The handler reads Tally's payload shape. The edge function sends the same shape:

```json
{
  "eventId": "<uuid>",
  "eventType": "FORM_RESPONSE",
  "createdAt": "<ISO timestamp>",
  "data": {
    "submissionId": "<uuid — generated when the form loads>",
    "formId": "lovable-project-intake",
    "formName": "Project Intake",
    "createdAt": "<ISO timestamp>",
    "fields": [
      { "key": "contract", "label": "contract", "type": "HIDDEN_FIELDS", "value": "MID20252944" },
      { "key": "project_type", "label": "Select the type of project", "type": "MULTIPLE_CHOICE", "value": "Blog post" },
      { "key": "due_date", "label": "Desired due date", "type": "INPUT_DATE", "value": "2026-10-15" },
      { "key": "attachments", "label": "Attachments", "type": "FILE_UPLOAD", "value": [{ "name": "brief.pdf", "url": "https://…" }] }
    ]
  }
}
```

### Rules the handler depends on

| Rule | Why |
|---|---|
| **`label` strings are the API.** The handler finds fields by label, case-insensitive. | `contract` → which contract. `Select the type of project` → task name (`<type> — <contract name>`). `Desired due date` → shown in Slack as the requested date. Rename any of these and that behavior silently falls back (task named "Project", no requested date). |
| **`contract` = `contracts.external_id`**, taken from the page's `?contract=` param. | Lookup is `contracts.external_id = value`. Missing or unknown → Slack failure alert, no task. |
| **Send choice values as display text, not IDs.** Single choice → string; multi-select → string array. Never use `type: "DROPDOWN"`. | The `DROPDOWN` branch maps Tally option IDs through an `options` array. Plain strings and arrays render directly (arrays are joined with `, `). |
| **Dates as `YYYY-MM-DD` strings.** | Rendered as-is into the task and Slack. |
| **Files as `type: "FILE_UPLOAD"`, value `[{ name, url }]`.** | Rendered as markdown links in the task, Slack links in alerts. |
| **`fields` order = task description order.** Omit empty optional fields or send `null`. | Every field except `contract` is written into the ClickUp description as `**Label:** value`, skipping empties. |
| **Sign the exact bytes you send.** Serialize once, sign that string, send that string. | The handler HMACs the raw body; re-serializing after signing breaks the signature. |

`formName` and `submissionId` print at the bottom of the ClickUp task. Keeping `formName` as "Project Intake" and prefixing nothing is fine; during the parallel run (§6) you can tell the sources apart by `formId` in logs if needed.

---

## 3. Field inventory — fill in from the live Tally form

The handler only depends on the three labels above. Every other field just passes through to the task description, so the Lovable form should reproduce the current Tally form's fields and labels. Copy them here before build:

| # | Label (exact) | Type | Required | Options / notes |
|---|---|---|---|---|
| — | `contract` | hidden, from URL | yes | `external_id` |
| 1 | `Select the type of project` | single choice | yes | *(copy options from Tally)* |
| 2 | `Desired due date` | date | ? | Reference only; the task itself is due today |
| … | *(remaining Tally fields)* | | | |

Labels can be improved in the move, but only for fields other than the three the handler reads, and with the understanding that the new label is what strategists see in ClickUp.

---

## 4. Lovable — the form page

**Route:** `/intake?contract=<external_id>`, public (no login), matching how Tally links are shared today.

**On load:**
- Generate `submissionId` (UUID) once and keep it in component state.
- Validate the contract: call the edge function with `{ action: "check", contract }`. It returns `{ valid, contract_name }` from `contracts` by `external_id` (service role; return only the name). Invalid or missing → show "This intake link isn't valid — contact your account manager" and no form. This catches bad links up front instead of as a Slack alert after the client has typed everything.

**On submit:**
- Disable the button while in flight. The webhook has no de-duplication, so a double-click creates two ClickUp tasks.
- Upload files first (§5), then send `{ action: "submit", contract, submissionId, fields }` to the edge function.

**Result states:**

| Edge function returns | Show |
|---|---|
| `ok: true` | Success: "Thanks — your request is in. Your account manager will follow up." |
| `ok: false` (webhook reached, returned 200 with an error) | **Also a success screen.** The handler has already posted the full submission to the fallback Slack channel, so the team has it. Don't ask the client to resubmit; that creates duplicates once the issue is fixed. |
| Network error / 401 / 5xx | Error: "Something went wrong — please try again." Keep the form contents, and keep the same `submissionId` on retry. |

---

## 5. Lovable — file uploads

Tally hosted uploaded files for us; now we have to.

- Supabase Storage bucket `project-intake`, path `<external_id>/<submissionId>/<filename>`.
- The URL written into the ClickUp task has to keep working for as long as the task matters, and strategists open it from ClickUp without a Supabase login. Use a **signed URL with a long expiry (1 year)**, generated by the edge function after upload. A public bucket would also work but exposes client files to anyone with the link, forever.
- Apply the same per-file size limit Tally had (check the form settings) and cap the file count.

---

## 6. Lovable — edge function `submit-project-intake`

Secrets: `TALLY_SIGNING_SECRET` (same value as Render), `PROJECT_INTAKE_WEBHOOK_URL` (`https://mid-app-v1.onrender.com/api/webhooks/tally/project-intake`).

Responsibilities:
1. `action: "check"`: look up the contract and return `{ valid, contract_name }`.
2. `action: "submit"`:
   - Re-validate the contract.
   - Reject oversized payloads.
   - Build the §2 payload.
   - Sign it and POST it.
   - Return the webhook's JSON (`ok`, `task_url` on success) to the page. Don't expose `task_url` to the client; it's an internal ClickUp link.
3. Basic abuse protection, because the page is public: a hidden honeypot field (drop the submission silently if it's filled) and a per-IP rate limit (for example 5 submissions per 10 minutes).

Signing, in Deno:

```ts
const body = JSON.stringify(payload);            // serialize ONCE
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(Deno.env.get('TALLY_SIGNING_SECRET')!),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
);
const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

const res = await fetch(Deno.env.get('PROJECT_INTAKE_WEBHOOK_URL')!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'tally-signature': signature },
  body,                                           // the same string that was signed
});
```

---

## 7. Rollout

1. **Secret.** Confirm `TALLY_SIGNING_SECRET` is set on Render. If not, set it in Tally's webhook settings and on Render at the same time; Tally and Lovable both sign with that one value.
2. **Build and test** against an internal test contract (one with a ClickUp folder and To Dos list). Every test creates a real ClickUp task and Slack post, so delete them afterwards. Check:
   - task name uses the project type
   - description shows every field in order, with working file links
   - due today, assigned to the AM
   - Slack post in the contract's channel
   - bad contract ID → "invalid link" screen
3. **Parallel run.** Both sources hit the same webhook, so Tally keeps working while contracts move over. Replace Tally links wherever they're shared today (onboarding emails, client Slack bookmarks, the portal) with `/intake?contract=<external_id>`.
4. **Retire Tally** after about 30 days with no Tally-sourced submissions. Disable the Tally form so old links show "closed" rather than silently failing.

---

## 8. Out of scope / later

- **Renaming the route** (`/webhooks/tally/…` → `/webhooks/project-intake`). The name is cosmetic; it changes after Tally is gone, if at all.
- **Server-side de-duplication** on `submissionId`. Front-end disabling plus a stable ID on retry covers the realistic cases. Add it to the handler only if duplicates show up.
- **Logged-in version** inside the client portal, with the contract taken from the session instead of the URL. It uses the same edge function and payload, so it can be added later without changing anything here.
