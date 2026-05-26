# Supabase — Migration & Operations Runbook

This document is the source of truth for how the Market Analysis module
talks to Supabase: schema layout, migration workflow, verification, and
rollback procedures.

## At a glance

- Supabase project: shared with JCP (`jbaflryafeihbyekwwvd.supabase.co`).
- Schema: **`kma`** (separate from `public` to keep this module's tables
  isolated from JCP's tables in the same database).
- Tables: `kma.profiles`, `kma.country_data`, `kma.feasibility_inputs`,
  `kma.audit_log`.
- Row-Level Security: anonymous can read, authenticated can write
  (anyone signed in via Supabase Auth on this project).
- Initial data: loaded from the YAMLs in `docs/data/profiles/*.yml`.

## Files

| File | Purpose |
|---|---|
| `supabase/0001_kma_schema.sql` | DDL — schema, tables, indexes, RLS, triggers. Idempotent (`if not exists`, `drop policy if exists`). |
| `scripts/migrate-to-supabase.mjs` | Apply the SQL, truncate `kma.*`, and bulk-insert the 22 profiles + 66 country rows + 22 feasibility rows from YAML. |
| `scripts/verify-supabase.mjs` | Compare DB rows against YAML row-by-row. Confirms RLS policies are in place. |
| `docs/data/supabase.json` | Public config (URL + anon key) consumed by the browser. |
| `.env.local` | Local secrets (service role + DATABASE_URL). **Gitignored.** Copy from `.env.local.example`. |

## Migration workflow (first time)

1. Copy `.env.local.example` → `.env.local` and fill in the Supabase
   project's DATABASE_URL.
2. Run:
   ```bash
   node scripts/migrate-to-supabase.mjs
   ```
   This applies the schema, clears any existing `kma.*` rows, and
   inserts everything fresh from YAML. Expected output: 22 profiles,
   66 country_data, 22 feasibility_inputs.
3. Run the verifier:
   ```bash
   node scripts/verify-supabase.mjs
   ```
   Should exit with `✓ All data checks passed.` and confirm the 8 RLS
   policies are present.
4. **Expose the `kma` schema to the REST API.** Two options:
   - **Automated (preferred):** `node scripts/expose-schema.mjs`. Sets
     `pgrst.db_schemas` on the `authenticator` role via SQL and sends
     two `NOTIFY` signals to reload the PostgREST config + schema cache.
     Confirmed working as of 2026-05-26.
   - **Manual fallback:** Supabase Studio → Settings → API → Exposed
     schemas → add `kma`. Use this if the SQL approach is reverted by
     a future Supabase change.
5. Verify the exposure works:
   ```bash
   curl -s -H "apikey: $ANON_KEY" \
     "https://YOUR_PROJECT.supabase.co/rest/v1/profiles?select=id&limit=1" \
     -H "Accept-Profile: kma"
   ```
   Should return a JSON array, not `PGRST106 Invalid schema`.
6. Open the deployed URL. The status line above the matrix should now
   say `Data source: Supabase (live).` If it still says `YAML
   (fallback)`, the schema exposure didn't propagate yet — wait 30s and
   hard-refresh.

## Re-running the migration (destructive)

The script truncates `kma.*` and re-inserts from YAML. **It wipes any
edits made through the UI.** Only re-run when:

- You changed the schema (added a column) and need to bootstrap from
  scratch.
- You're recovering from a corrupted state.
- You're seeding a fresh project (e.g., new Supabase project).

If you only want to add a new column without losing edits, write a
manual migration (`supabase/0002_*.sql`) and apply it via:
```bash
psql "$DATABASE_URL" -f supabase/0002_*.sql
```

## Verifying integrity at any point

```bash
node scripts/verify-supabase.mjs
```

Compares every row in the DB against the corresponding YAML. Fails
loudly on any mismatch. Useful before a major schema change to confirm
state, or after edits to see what's drifted from YAML.

## Snapshotting DB back to YAML

(Not implemented yet.) When you've made significant edits through the
UI and want a git-tracked snapshot, write a `scripts/export-to-yaml.mjs`
that reads the DB and overwrites the YAMLs. Then commit the YAML
changes.

For now, all edits live in the DB and `audit_log`. YAML is a starting
point, not a continuously-updated copy.

## RLS policies

Anonymous (no auth):
- SELECT on all 4 tables.

Authenticated (any signed-in Supabase user on this project):
- SELECT + UPDATE on `kma.profiles`, `kma.country_data`,
  `kma.feasibility_inputs`.
- SELECT + INSERT on `kma.audit_log`.

Trade-off: any user signed into the JCP/Keedian Supabase project can
edit market analysis data. This is fine for a small team. If you need
restriction by email, add a policy like:
```sql
create policy profiles_write_restricted on kma.profiles
  for update using (auth.email() in ('martino.topasio@keedian.com'));
```

## Audit log

Every edit through the UI creates a row in `kma.audit_log` with:

- `table_name`, `record_id`, `field_name`
- `old_value`, `new_value` (text-encoded)
- `changed_by` (the authenticated user's email)
- `changed_at` (timestamptz)

Query example:
```sql
select changed_at, changed_by, table_name, field_name, new_value
from kma.audit_log
order by changed_at desc
limit 50;
```

A "Recent edits" view in the app surfacing this is on the roadmap.

## Rollback

If a migration goes wrong:

```sql
drop schema kma cascade;
```

Then re-run `migrate-to-supabase.mjs` to rebuild from YAML.

This destroys all DB-only edits and the audit log. The YAMLs remain
intact (they're the source of truth before the DB was created).

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| App shows `Data source: YAML (fallback)` | `kma` not in Exposed schemas | Add `kma` in Settings → API → Exposed schemas |
| `PGRST106 Invalid schema` from curl | Same | Same |
| Sign-in works but UPDATE returns RLS error | Policy missing or schema mismatch | Re-run `node scripts/verify-supabase.mjs` |
| Edits succeed but UI doesn't reflect | Local state not updated after save | Re-render bug in `matrix.js` — check console |
| Migration fails with `relation already exists` | Old prefix-based tables in `public` from a prior attempt | Drop them: `drop table if exists public.kma_profiles, public.kma_country_data, ...` |

## Future migrations

When adding new fields:

1. Write `supabase/0002_descriptive_name.sql` with the schema change.
2. Apply via `psql "$DATABASE_URL" -f supabase/0002_descriptive_name.sql`.
3. Update `scripts/migrate-to-supabase.mjs` to include the new field.
4. Update `data-loader.js` to read/write the new field.
5. Update `matrix.js` to render it.
6. Run `verify-supabase.mjs` to confirm consistency.

Each migration SQL file should be idempotent (`if not exists`, etc.) so
it can be re-run safely.
