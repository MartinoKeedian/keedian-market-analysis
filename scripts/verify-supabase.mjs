// Verify that the data in Supabase exactly matches the YAML source of truth.
// Run after migrate-to-supabase.mjs and before exposing the schema in API
// so any drift is caught while only the loader-fallback (YAML) is in use.
//
// Run: node scripts/verify-supabase.mjs

import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import yaml from 'js-yaml';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT_DIR, '.env.local') });

const { Client } = pg;
const PROFILES_DIR = join(ROOT_DIR, 'docs', 'data', 'profiles');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

let errors = 0;
let warnings = 0;
function fail(msg) { console.error(`✗ ${msg}`); errors += 1; }
function warn(msg) { console.log(`⚠ ${msg}`); warnings += 1; }
function ok(msg) { console.log(`✓ ${msg}`); }

function eq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 0.01;
  return String(a) === String(b);
}

try {
  // Load YAML
  const ids = yaml.load(readFileSync(join(PROFILES_DIR, '_index.yml'), 'utf-8')).profiles;
  const yamls = Object.fromEntries(
    ids.map((id) => [id, yaml.load(readFileSync(join(PROFILES_DIR, `${id}.yml`), 'utf-8'))])
  );

  // 1. Counts
  const counts = await client.query(`
    select
      (select count(*) from kma.profiles) as profiles,
      (select count(*) from kma.country_data) as country_data,
      (select count(*) from kma.feasibility_inputs) as feasibility
  `);
  const c = counts.rows[0];
  const expectedProfiles = ids.length;
  const expectedCountry = ids.length * 3;
  const expectedFeas = ids.length;
  if (c.profiles == expectedProfiles) ok(`profiles: ${c.profiles} (expected ${expectedProfiles})`);
  else fail(`profiles: ${c.profiles}, expected ${expectedProfiles}`);
  if (c.country_data == expectedCountry) ok(`country_data: ${c.country_data} (expected ${expectedCountry})`);
  else fail(`country_data: ${c.country_data}, expected ${expectedCountry}`);
  if (c.feasibility == expectedFeas) ok(`feasibility_inputs: ${c.feasibility} (expected ${expectedFeas})`);
  else fail(`feasibility_inputs: ${c.feasibility}, expected ${expectedFeas}`);

  // 2. Per-profile spot check
  const dbProfiles = await client.query('select * from kma.profiles order by id');
  for (const dbRow of dbProfiles.rows) {
    const y = yamls[dbRow.id];
    if (!y) { fail(`DB row "${dbRow.id}" has no matching YAML`); continue; }
    const m = y.market_analysis || {};
    const checks = [
      ['display_name', dbRow.display_name, y.display_name],
      ['kp_segment_id', dbRow.kp_segment_id, y.kp_segment_id ?? null],
      ['typical_site_sqft_low', dbRow.typical_site_sqft_low, m.typical_site_sqft?.low],
      ['typical_site_sqft_high', dbRow.typical_site_sqft_high, m.typical_site_sqft?.high],
      ['typical_site_sqft_nominal', dbRow.typical_site_sqft_nominal, m.typical_site_sqft?.nominal],
      ['market_concentration_value', dbRow.market_concentration_value, m.market_concentration?.value],
      ['bms_penetration_value', dbRow.bms_penetration_value, m.bms_penetration?.value],
      ['brands_range_low', dbRow.brands_range_low, m.brands_range?.low],
      ['brands_range_high', dbRow.brands_range_high, m.brands_range?.high],
    ];
    for (const [field, dbVal, yVal] of checks) {
      if (!eq(dbVal, yVal)) fail(`${dbRow.id}.${field}: db=${JSON.stringify(dbVal)} yaml=${JSON.stringify(yVal)}`);
    }
    // pain_points (array)
    const yPains = m.pain_points || [];
    if (JSON.stringify(dbRow.pain_points) !== JSON.stringify(yPains))
      fail(`${dbRow.id}.pain_points: db=${JSON.stringify(dbRow.pain_points)} yaml=${JSON.stringify(yPains)}`);
  }

  // 3. Country data spot check
  const dbCountry = await client.query('select * from kma.country_data order by profile_id, country_code');
  for (const cd of dbCountry.rows) {
    const y = yamls[cd.profile_id];
    if (!y) { fail(`country_data row for "${cd.profile_id}" has no YAML`); continue; }
    const yc = y.market_analysis?.by_country?.[cd.country_code];
    if (!yc) { fail(`country_data ${cd.profile_id}/${cd.country_code}: missing in YAML`); continue; }
    const checks = [
      ['sites_low', cd.sites_low, yc.sites?.low],
      ['sites_high', cd.sites_high, yc.sites?.high],
      ['sites_nominal', cd.sites_nominal, yc.sites?.nominal],
      ['impl_addressable_pct', cd.impl_addressable_pct, yc.implementation?.addressable_pct],
      ['impl_avg_ticket_usd', cd.impl_avg_ticket_usd, yc.implementation?.avg_ticket_usd],
      ['sub_addressable_pct', cd.sub_addressable_pct, yc.subscription?.addressable_pct],
      ['sub_arpu_monthly_usd', cd.sub_arpu_monthly_usd, yc.subscription?.arpu_monthly_usd],
    ];
    for (const [field, dbVal, yVal] of checks) {
      if (!eq(dbVal, yVal)) fail(`${cd.profile_id}/${cd.country_code}.${field}: db=${JSON.stringify(dbVal)} yaml=${JSON.stringify(yVal)}`);
    }
  }

  // 4. Feasibility spot check
  const dbFeas = await client.query('select * from kma.feasibility_inputs order by profile_id');
  for (const fr of dbFeas.rows) {
    const y = yamls[fr.profile_id];
    if (!y) { fail(`feasibility row for "${fr.profile_id}" has no YAML`); continue; }
    const f = y.market_analysis?.feasibility_inputs;
    if (!f) { fail(`feasibility ${fr.profile_id}: YAML has no feasibility_inputs`); continue; }
    const dc = f.delivery_capacity || {};
    const checks = [
      ['need_perception', fr.need_perception, f.need_perception],
      ['hw_gap', fr.hw_gap, dc.hw_gap],
      ['similar_clients_exist', fr.similar_clients_exist, dc.similar_clients_exist],
      ['bms_penetration_effect', fr.bms_penetration_effect, dc.bms_penetration_effect],
      ['sustainment_upside', fr.sustainment_upside, dc.sustainment_upside],
    ];
    for (const [field, dbVal, yVal] of checks) {
      if (!eq(dbVal, yVal)) fail(`feasibility ${fr.profile_id}.${field}: db=${JSON.stringify(dbVal)} yaml=${JSON.stringify(yVal)}`);
    }
  }

  // 5. RLS sanity — confirm policies exist
  const policies = await client.query(`
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'kma'
    order by tablename, cmd
  `);
  const expected = [
    ['audit_log', 'audit_insert', 'INSERT'],
    ['audit_log', 'audit_read', 'SELECT'],
    ['country_data', 'country_data_read', 'SELECT'],
    ['country_data', 'country_data_write', 'UPDATE'],
    ['feasibility_inputs', 'feasibility_read', 'SELECT'],
    ['feasibility_inputs', 'feasibility_write', 'UPDATE'],
    ['profiles', 'profiles_read', 'SELECT'],
    ['profiles', 'profiles_write', 'UPDATE'],
  ];
  const have = new Set(policies.rows.map((r) => `${r.tablename}|${r.policyname}|${r.cmd}`));
  for (const [t, p, c] of expected) {
    if (have.has(`${t}|${p}|${c}`)) ok(`policy ${t}.${p} (${c})`);
    else fail(`missing policy ${t}.${p} (${c})`);
  }

  // 6. Schema exposure hint — we can't check the PostgREST exposed_schemas
  // setting via SQL. Remind the user.
  warn('Cannot check from SQL whether `kma` is in Exposed schemas. Verify in Supabase UI.');

  console.log(`\n${errors === 0 ? '✓ All data checks passed.' : `✗ ${errors} errors found.`} ${warnings} warnings.`);
  if (errors > 0) process.exit(1);
} catch (err) {
  console.error('Verification crashed:', err);
  process.exit(1);
} finally {
  await client.end();
}
