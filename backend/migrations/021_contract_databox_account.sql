-- Migration 021: Databox account per contract
-- Compass chat reads a client's GA4 / Google Ads / LinkedIn Ads numbers from
-- Databox. The backend scopes every Databox call to this account, so a chat
-- on one contract can't read another client's data.
--
-- Databox account names aren't unique (two accounts are named "New North"),
-- so always map by ID. Find IDs with GET https://api.databox.com/v2/accounts.
--
-- Idempotent; run in the Supabase SQL editor.

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS databox_account_id text;

COMMENT ON COLUMN contracts.databox_account_id IS
  'Databox account ID holding this client''s connected sources (GA4, Google Ads, LinkedIn Ads). Used by Compass chat.';

-- New North (MIDNEW12345): Databox account 768359, not the older 190660.
UPDATE contracts SET databox_account_id = '768359' WHERE external_id = 'MIDNEW12345';
