-- Client's main website on the contract, as a bare host ("newnorth.com").
-- Used by Compass chat's SEO tools and by deliverables (content plans,
-- briefs) that need the client's domain. Idempotent.

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS primary_domain text;

COMMENT ON COLUMN contracts.primary_domain IS
  'Client''s main website as a bare lowercase host, e.g. newnorth.com (no scheme, www or path).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_primary_domain_format') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_primary_domain_format
      CHECK (primary_domain IS NULL OR primary_domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$');
  END IF;
END $$;

-- Backfill from each contract's latest SEO audit, which records the client's
-- domain. Only fills contracts that don't have one yet.
WITH latest AS (
  SELECT DISTINCT ON (contract_id)
    contract_id,
    regexp_replace(
      regexp_replace(
        lower(trim(content_structured #>> '{competitive_search,client_profile,domain}')),
        '^([a-z]+://)?(www\.)?', ''),
      '[/?#:].*$', '') AS domain
  FROM compass_deliverables
  WHERE deliverable_type = 'seo_audit'
    AND coalesce(content_structured #>> '{competitive_search,client_profile,domain}', '') <> ''
  ORDER BY contract_id, created_at DESC
)
UPDATE contracts c
SET primary_domain = l.domain
FROM latest l
WHERE c.contract_id = l.contract_id
  AND c.primary_domain IS NULL
  AND l.domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$';
