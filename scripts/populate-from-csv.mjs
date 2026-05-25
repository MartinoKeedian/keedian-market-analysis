// Populate docs/data/profiles/<id>.yml with the parsed XLSX data + preliminary
// estimates for the gaps (per-country sites, addressable, ticket, ARPU, and the
// non-need_perception feasibility inputs).
//
// Source: 01_G2M2026_Energy_PrioritizationMap_v01.csv (NA-focused, 18 profiles)
// + matrix screenshot (4 additional profiles: bank_branches,
//   customer_service_branches, spas_beauty, data_centers).
//
// All values flagged `preliminary` are estimates by Claude based on Keedian's
// HVAC / Refrigeration / Lighting / Energy product footprint. Iterate in the
// UI or by editing the YAMLs directly.
//
// Conventions:
//   - need_perception derived from CSV Attractiveness Score: A × 2 (capped at 10).
//   - bms_penetration.value mapped from textual BMS levels:
//       Bajo=2, Bajo-Medio=3, Medio=5, Medio-Alto=7, Alto=8, Muy alto=9-10.
//   - market_concentration: muy fragmentado/fragmentado → "fragmented",
//                           mixto → "mixed",
//                           muy concentrado/concentrado → "concentrated".
//   - MX sites ≈ 10% of US, CL sites ≈ 1% of US (overridable per profile).
//   - MX cost ratios: ticket 0.80×US, ARPU 0.75×US. CL: ticket 0.85×US, ARPU 0.85×US.

import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILES = join(ROOT, 'docs', 'data', 'profiles');

