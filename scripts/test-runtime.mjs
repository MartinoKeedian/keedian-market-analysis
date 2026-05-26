// Simulate the browser path: load from Supabase, run scoring functions.
import dotenv from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT_DIR, '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const { createClient } = await import('@supabase/supabase-js');
const client = createClient(supabaseUrl, anonKey, { db: { schema: 'kma' } });

// Reproduce loadFromSupabase
const [profilesRes, countryDataRes, feasRes] = await Promise.all([
  client.from('profiles').select('*'),
  client.from('country_data').select('*'),
  client.from('feasibility').select('*'),
]);
if (profilesRes.error) { console.error('profiles:', profilesRes.error); process.exit(1); }
if (countryDataRes.error) { console.error('country_data:', countryDataRes.error); process.exit(1); }
if (feasRes.error) { console.error('feasibility:', feasRes.error); process.exit(1); }

console.log('Rows fetched:');
console.log('  profiles:', profilesRes.data.length);
console.log('  country_data:', countryDataRes.data.length);
console.log('  feasibility:', feasRes.data.length);

// Spot-check Grocery feasibility array
const groceryFeas = feasRes.data.filter((r) => r.profile_id === 'grocery');
console.log(`\nGrocery feasibility (${groceryFeas.length} rows):`);
for (const r of groceryFeas) console.log(`  ${r.country_code}/${r.project_type}: need=${r.need_perception}`);

// Import scoring
const scoring = await import(pathToFileURL(join(ROOT_DIR, 'docs/assets/scoring.js')).href);

// Reproduce assembleProfile for grocery
const groceryRow = profilesRes.data.find((r) => r.id === 'grocery');
const groceryCountry = {};
for (const c of countryDataRes.data.filter((r) => r.profile_id === 'grocery')) {
  groceryCountry[c.country_code] = c;
}
const groceryProfile = {
  id: 'grocery',
  market_analysis: {
    by_country: {
      CL: { sites: { nominal: groceryCountry.CL?.sites_nominal }, implementation: { addressable_pct: groceryCountry.CL?.impl_addressable_pct, avg_ticket_usd: groceryCountry.CL?.impl_avg_ticket_usd }, subscription: { addressable_pct: groceryCountry.CL?.sub_addressable_pct, arpu_monthly_usd: groceryCountry.CL?.sub_arpu_monthly_usd } },
      MX: { sites: { nominal: groceryCountry.MX?.sites_nominal }, implementation: { addressable_pct: groceryCountry.MX?.impl_addressable_pct, avg_ticket_usd: groceryCountry.MX?.impl_avg_ticket_usd }, subscription: { addressable_pct: groceryCountry.MX?.sub_addressable_pct, arpu_monthly_usd: groceryCountry.MX?.sub_arpu_monthly_usd } },
      US: { sites: { nominal: groceryCountry.US?.sites_nominal }, implementation: { addressable_pct: groceryCountry.US?.impl_addressable_pct, avg_ticket_usd: groceryCountry.US?.impl_avg_ticket_usd }, subscription: { addressable_pct: groceryCountry.US?.sub_addressable_pct, arpu_monthly_usd: groceryCountry.US?.sub_arpu_monthly_usd } },
    },
    feasibility: groceryFeas,
  },
};

// Hardcode scoring config (matching scoring.yml)
const scoringCfg = {
  impact: { subscription_horizon_years: 3, normalization: { method: 'quantile' }, mode_options: [] },
  feasibility: {
    scale: 10,
    weights: { need_perception: 0.30, hw_gap: 0.25, similar_clients_exist: 0.20, bms_penetration_effect: 0.10, sustainment_upside: 0.15 },
    hw_gap: { invert: true },
    bms_penetration_effect: { by_mode: { subscription_only: 'positive', implementation_only: 'negative', full: 'mixed' } },
  },
  countries_filter: { default: 'all', aggregation: 'sum' },
  display: { axis_fit: { mode: 'auto', padding: 0.5 }, quadrant_thresholds: { mode: 'median', impact: 5.5, feasibility: 5.5 }, point_size: { mode: 'uniform' }, quadrant_labels: { high_impact_high_feas: 'Go now', low_impact_high_feas: 'Quick wins', high_impact_low_feas: 'Build to win', low_impact_low_feas: 'Park' } },
};

console.log('\n--- computeImpactUsd ---');
const impactUsd = scoring.computeImpactUsd(groceryProfile, 'full', 'all', scoringCfg);
console.log('grocery impact USD (full, all):', impactUsd);

console.log('\n--- computeFeasibility ---');
const feas = scoring.computeFeasibility(groceryProfile, 'full', 'all', scoringCfg);
console.log('grocery feasibility (full, all):', feas);

const feasCl = scoring.computeFeasibility(groceryProfile, 'full', 'CL', scoringCfg);
console.log('grocery feasibility (full, CL):', feasCl);

console.log('\n--- feasibilityInputsForCountry ---');
const fiAll = scoring.feasibilityInputsForCountry(groceryProfile, 'all');
console.log('inputs all:', fiAll);
const fiCl = scoring.feasibilityInputsForCountry(groceryProfile, 'CL');
console.log('inputs CL:', fiCl);

console.log('\nAll runtime checks complete.');
