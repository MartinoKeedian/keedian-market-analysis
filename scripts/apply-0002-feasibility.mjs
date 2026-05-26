// Apply 0002_feasibility_by_country_type.sql and verify the resulting
// row count. Also sends PostgREST schema-reload NOTIFY so the API
// picks up the new kma.feasibility table.
//
// Run: node scripts/apply-0002-feasibility.mjs

import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT_DIR, '.env.local') });
const { Client } = pg;

const SQL_FILE = join(ROOT_DIR, 'supabase', '0002_feasibility_by_country_type.sql');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  // First, snapshot the old data so we have a backup in case rerun is needed.
  const oldRows = await client.query('select count(*)::int as n from kma.feasibility_inputs');
  console.log(`Snapshot before — kma.feasibility_inputs rows: ${oldRows.rows[0].n}`);

  console.log('Applying 0002_feasibility_by_country_type.sql ...');
  const sql = readFileSync(SQL_FILE, 'utf-8');
  await client.query(sql);
  console.log('  ✓ migration applied');

  const newCount = await client.query('select count(*)::int as n from kma.feasibility');
  console.log(`After — kma.feasibility rows: ${newCount.rows[0].n} (expected ${oldRows.rows[0].n * 6})`);

  const byPair = await client.query(`
    select country_code, project_type, count(*)::int as n
    from kma.feasibility
    group by country_code, project_type
    order by country_code, project_type
  `);
  console.log('\nBy (country, type):');
  for (const r of byPair.rows) console.log(`  ${r.country_code} / ${r.project_type}: ${r.n}`);

  // Confirm the old table is gone
  const oldGone = await client.query(`
    select count(*) from information_schema.tables
    where table_schema = 'kma' and table_name = 'feasibility_inputs'
  `);
  console.log(`\nOld table kma.feasibility_inputs ${oldGone.rows[0].count === '0' ? 'dropped ✓' : 'still exists ✗'}`);

  // Reload PostgREST schema cache so the new table is reachable via REST.
  await client.query(`notify pgrst, 'reload schema'`);
  console.log('PostgREST schema cache reload notify sent');

  console.log('\nDone.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