// Per-profile inputs. Numbers are preliminary unless noted.
// Sites: US is from CSV "# Sites para cálculo"; CL/MX use ratios below.
// impl/sub: addressable %, ticket USD, ARPU USD monthly — all US baseline.
const data = [
  {
    id: 'grocery',
    display_name: 'Supermarkets / Grocery',
    kp_segment_id: 'grocery',
    sqft: { low: 16000, high: 65000, nominal: 40000 },
    concentration: { value: 'mixed', notes: 'Top chains strong, fragmented long tail.' },
    bms: { value: 7, notes: 'Most have legacy refrigeration BMS (Emerson, CPC).' },
    pain_points: ['Refrigeration downtime → product loss', 'HVAC + lighting energy spend', 'HACCP / FDA compliance'],
    sites_us: 300000,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 20, ticket: 22000 },
    sub: { addr: 35, arpu: 380 },
    feas: { need: 10, hw_gap: 1, sim: 10, bms_eff: 7, sust: 8 },
  },
  {
    id: 'cstore',
    display_name: 'Convenience Stores (no fuel)',
    kp_segment_id: 'cstore',
    sqft: { low: 860, high: 2700, nominal: 1700 },
    concentration: { value: 'fragmented', notes: 'Very fragmented; few national chains, mostly mom-and-pop.' },
    bms: { value: 3, notes: 'Low to medium — small format, minimal automation.' },
    pain_points: ['Refrigeration uptime', 'Lighting energy spend', 'HVAC comfort'],
    sites_us: 50000,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 25, ticket: 8000 },
    sub: { addr: 30, arpu: 160 },
    feas: { need: 8, hw_gap: 2, sim: 8, bms_eff: 3, sust: 4 },
  },
  {
    id: 'cstore_fuel',
    display_name: 'Gas Stations + C-Stores',
    kp_segment_id: null,
    sqft: { low: 1000, high: 3200, nominal: 2000 },
    concentration: { value: 'fragmented', notes: 'Fragmented overall; top chains (7-Eleven, Circle K) very strong.' },
    bms: { value: 5, notes: 'Medium — varies by chain; top brands instrument.' },
    pain_points: ['Refrigeration 24/7', 'Lighting 24/7', 'HVAC', 'Fuel systems monitoring'],
    sites_us: 170000,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 20, ticket: 10000 },
    sub: { addr: 30, arpu: 200 },
    feas: { need: 10, hw_gap: 3, sim: 5, bms_eff: 5, sust: 5 },
  },
  {
    id: 'foodservice',
    display_name: 'Restaurant Chains (QSR / Fast Casual)',
    kp_segment_id: 'foodservice',
    sqft: { low: 1600, high: 6500, nominal: 3500 },
    concentration: { value: 'concentrated', notes: 'Brand-led; franchisee rollup.' },
    bms: { value: 5, notes: 'Mixed; varies by brand.' },
    pain_points: ['Kitchen equipment uptime', 'HVAC comfort', 'Refrigeration', 'Food safety compliance'],
    sites_us: 150000,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 20, ticket: 15000 },
    sub: { addr: 30, arpu: 280 },
    feas: { need: 10, hw_gap: 2, sim: 8, bms_eff: 5, sust: 5 },
  },
  {
    id: 'pharmacy',
    display_name: 'Pharmacy Chains',
    kp_segment_id: null,
    sqft: { low: 2150, high: 8600, nominal: 5000 },
    concentration: { value: 'concentrated', notes: 'CVS, Walgreens, Walmart Rx dominate.' },
    bms: { value: 5, notes: 'Medium; chain-level standardization.' },
    pain_points: ['HVAC comfort', 'Refrigeration (vaccines / cold chain)', 'Extended hours energy spend'],
    sites_us: 100000,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 20, ticket: 16000 },
    sub: { addr: 30, arpu: 300 },
    feas: { need: 10, hw_gap: 2, sim: 4, bms_eff: 5, sust: 5 },
  },
  {
    id: 'big_box',
    display_name: 'Department Stores / Home Improvement',
    kp_segment_id: 'big_box',
    sqft: { low: 54000, high: 215000, nominal: 120000 },
    concentration: { value: 'concentrated', notes: 'Home Depot, Lowe’s, Target, Walmart, Macy’s.' },
    bms: { value: 7, notes: 'Most have BMS; some legacy Honeywell / Siemens.' },
    pain_points: ['HVAC across large floorplate', 'Lighting energy spend', 'Sustainability reporting'],
    sites_us: 11000,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 15, ticket: 60000 },
    sub: { addr: 30, arpu: 850 },
    feas: { need: 10, hw_gap: 3, sim: 4, bms_eff: 7, sust: 8 },
  },
  {
    id: 'hotels',
    display_name: 'Hotels',
    kp_segment_id: null,
    sqft: { low: 21500, high: 320000, nominal: 80000 },
    concentration: { value: 'mixed', notes: 'Brands concentrated (Marriott, Hilton); property ownership fragmented.' },
    bms: { value: 7, notes: 'Most branded hotels have BMS; mid-tier mixed.' },
    pain_points: ['Room HVAC control', 'Hot water (ACS)', 'Common-area lighting'],
    sites_us: 55000,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 10, ticket: 45000 },
    sub: { addr: 25, arpu: 700 },
    feas: { need: 8, hw_gap: 4, sim: 3, bms_eff: 7, sust: 7 },
  },
  {
    id: 'distribution',
    display_name: 'Distribution Centers',
    kp_segment_id: null,
    sqft: { low: 108000, high: 1615000, nominal: 300000 },
    concentration: { value: 'mixed', notes: 'Amazon-scale players + many regional 3PLs.' },
    bms: { value: 7, notes: 'Most modern DCs instrumented; legacy ones less so.' },
    pain_points: ['Lighting energy across huge floorplate', 'Cold storage refrigeration', 'HVAC for picker areas'],
    sites_us: 40000,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 15, ticket: 50000 },
    sub: { addr: 25, arpu: 750 },
    feas: { need: 8, hw_gap: 4, sim: 4, bms_eff: 7, sust: 6 },
  },
  {
    id: 'malls',
    display_name: 'Malls / Shopping Centers',
    kp_segment_id: null,
    sqft: { low: 215000, high: 1615000, nominal: 500000 },
    concentration: { value: 'mixed', notes: 'Few REITs control most large malls; strip centers fragmented.' },
    bms: { value: 6, notes: 'High in large malls, medium in strip centers.' },
    pain_points: ['Common-area HVAC', 'Lighting', 'Anchor tenants with refrigeration'],
    sites_us: 7500,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 10, ticket: 70000 },
    sub: { addr: 25, arpu: 1100 },
    feas: { need: 8, hw_gap: 5, sim: 3, bms_eff: 6, sust: 7 },
  },
  {
    id: 'offices',
    display_name: 'Corporate Offices',
    kp_segment_id: 'offices',
    sqft: { low: 5400, high: 1076000, nominal: 50000 },
    concentration: { value: 'fragmented', notes: 'Class A buildings concentrated; rest very fragmented.' },
    bms: { value: 6, notes: 'High in Class A; mixed below.' },
    pain_points: ['HVAC comfort', 'Lighting', 'Vacancy / IAQ in hybrid era'],
    sites_us: 500000,
    sites_mx_pct: 8, sites_cl_pct: 1,
    impl: { addr: 8, ticket: 30000 },
    sub: { addr: 20, arpu: 500 },
    feas: { need: 6, hw_gap: 3, sim: 5, bms_eff: 6, sust: 6 },
  },
  {
    id: 'universities',
    display_name: 'Universities / Campuses',
    kp_segment_id: null,
    sqft: { low: 538000, high: 5380000, nominal: 1500000 },
    concentration: { value: 'fragmented', notes: 'Each institution is its own buyer.' },
    bms: { value: 7, notes: 'Most R1 universities instrumented; smaller colleges less so.' },
    pain_points: ['HVAC across many buildings', 'Lab equipment energy', 'ESG / sustainability reporting'],
    sites_us: 5600,
    sites_mx_pct: 15, sites_cl_pct: 2,
    impl: { addr: 12, ticket: 120000 },
    sub: { addr: 25, arpu: 1800 },
    feas: { need: 6, hw_gap: 5, sim: 3, bms_eff: 7, sust: 8 },
  },
  {
    id: 'hospitals_public',
    display_name: 'Public Hospitals',
    kp_segment_id: null,
    sqft: { low: 215000, high: 2150000, nominal: 600000 },
    concentration: { value: 'mixed', notes: 'US fragmented across state networks; CA centralized.' },
    bms: { value: 9, notes: 'Very high — life-critical, mandatory.' },
    pain_points: ['HVAC critical zones (OR, ICU)', '24/7 operation', 'Regulatory compliance'],
    sites_us: 6500,
    sites_mx_pct: 15, sites_cl_pct: 2,
    impl: { addr: 8, ticket: 150000 },
    sub: { addr: 20, arpu: 2200 },
    feas: { need: 6, hw_gap: 7, sim: 2, bms_eff: 9, sust: 9 },
  },
  {
    id: 'clinics_private',
    display_name: 'Private Clinics',
    kp_segment_id: null,
    sqft: { low: 2150, high: 21500, nominal: 8000 },
    concentration: { value: 'fragmented', notes: 'Tens of thousands of independent practices.' },
    bms: { value: 3, notes: 'Low to medium — small format, minimal automation.' },
    pain_points: ['HVAC for sensitive equipment', 'Patient comfort'],
    sites_us: 20000,
    sites_mx_pct: 12, sites_cl_pct: 1.5,
    impl: { addr: 15, ticket: 12000 },
    sub: { addr: 20, arpu: 200 },
    feas: { need: 4, hw_gap: 4, sim: 3, bms_eff: 3, sust: 3 },
  },
  {
    id: 'coworks',
    display_name: 'Coworks',
    kp_segment_id: null,
    sqft: { low: 5400, high: 54000, nominal: 18000 },
    concentration: { value: 'fragmented', notes: 'WeWork-scale players plus many local operators.' },
    bms: { value: 5, notes: 'Depends on landlord; varies widely.' },
    pain_points: ['HVAC comfort across meeting rooms', 'Lighting'],
    sites_us: 9000,
    sites_mx_pct: 10, sites_cl_pct: 2,
    impl: { addr: 15, ticket: 15000 },
    sub: { addr: 20, arpu: 250 },
    feas: { need: 4, hw_gap: 2, sim: 3, bms_eff: 5, sust: 3 },
  },
  {
    id: 'gyms',
    display_name: 'Gyms / Fitness Centers',
    kp_segment_id: null,
    sqft: { low: 4300, high: 54000, nominal: 15000 },
    concentration: { value: 'mixed', notes: 'Planet Fitness / Anytime Fitness at scale; boutique fragmented.' },
    bms: { value: 5, notes: 'Medium; chain-dependent.' },
    pain_points: ['HVAC intensive use', 'Lighting'],
    sites_us: 45000,
    sites_mx_pct: 8, sites_cl_pct: 1,
    impl: { addr: 15, ticket: 18000 },
    sub: { addr: 25, arpu: 300 },
    feas: { need: 6, hw_gap: 3, sim: 3, bms_eff: 5, sust: 4 },
  },
  {
    id: 'cinemas',
    display_name: 'Theaters & Cinemas',
    kp_segment_id: null,
    sqft: { low: 10800, high: 54000, nominal: 25000 },
    concentration: { value: 'concentrated', notes: 'AMC, Regal, Cinemark account for most rooms.' },
    bms: { value: 5, notes: 'Medium.' },
    pain_points: ['HVAC during high-occupancy events', 'Lighting', 'Comfort'],
    sites_us: 43000,
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 12, ticket: 25000 },
    sub: { addr: 25, arpu: 400 },
    feas: { need: 6, hw_gap: 3, sim: 3, bms_eff: 5, sust: 5 },
  },
  {
    id: 'convention',
    display_name: 'Convention Centers',
    kp_segment_id: null,
    sqft: { low: 215000, high: 1076000, nominal: 400000 },
    concentration: { value: 'fragmented', notes: 'Mostly municipally owned; each one is its own buyer.' },
    bms: { value: 8, notes: 'High in large centers.' },
    pain_points: ['HVAC for variable occupancy', 'Lighting', 'Water systems'],
    sites_us: 1200,
    sites_mx_pct: 8, sites_cl_pct: 1,
    impl: { addr: 10, ticket: 80000 },
    sub: { addr: 20, arpu: 1200 },
    feas: { need: 6, hw_gap: 5, sim: 2, bms_eff: 8, sust: 7 },
  },
  {
    id: 'small_retail',
    display_name: 'Small & Medium Stores',
    kp_segment_id: 'small_retail',
    sqft: { low: 540, high: 5400, nominal: 2000 },
    concentration: { value: 'fragmented', notes: 'Millions of small operators; no national play.' },
    bms: { value: 2, notes: 'Low — small format, no automation.' },
    pain_points: ['HVAC comfort', 'Lighting'],
    sites_us: 1500000,
    sites_mx_pct: 12, sites_cl_pct: 1.5,
    impl: { addr: 10, ticket: 5000 },
    sub: { addr: 15, arpu: 100 },
    feas: { need: 3, hw_gap: 2, sim: 5, bms_eff: 2, sust: 2 },
  },

  // Matrix-only profiles (not in CSV). Values inferred from matrix screenshot position
  // — all preliminary, all flagged.
  {
    id: 'bank_branches',
    display_name: 'Bank branches',
    kp_segment_id: 'bank_branches',
    sqft: { low: 2000, high: 8000, nominal: 4000 },
    concentration: { value: 'concentrated', notes: 'Top 10 banks own most branches; community banks long tail.' },
    bms: { value: 7, notes: 'Most major banks have BMS; uneven across regional players.' },
    pain_points: ['HVAC comfort', 'UPS / power quality', 'Physical security overlap'],
    sites_us: 80000,
    sites_mx_pct: 10, sites_cl_pct: 1.5,
    impl: { addr: 15, ticket: 20000 },
    sub: { addr: 30, arpu: 350 },
    feas: { need: 8, hw_gap: 3, sim: 3, bms_eff: 7, sust: 7 },
  },
  {
    id: 'customer_service_branches',
    display_name: 'Customer service branches',
    kp_segment_id: null,
    sqft: { low: 2000, high: 15000, nominal: 6000 },
    concentration: { value: 'mixed', notes: 'Telco / utility customer-facing offices.' },
    bms: { value: 6, notes: 'Medium-high; varies by parent company.' },
    pain_points: ['HVAC for service halls', 'Lighting', 'Queue area comfort'],
    sites_us: 30000,
    sites_mx_pct: 12, sites_cl_pct: 1.5,
    impl: { addr: 15, ticket: 15000 },
    sub: { addr: 25, arpu: 280 },
    feas: { need: 7, hw_gap: 4, sim: 2, bms_eff: 6, sust: 6 },
  },
  {
    id: 'spas_beauty',
    display_name: 'Spas and beauty',
    kp_segment_id: null,
    sqft: { low: 1500, high: 8000, nominal: 3500 },
    concentration: { value: 'fragmented', notes: 'Mostly independent operators; a few national chains.' },
    bms: { value: 4, notes: 'Low to medium.' },
    pain_points: ['HVAC comfort in treatment rooms', 'Hot water'],
    sites_us: 90000,
    sites_mx_pct: 12, sites_cl_pct: 1.5,
    impl: { addr: 15, ticket: 8000 },
    sub: { addr: 15, arpu: 150 },
    feas: { need: 5, hw_gap: 3, sim: 2, bms_eff: 4, sust: 3 },
  },
  {
    id: 'data_centers',
    display_name: 'Data centers',
    kp_segment_id: null,
    sqft: { low: 50000, high: 500000, nominal: 150000 },
    concentration: { value: 'concentrated', notes: 'Hyperscalers (AWS, Azure, GCP) plus colocation (Equinix, Digital Realty).' },
    bms: { value: 10, notes: 'Very high — mission-critical, instrumented end-to-end.' },
    pain_points: ['Cooling (CRAC) optimization', 'PUE reporting', 'Power redundancy'],
    sites_us: 2700,
    sites_mx_pct: 8, sites_cl_pct: 1.5,
    impl: { addr: 10, ticket: 100000 },
    sub: { addr: 30, arpu: 1500 },
    feas: { need: 5, hw_gap: 7, sim: 2, bms_eff: 10, sust: 8 },
  },
];

