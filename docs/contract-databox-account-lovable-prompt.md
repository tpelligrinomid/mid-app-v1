# Lovable Prompt: Databox Account Picker on Contracts

Compass chat can now answer questions about a client's own marketing data (Google Analytics 4, Google Ads, LinkedIn Ads) from Databox. To do that it needs to know which Databox account belongs to each contract. Please add a picker for this on the contract.

---

## 1. Database

Run this migration (also in the repo as `backend/migrations/021_contract_databox_account.sql`). It's idempotent.

```sql
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS databox_account_id text;

COMMENT ON COLUMN contracts.databox_account_id IS
  'Databox account ID holding this client''s connected sources (GA4, Google Ads, LinkedIn Ads). Used by Compass chat.';

-- New North (MIDNEW12345): Databox account 768359, not the older 190660.
UPDATE contracts SET databox_account_id = '768359' WHERE external_id = 'MIDNEW12345';
```

`databox_account_id` is a nullable text column. Null means the contract has no Databox account, and Compass simply won't offer marketing data for it.

## 2. Where it goes

On the contract **edit** form (and shown read-only on the contract detail page), add a field in the integrations / external IDs area:

- **Label:** Databox account
- **Help text:** "Lets Compass chat answer questions about this client's GA4, Google Ads and LinkedIn Ads data."
- **Visible to:** admins and team members only. Hide it from client users.

## 3. The picker

A **searchable select** (combobox).

**Options:** load them from the backend, never from Databox directly, because the Databox API key stays on the server:

```
GET {BACKEND_URL}/api/compass/databox/accounts
Authorization: Bearer <user's Supabase access token>   (same auth as other /api/compass calls)

200 → { "accounts": [ { "id": "768359", "name": "New North" }, { "id": "593344", "name": "ThreatMark" }, ... ] }
```

- Show each option as **name + ID**, e.g. `New North · 768359`. Account names are **not unique**: there's a client account "New North" (768359) and the agency's own account "New North (agency account)" (190660). The ID is what tells them apart, so always show it.
- Search should match both the name and the ID.
- Add a first option **"None"** that clears the value (saves `null`).
- If the contract already has a `databox_account_id` that isn't in the list, still show it as the current value (`Unknown account · 123456`) so it isn't silently wiped.
- Load the options when the picker opens, with a loading state. On error, show "Couldn't load Databox accounts" and a retry link, and keep the current value.

**Connected sources preview:** when an account is selected (or the form loads with one already set), fetch its sources and show them under the picker so the user can confirm it's the right account:

```
GET {BACKEND_URL}/api/compass/databox/accounts/{id}/sources

200 → { "sources": [
  { "id": "5059559", "name": "NewNorth", "type": "GoogleAnalytics4", "status": "active" },
  { "id": "5047123", "name": "New North (6847699762)", "type": "GoogleAdwords", "status": "active" },
  { "id": "5059690", "name": "New North", "type": "LinkedInAds", "status": "active" }
] }
```

- Show these as small chips: a friendly type label plus the source name, e.g. `Google Analytics 4 · NewNorth`. Map the common `type` values: `GoogleAnalytics4` → Google Analytics 4, `GoogleAdwords` → Google Ads, `LinkedInAds` → LinkedIn Ads, `LinkedIn` → LinkedIn Page, `Facebook` → Facebook Page, `FacebookAds` → Meta Ads, `GoogleSearchConsole` → Search Console, `HubspotCrm` / `Hubspot` → HubSpot. Otherwise show the raw type.
- If `status` isn't `"active"`, give that chip a muted or warning style with the tooltip "Not syncing in Databox". This catches broken connections early.
- If the account has no sources, show "No data sources connected in this Databox account."

## 4. Saving

Save it with the rest of the contract form through the existing contract update:

```
PUT {BACKEND_URL}/api/contracts/{contract_id}
{ "databox_account_id": "768359" }      // or null for "None"
```

The value is the account **ID as a string**, never the name.

## 5. Notes

- Both GET endpoints return 403 for client users and 502 if Databox can't be reached.
- The account list is cached on the server for 10 minutes, so an account just created in Databox may take a few minutes to appear.
- No other Compass UI changes are needed. Once a contract has an account, Compass chat picks it up on the next message.
