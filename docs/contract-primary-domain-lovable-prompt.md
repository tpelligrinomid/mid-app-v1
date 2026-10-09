# Lovable Prompt: Client Website on Contracts

Compass chat can now research keywords, rankings and competitors for a client, and content plans and briefs also use the client's website. To do this they need to know each client's main website, so please add a **Website** field to the contract.

---

## 1. Database

Run this migration. It's also in the repo as `backend/migrations/022_contract_primary_domain.sql`, and it's safe to run more than once.

```sql
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

-- Backfill from each contract's latest SEO audit, which records the client's domain.
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
```

`primary_domain` is a nullable text column. The value is always a bare lowercase host such as `newnorth.com`: no `https://`, no `www.` and no path. The constraint rejects anything else.

## 2. Where it goes

Put the field on the contract **edit** form, next to the **Databox account** picker in the integrations / external IDs area. Also show it read-only on the contract detail page.

- **Label:** Website
- **Placeholder:** `example.com`
- **Help text:** "The client's main website. Compass uses it for keyword, ranking and competitor research."
- **Visible to:** admins and team members only. Hide it from client users.
- **Detail page:** show it as a link that opens `https://{primary_domain}` in a new tab.

## 3. Input handling

People will paste full URLs, so clean the value up as they type or when the field loses focus:

1. Trim the value and lowercase it.
2. Strip any `scheme://`, a leading `www.`, and everything from the first `/`, `?`, `#` or `:`.
3. For example, `https://www.NewNorth.com/about` becomes `newnorth.com`.

After cleanup, check the value against `^[a-z0-9-]+(\.[a-z0-9-]+)+$`. If it fails, show "Enter a domain like example.com" and don't save. An empty field saves `null`.

## 4. Saving

Save it with the rest of the contract form through the existing contract update:

```
PUT {BACKEND_URL}/api/contracts/{contract_id}
{ "primary_domain": "newnorth.com" }     // or null to clear it
```

The backend applies the same cleanup. If the value can't be a domain, it returns 400 with `details: ["Invalid primary_domain: ..."]`. Show that message on the field.

## 5. Notes

- About 38 contracts are filled in automatically from their SEO audits. The rest need it typed in.
- No other Compass UI changes are needed. Compass picks the website up on the next message.
