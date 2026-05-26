// Apply 0003_country_specific_attrs.sql and reload PostgREST schema.
// Run: node scripts/apply-0003-country-attrs.mjs

import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT_DIR, '.env.local') });
const { Client } = pg;

const SQL_FILE = join(ROOT_DIR, 'supabase', '0003_country_specific_attrs.sql');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  // Snapshot of profile-level values before migration (for diff log)
  const before = await client.query(`
    select id, brands_range_low, brands_range_high, bms_penetration_value, market_concentration_value
    from kma.profiles
    where id = 'grocery'
  `);
  console.log('Snapshot grocery profile (before):', before.rows[0]);

  console.log('\nApplying 0003_country_specific_attrs.sql ...');
  const sql = readFileSync(SQL_FILE, 'utf-8');
  await client.query(sql);
  console.log('  ✓ migration applied');

  const after = await client.query(`
    select cd.country_code, cd.brands_range_low, cd.brands_range_high, cd.bms_penetration_value, cd.market_concentration_value
    from kma.country_data cd
    where cd.profile_id = 'grocery'
    order by cd.country_code
  `);
  console.log('\nGrocery country_data (after seed):');
  for (const r of after.rows) console.log(`  ${r.country_code}: brands ${r.brands_range_low}-${r.brands_range_high}, BMS ${r.bms_penetration_value}, conc ${r.market_concentration_value}`);

  const profCols = await client.query(`
    select column_name from information_schema.columns
    where table_schema='kma' and table_name='profiles'
    order by column_name
  `);
  console.log('\nkma.profiles columns now:');
  for (const c of profCols.rows) console.log('  ', c.column_name);

  await client.query(`notify pgrst, 'reload schema'`);
  console.log('\nPostgREST schema reload notify sent.');
  console.log('\nDone.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
