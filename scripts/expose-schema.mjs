// Try to expose the `kma` schema to the PostgREST API by writing the
// pgrst.db_schemas role setting and reloading the PostgREST config.
//
// Why this might work: Supabase uses PostgREST, and PostgREST reads its
// schema-exposure config from a role setting on the `authenticator` role.
// Setting it via SQL + NOTIFY pgrst, 'reload config' is the canonical
// PostgREST way and Supabase historically respects it.
//
// Why it might NOT work: in newer Supabase versions, the dashboard
// config can override role-level settings. If the dashboard setting
// re-applies on each PostgREST restart, our role setting may revert.
// Worst case: ineffective, no harm done.
//
// Run: node scripts/expose-schema.mjs

import dotenv from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT_DIR, '.env.local') });
const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  // Read current setting (may be empty / default if never set via SQL)
  const before = await client.query(`
    select rolname, rolconfig
    from pg_roles
    where rolname = 'authenticator'
  `);
  console.log('Before — authenticator rolconfig:');
  console.log('  ', before.rows[0]?.rolconfig || '(empty / defaults)');

  // Set the exposed schemas to include kma (preserving the defaults).
  const newSchemas = 'public, graphql_public, kma';
  console.log(`\nSetting pgrst.db_schemas → ${newSchemas} ...`);
  await client.query(`alter role authenticator set pgrst.db_schemas to '${newSchemas}'`);
  await client.query(`notify pgrst, 'reload config'`);
  console.log('  ✓ pgrst.db_schemas set + reload-config notify sent');

  // Wait briefly then reload the schema cache so PostgREST discovers
  // tables in the newly exposed schema.
  await new Promise((r) => setTimeout(r, 2000));
  await client.query(`notify pgrst, 'reload schema'`);
  console.log('  ✓ reload-schema notify sent');

  // Read after
  const after = await client.query(`
    select rolname, rolconfig
    from pg_roles
    where rolname = 'authenticator'
  `);
  console.log('\nAfter — authenticator rolconfig:');
  console.log('  ', after.rows[0]?.rolconfig);

  console.log('\nVerify with:');
  console.log(`  curl -H "apikey: <anon-key>" "https://<project>.supabase.co/rest/v1/profiles?limit=1" -H "Accept-Profile: kma"`);
  console.log('\nIf still PGRST106 after ~30s, the dashboard config has overridden the SQL change. Add `kma` manually in Settings → API → Exposed schemas.');
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
