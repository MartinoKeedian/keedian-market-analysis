// Apply schema + migrate YAML data to Supabase.
//
// Uses DATABASE_URL from .env.local (gitignored). The deployed app uses
// only the anon key from docs/data/supabase.json (committed, public).
//
// Run: node scripts/migrate-to-supabase.mjs

import dotenv from 'dotenv';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import yaml from 'js-yaml';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT_DIR, '.env.local') });

const { Client } = pg;
const PROFILES_DIR = join(ROOT_DIR, 'docs', 'data', 'profiles');
const SCHEMA_SQL = join(ROOT_DIR, 'supabase', '0001_kma_schema.sql');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing in .env.local. See .env.local.example.');
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  // Step 1: schema
  console.log('Applying schema…');
  const schemaSql = readFileSync(SCHEMA_SQL, 'utf-8');
  await client.query(schemaSql);
  console.log('  ✓ schema applied');

  // Step 2: load YAMLs
  console.log('Reading profile YAMLs…');
  const ids = yaml.load(readFileSync(join(PROFILES_DIR, '_index.yml'), 'utf-8')).profiles;
  const profiles = ids.map((id) => yaml.load(readFileSync(join(PROFILES_DIR, `${id}.yml`), 'utf-8')));
  console.log(`  ✓ ${profiles.length} profiles loaded`);

  // Step 3: clear existing rows (idempotent re-run)
  console.log('Clearing previous data…');
  await client.query('truncate kma.audit_log, kma.country_data, kma.feasibility_inputs, kma.profiles restart identity cascade');
  console.log('  ✓ cleared');

  // Step 4: insert profiles
  console.log('Inserting profiles…');
  for (const p of profiles) {
    const m = p.market_analysis || {};
    await client.query(
      `insert into kma.profiles (
        id, display_name, kp_segment_id, preliminary,
        typical_site_sqft_low, typical_site_sqft_high, typical_site_sqft_nominal,
        market_concentration_value, market_concentration_rationale, market_concentration_source,
        bms_penetration_value, bms_penetration_rationale, bms_penetration_source,
        brands_range_low, brands_range_high, brands_range_rationale, brands_range_source,
        pain_points
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        p.id,
        p.display_name,
        p.kp_segment_id || null,
        p.preliminary !== false,
        m.typical_site_sqft?.low ?? null,
        m.typical_site_sqft?.high ?? null,
        m.typical_site_sqft?.nominal ?? null,
        m.market_concentration?.value ?? null,
        m.market_concentration?.rationale ?? null,
        m.market_concentration?.source ?? null,
        m.bms_penetration?.value ?? null,
        m.bms_penetration?.rationale ?? null,
        m.bms_penetration?.source ?? null,
        m.brands_range?.low ?? null,
        m.brands_range?.high ?? null,
        m.brands_range?.rationale ?? null,
        m.brands_range?.source ?? null,
        m.pain_points ?? [],
      ]
    );
  }
  console.log(`  ✓ ${profiles.length} profiles inserted`);

  // Step 5: insert country_data
  console.log('Inserting country_data…');
  let cdCount = 0;
  for (const p of profiles) {
    const byCountry = p.market_analysis?.by_country || {};
    for (const code of ['CL', 'MX', 'US']) {
      const c = byCountry[code];
      if (!c) continue;
      await client.query(
        `insert into kma.country_data (
          profile_id, country_code,
          sites_low, sites_high, sites_nominal, sites_rationale,
          impl_addressable_pct, impl_avg_ticket_usd,
          sub_addressable_pct, sub_arpu_monthly_usd
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          p.id, code,
          c.sites?.low ?? null,
          c.sites?.high ?? null,
          c.sites?.nominal ?? null,
          c.sites_rationale ?? null,
          c.implementation?.addressable_pct ?? null,
          c.implementation?.avg_ticket_usd ?? null,
          c.subscription?.addressable_pct ?? null,
          c.subscription?.arpu_monthly_usd ?? null,
        ]
      );
      cdCount += 1;
    }
  }
  console.log(`  ✓ ${cdCount} country_data rows inserted`);

  // Step 6: insert feasibility_inputs
  console.log('Inserting feasibility_inputs…');
  let fiCount = 0;
  for (const p of profiles) {
    const f = p.market_analysis?.feasibility_inputs;
    if (!f) continue;
    const dc = f.delivery_capacity || {};
    await client.query(
      `insert into kma.feasibility_inputs (
        profile_id, need_perception, hw_gap, similar_clients_exist,
        bms_penetration_effect, sustainment_upside
      ) values ($1,$2,$3,$4,$5,$6)`,
      [
        p.id,
        f.need_perception ?? null,
        dc.hw_gap ?? null,
        dc.similar_clients_exist ?? null,
        dc.bms_penetration_effect ?? null,
        dc.sustainment_upside ?? null,
      ]
    );
    fiCount += 1;
  }
  console.log(`  ✓ ${fiCount} feasibility_inputs rows inserted`);

  // Step 7: counts
  const counts = await client.query(`
    select 'profiles' as t, count(*)::int as n from kma.profiles
    union all select 'country_data', count(*)::int from kma.country_data
    union all select 'feasibility_inputs', count(*)::int from kma.feasibility_inputs
    order by t
  `);
  console.log('\nFinal counts:');
  for (const row of counts.rows) console.log(`  kma.${row.t}: ${row.n}`);

  console.log('\nDone. Next steps for you:');
  console.log('  1. Supabase Studio → Settings → API → Exposed schemas → add `kma`');
  console.log('  2. Refresh the URL and the app will start reading from Supabase.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
