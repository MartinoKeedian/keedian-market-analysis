// Apply 0004_scale_1_7_descriptions_adjusted.sql
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT_DIR, '.env.local') });
const { Client } = pg;

const SQL_FILE = join(ROOT_DIR, 'supabase', '0004_scale_1_7_descriptions_adjusted.sql');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  console.log('Applying 0004 ...');
  const sql = readFileSync(SQL_FILE, 'utf-8');
  await client.query(sql);
  console.log('  ✓ migration applied');

  const sample = await client.query(`
    select profile_id, country_code, project_type, need_perception, hw_gap, similar_clients_exist
    from kma.feasibility
    where profile_id = 'grocery'
    order by country_code, project_type
  `);
  console.log('\nGrocery feasibility (rescaled to 1-7):');
  for (const r of sample.rows) console.log(`  ${r.country_code}/${r.project_type}: need=${r.need_perception}, hw_gap=${r.hw_gap}, sim=${r.similar_clients_exist}`);

  const descrCount = await client.query('select count(*)::int as n from kma.feasibility_descriptions');
  console.log(`\nfeasibility_descriptions rows: ${descrCount.rows[0].n}`);

  const cdCols = await client.query(`
    select column_name from information_schema.columns
    where table_schema='kma' and table_name='country_data' and column_name like '%adjust%' or column_name like '%assumption%'
  `);
  console.log('\nNew country_data columns:', cdCols.rows.map((r) => r.column_name).join(', '));

  await client.query(`notify pgrst, 'reload schema'`);
  console.log('\nPostgREST schema reload notify sent. Done.');
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