// ---------- write each profile YAML ----------

function round(n) {
  if (n < 100) return Math.round(n);
  if (n < 10000) return Math.round(n / 10) * 10;
  return Math.round(n / 100) * 100;
}

function ratioSites(usSites, pct) {
  return round(usSites * pct / 100);
}

function ratioTicket(usTicket, factor) {
  return round(usTicket * factor);
}

function buildYaml(p) {
  const us = {
    sites: { low: round(p.sites_us * 0.95), high: round(p.sites_us * 1.05), nominal: p.sites_us },
    impl: { addr: p.impl.addr, ticket: p.impl.ticket },
    sub: { addr: p.sub.addr, arpu: p.sub.arpu },
  };
  const mx = {
    sites: {
      low: ratioSites(p.sites_us, p.sites_mx_pct * 0.85),
      high: ratioSites(p.sites_us, p.sites_mx_pct * 1.15),
      nominal: ratioSites(p.sites_us, p.sites_mx_pct),
    },
    impl: { addr: p.impl.addr, ticket: ratioTicket(p.impl.ticket, 0.80) },
    sub: { addr: p.sub.addr, arpu: ratioTicket(p.sub.arpu, 0.75) },
  };
  const cl = {
    sites: {
      low: ratioSites(p.sites_us, p.sites_cl_pct * 0.85),
      high: ratioSites(p.sites_us, p.sites_cl_pct * 1.15),
      nominal: ratioSites(p.sites_us, p.sites_cl_pct),
    },
    impl: { addr: p.impl.addr, ticket: ratioTicket(p.impl.ticket, 0.85) },
    sub: { addr: p.sub.addr, arpu: ratioTicket(p.sub.arpu, 0.85) },
  };

  return `# Auto-populated by scripts/populate-from-csv.mjs (preliminary values).
# US numbers grounded in 01_G2M2026_Energy_PrioritizationMap_v01.csv where available.
# Tickets, ARPU, addressable %, and CL/MX sites are estimates — iterate.

id: ${p.id}
display_name: "${p.display_name}"
kp_segment_id: ${p.kp_segment_id ?? 'null'}

preliminary: true                       # remove this flag once you've reviewed all values

inherited_cache:
  source: null                          # populated by .github/workflows/sync-kp.yml
  _synced_at: null

market_analysis:
  typical_site_sqft:
    low: ${p.sqft.low}
    high: ${p.sqft.high}
    nominal: ${p.sqft.nominal}

  market_concentration:
    value: ${p.concentration.value}
    notes: "${p.concentration.notes}"

  bms_penetration:
    value: ${p.bms.value}
    notes: "${p.bms.notes}"

  pain_points:
${p.pain_points.map((pt) => `    - "${pt}"`).join('\n')}

  by_country:
    CL:
      sites:           { low: ${cl.sites.low}, high: ${cl.sites.high}, nominal: ${cl.sites.nominal} }
      implementation:  { addressable_pct: ${cl.impl.addr}, avg_ticket_usd: ${cl.impl.ticket} }
      subscription:    { addressable_pct: ${cl.sub.addr}, arpu_monthly_usd: ${cl.sub.arpu} }
    MX:
      sites:           { low: ${mx.sites.low}, high: ${mx.sites.high}, nominal: ${mx.sites.nominal} }
      implementation:  { addressable_pct: ${mx.impl.addr}, avg_ticket_usd: ${mx.impl.ticket} }
      subscription:    { addressable_pct: ${mx.sub.addr}, arpu_monthly_usd: ${mx.sub.arpu} }
    US:
      sites:           { low: ${us.sites.low}, high: ${us.sites.high}, nominal: ${us.sites.nominal} }
      implementation:  { addressable_pct: ${us.impl.addr}, avg_ticket_usd: ${us.impl.ticket} }
      subscription:    { addressable_pct: ${us.sub.addr}, arpu_monthly_usd: ${us.sub.arpu} }

  feasibility_inputs:
    need_perception: ${p.feas.need}
    delivery_capacity:
      hw_gap: ${p.feas.hw_gap}
      similar_clients_exist: ${p.feas.sim}
      bms_penetration_effect: ${p.feas.bms_eff}
      sustainment_upside: ${p.feas.sust}

  validation_status:
    by_country.CL: preliminary
    by_country.MX: preliminary
    by_country.US.implementation: preliminary
    by_country.US.subscription: preliminary
    feasibility_inputs.delivery_capacity: preliminary
`;
}

let written = 0;
for (const p of data) {
  const out = join(PROFILES, `${p.id}.yml`);
  writeFileSync(out, buildYaml(p), 'utf-8');
  written += 1;
}
console.log(`Wrote ${written} profile YAMLs to ${PROFILES}`);
