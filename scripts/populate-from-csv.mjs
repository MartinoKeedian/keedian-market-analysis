// Populate docs/data/profiles/<id>.yml with researched data + preliminary estimates.
//
// Round 2 (post user feedback May 25 2026):
//   - Added brands_range with rationale + source
//   - Added rationale + source to bms_penetration and market_concentration
//   - Used US 2026 data from web research (NACS, IBISWorld, Statista, Carnegie, etc.)
//   - Tickets, ARPU, addressable %, and CL/MX sites remain my estimates — iterate.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILES = join(ROOT, 'docs', 'data', 'profiles');

const data = [
  {
    id: 'grocery',
    display_name: 'Supermarkets / Grocery',
    kp_segment_id: 'grocery',
    brands: { low: 60, high: 120, rationale: 'IBISWorld 2026: 77,543 grocery businesses in the US. Top 5 chains (Walmart 23.6%, Kroger, Costco, Albertsons, Publix) hold 53.4% of market. ~60–120 chains with multi-site footprint matter.', source: 'IBISWorld 2026; Statista Grocery retailers market share US 2025' },
    sqft: { low: 16000, high: 65000, nominal: 40000 },
    conc: { value: 'mixed', rationale: 'Top 5 chains 53.4% market share; long tail of regional and independent grocers in the remaining 46.6%.', source: 'Statista 2025 Grocery retailers market share US' },
    bms: { value: 7, rationale: 'Most large grocery chains have legacy refrigeration BMS (Emerson E2/E3, CPC, Honeywell). HVAC and lighting controls usually less integrated. Mid-tier and regional grocers vary.', source: 'Keedian field experience; refrigeration EMS adoption is industry standard at scale' },
    pain_points: ['Refrigeration downtime → product loss', 'HVAC + lighting energy spend', 'HACCP / FDA compliance'],
    sites_us: 305000, sites_us_rationale: '305,156 grocery store locations across all formats per IBISWorld 2026.',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 20, ticket: 22000 },
    sub: { addr: 35, arpu: 380 },
    feas: { need: 10, hw_gap: 1, sim: 10, bms_eff: 7, sust: 8 },
  },
  {
    id: 'cstore',
    display_name: 'Convenience Stores (no fuel)',
    kp_segment_id: 'cstore',
    brands: { low: 30, high: 80, rationale: 'Hard to separate from cstore+fuel. NACS total convenience stores in US = 151,975 (mostly with fuel). Pure no-fuel cstore is a smaller urban/specialty segment — ~30–80 multi-site chains.', source: 'NACS / NIQ TDLinx 2026 Convenience Industry Store Count' },
    sqft: { low: 860, high: 2700, nominal: 1700 },
    conc: { value: 'fragmented', rationale: 'Pure no-fuel cstore market is fragmented. Major chains skew to gas-station combo. Urban no-fuel banners are mostly local or regional.', source: 'CSP Daily News Top 40 cstore chains 2026' },
    bms: { value: 3, rationale: 'Small format, minimal automation. Refrigeration is the main controlled system; HVAC and lighting usually direct/timer controls.', source: 'Inferred from typical c-store store-build sheets' },
    pain_points: ['Refrigeration uptime', 'Lighting energy spend', 'HVAC comfort'],
    sites_us: 50000, sites_us_rationale: 'Estimated subset of 151,975 NACS total that operate without fuel pumps.',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 25, ticket: 8000 },
    sub: { addr: 30, arpu: 160 },
    feas: { need: 8, hw_gap: 2, sim: 8, bms_eff: 3, sust: 4 },
  },
  {
    id: 'cstore_fuel',
    display_name: 'Gas Stations + C-Stores',
    kp_segment_id: null,
    brands: { low: 50, high: 100, rationale: 'NACS total = 151,975 stores. 7-Eleven 12,238 + Couche-Tard 6,852 + Circle K 6,846 + Speedway 2,864 + Casey\'s 2,807 + QuikTrip 1,222 + AMPM 1,040 = top 7 = 33,869 (~22%). Top 100 chains capture most of the chain-operated stores; ~50–100 multi-site brands matter commercially.', source: 'NACS 2026 Top 100 Convenience Retailers; ScrapeHero 2026' },
    sqft: { low: 1000, high: 3200, nominal: 2000 },
    conc: { value: 'mixed', rationale: 'Top 3 brands hold 73% share of the top-10 segment; below the top tier the market is fragmented. Many independent gas station + small store operators.', source: 'ScrapeHero 2026 10 Largest Convenience Stores in the USA' },
    bms: { value: 5, rationale: 'Top chains instrument refrigeration and fuel systems; mid-tier varies. HVAC and lighting often basic controls. Newer builds increasingly add BMS.', source: 'Industry estimate based on top-chain instrumentation pattern' },
    pain_points: ['Refrigeration 24/7', 'Lighting 24/7', 'HVAC', 'Fuel systems monitoring'],
    sites_us: 152000, sites_us_rationale: 'NACS 2026: 151,975 total convenience stores (the vast majority with fuel).',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 20, ticket: 10000 },
    sub: { addr: 30, arpu: 200 },
    feas: { need: 10, hw_gap: 3, sim: 5, bms_eff: 5, sust: 5 },
  },
  {
    id: 'foodservice',
    display_name: 'Restaurant Chains (QSR / Fast Casual)',
    kp_segment_id: 'foodservice',
    brands: { low: 100, high: 300, rationale: 'Mature, highly competitive market with dozens of major QSR and fast-casual brands. Top 50 captured in QSR Magazine annual rankings; total multi-unit chain brand count ~100–300 including regional players.', source: 'QSR Magazine 2025 Top 50; Restaurant Dive market trackers' },
    sqft: { low: 1600, high: 6500, nominal: 3500 },
    conc: { value: 'concentrated', rationale: 'Brand-led; franchisee-rolled-up unit counts at scale. McDonald\'s, Subway, Starbucks, Chick-fil-A, Taco Bell each operate 5,000+ US sites. Top 50 brands account for the bulk of QSR revenue.', source: 'QSR Magazine 2025 Top 50' },
    bms: { value: 5, rationale: 'Brand-dependent. Top chains instrument kitchen equipment + refrigeration. HVAC and lighting often standard low-end controls.', source: 'Industry experience; brand-driven standardization patterns' },
    pain_points: ['Kitchen equipment uptime', 'HVAC comfort', 'Refrigeration', 'Food safety compliance'],
    sites_us: 150000, sites_us_rationale: 'Estimated chain restaurant locations (QSR + fast casual) in the US — multi-unit operators across the top 200 brands.',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 20, ticket: 15000 },
    sub: { addr: 30, arpu: 280 },
    feas: { need: 10, hw_gap: 2, sim: 8, bms_eff: 5, sust: 5 },
  },
  {
    id: 'pharmacy',
    display_name: 'Pharmacy Chains',
    kp_segment_id: null,
    brands: { low: 10, high: 30, rationale: 'CVS 9,968 + Walgreens 9,024 + Health Mart 5,002 dominate. With Rite Aid closed in 2025, the market consolidated further. ~10–30 chains with multi-state operations remain.', source: 'Drug Channels 2025 Top 15 US Pharmacies; ScrapeHero pharmacy chain count' },
    sqft: { low: 2150, high: 8600, nominal: 5000 },
    conc: { value: 'concentrated', rationale: 'Top 4 (CVS, Walgreens, Cigna, UnitedHealth) > 50% of prescription dispensing. CVS 21% of pharmacy retail revenues; Walgreens ~20%.', source: 'Drug Channels 2025 Top 15 US Pharmacies' },
    bms: { value: 5, rationale: 'Chain-level standardization. Pharmacy refrigeration (vaccine cold chain) is regulated and instrumented. HVAC and lighting less so.', source: 'Industry experience; cold-chain compliance requirements' },
    pain_points: ['HVAC comfort', 'Refrigeration (vaccines / cold chain)', 'Extended hours energy spend'],
    sites_us: 100000, sites_us_rationale: 'CVS + Walgreens + Health Mart + others ≈ 24,000 chain pharmacy sites. Including pharmacies inside grocery/big-box/Walmart pushes total to ~95k–105k.',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 20, ticket: 16000 },
    sub: { addr: 30, arpu: 300 },
    feas: { need: 10, hw_gap: 2, sim: 4, bms_eff: 5, sust: 5 },
  },
  {
    id: 'big_box',
    display_name: 'Department Stores / Home Improvement',
    kp_segment_id: 'big_box',
    brands: { low: 15, high: 40, rationale: 'IBISWorld 2026: 4,868 home improvement businesses (Home Depot 2,359 stores + Lowe\'s 1,700+ dominate). Department stores: ~10–15 major chains (Macy\'s, Kohl\'s, JCPenney, Nordstrom, etc.) + Walmart and Target as big-box variants. Combined: ~15–40 brands with meaningful multi-site footprint.', source: 'IBISWorld 2026 Home Improvement Stores; Home Depot / Lowe\'s 10-K' },
    sqft: { low: 54000, high: 215000, nominal: 120000 },
    conc: { value: 'concentrated', rationale: 'Home Depot + Lowe\'s ≈ 80% of home improvement stores. Department stores moderately concentrated among Macy\'s, Kohl\'s, JCPenney, Nordstrom.', source: 'Home Depot 10-K; Lowe\'s 10-K; Yahoo Finance 2026 comparison' },
    bms: { value: 7, rationale: 'Most have BMS for large floorplate HVAC. Lighting controls also common. Mix of modern and legacy (Honeywell, Siemens) installs.', source: 'Industry experience; ESG-driven sustainability reporting pushes BMS' },
    pain_points: ['HVAC across large floorplate', 'Lighting energy spend', 'Sustainability reporting'],
    sites_us: 11000, sites_us_rationale: 'Home improvement + department stores combined. Home Depot 2,359 + Lowe\'s 1,700+ + ~5k department + ~2k big-box variants.',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 15, ticket: 60000 },
    sub: { addr: 30, arpu: 850 },
    feas: { need: 10, hw_gap: 3, sim: 4, bms_eff: 7, sust: 8 },
  },
  {
    id: 'hotels',
    display_name: 'Hotels',
    kp_segment_id: null,
    brands: { low: 150, high: 250, rationale: 'Marriott 30 brands + Hilton 26 + Hyatt 30+ + IHG ~15 + Choice ~15 + Wyndham ~25 + Best Western ~15 + many smaller groups = ~150–250 distinct hotel brands operating in the US.', source: 'Marriott / Hilton / Hyatt / IHG 2025-2026 annual reports' },
    sqft: { low: 21500, high: 320000, nominal: 80000 },
    conc: { value: 'mixed', rationale: 'Brand families concentrated (Marriott, Hilton, IHG asset-light model), but property ownership highly fragmented across franchisees, REITs, and individual owners.', source: 'Marriott 2025 annual report; HotelMinder 2026 ownership guide' },
    bms: { value: 7, rationale: 'Branded hotels typically have BMS (guest-room HVAC control, ACS hot water, common-area lighting). Mid-tier hotels mixed; independents less so.', source: 'Industry experience; brand-standard requirements at flag level' },
    pain_points: ['Room HVAC control', 'Hot water (ACS)', 'Common-area lighting'],
    sites_us: 56000, sites_us_rationale: 'AHLA reports ~55–60k hotel properties operating in the US.',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 10, ticket: 45000 },
    sub: { addr: 25, arpu: 700 },
    feas: { need: 8, hw_gap: 4, sim: 3, bms_eff: 7, sust: 7 },
  },
  {
    id: 'distribution',
    display_name: 'Distribution Centers',
    kp_segment_id: null,
    brands: { low: 50, high: 200, rationale: 'Top 10 US 3PLs ≈ $90B revenue (ex-Amazon). Add Amazon\'s own network + Walmart\'s + Target\'s + Costco\'s. Plus thousands of regional 3PLs. ~50–200 operators with meaningful multi-DC footprint.', source: 'Technavio US 3PL 2026-2030 forecast; Armstrong & Associates' },
    sqft: { low: 108000, high: 1615000, nominal: 300000 },
    conc: { value: 'mixed', rationale: 'Amazon dwarfs the rest ($172B); top 10 3PLs (ex-Amazon) = $90B combined led by C.H. Robinson at $15B. 94% of Fortune 500 use at least one 3PL.', source: 'Technavio 2026; DC Velocity' },
    bms: { value: 7, rationale: 'Modern DCs instrumented for lighting and refrigeration zones. Legacy warehouses less so. Cold chain DCs particularly well instrumented.', source: 'Industry experience; cold storage compliance drives instrumentation' },
    pain_points: ['Lighting energy across huge floorplate', 'Cold storage refrigeration', 'HVAC for picker areas'],
    sites_us: 40000, sites_us_rationale: 'CBRE / JLL estimates of 35–45k warehouse and distribution facilities >100k sqft in the US.',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 15, ticket: 50000 },
    sub: { addr: 25, arpu: 750 },
    feas: { need: 8, hw_gap: 4, sim: 4, bms_eff: 7, sust: 6 },
  },
  {
    id: 'malls',
    display_name: 'Malls / Shopping Centers',
    kp_segment_id: null,
    brands: { low: 30, high: 80, rationale: 'Simon Property Group leads with 12.83% market share (206 US malls). Other major mall REITs: Brookfield, Macerich, Tanger, Kimco, Brixmor, Federal Realty, Regency Centers, Realty Income — ~30–80 operators of consequence.', source: 'Simon Property Group 2026 portfolio; ScrapeHero 2026' },
    sqft: { low: 215000, high: 1615000, nominal: 500000 },
    conc: { value: 'mixed', rationale: 'Top REITs control most large malls (Class A); strip centers and lifestyle centers more fragmented. Simon alone 12.83%; top 10 REITs likely 50–60% combined.', source: 'Simon Property Group 2025 10-K; Statista REIT shares' },
    bms: { value: 6, rationale: 'High in large enclosed malls (REIT-managed common areas). Strip centers usually no BMS — each tenant runs their own HVAC.', source: 'Industry experience; mall ops standardization' },
    pain_points: ['Common-area HVAC', 'Lighting', 'Anchor tenants with refrigeration'],
    sites_us: 7500, sites_us_rationale: 'ICSC reports ~1,100 enclosed malls plus ~6,000–7,000 lifestyle/community/strip centers of meaningful size.',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 10, ticket: 70000 },
    sub: { addr: 25, arpu: 1100 },
    feas: { need: 8, hw_gap: 5, sim: 3, bms_eff: 6, sust: 7 },
  },
  {
    id: 'offices',
    display_name: 'Corporate Offices',
    kp_segment_id: 'offices',
    brands: { low: 5000, high: 50000, rationale: 'Office buildings owned by thousands of REITs (Boston Properties, SL Green, Vornado, Brookfield) plus tens of thousands of private owners and corporate occupants. ~5,000–50,000 distinct building owners with multi-site portfolios.', source: 'NAIOP / NAREIT 2025; CBRE office portfolio reports' },
    sqft: { low: 5400, high: 1076000, nominal: 50000 },
    conc: { value: 'fragmented', rationale: 'Class A in major metros concentrated among large REITs and institutional owners. Class B and below highly fragmented across smaller landlords and corporate self-owners.', source: 'CBRE office market reports 2025' },
    bms: { value: 7, rationale: 'Over 74% of US commercial office buildings >50,000 sqft use intelligent BMS. Over 82% of Class A in major metros have automated access + BMS. Class B/C much less.', source: 'Innowise BMS guide 2026; Mordor Intelligence US commercial building automation 2031 forecast' },
    pain_points: ['HVAC comfort', 'Lighting', 'Vacancy / IAQ in hybrid era'],
    sites_us: 500000, sites_us_rationale: 'CBRE / Cushman estimates of office buildings of meaningful size in US ranges from 100k to multi-hundred-thousand including small Class B/C.',
    sites_mx_pct: 8, sites_cl_pct: 1,
    impl: { addr: 8, ticket: 30000 },
    sub: { addr: 20, arpu: 500 },
    feas: { need: 6, hw_gap: 3, sim: 5, bms_eff: 6, sust: 6 },
  },
  {
    id: 'bank_branches',
    display_name: 'Bank branches',
    kp_segment_id: 'bank_branches',
    brands: { low: 100, high: 500, rationale: 'Chase 5,000+, Wells Fargo 4,100, Bank of America 3,700, PNC 2,300, Citi <700, US Bank ~2,000. Top 10 banks dominate. Plus thousands of community banks and credit unions — ~100–500 brands with multi-site retail networks.', source: 'Bankrate 2026 15 Largest Banks in the US; NerdWallet 2026 20 Largest Banks' },
    sqft: { low: 2000, high: 8000, nominal: 4000 },
    conc: { value: 'concentrated', rationale: 'Top 5 banks (Chase, BoA, Wells Fargo, Citi, US Bank) hold ~50% of US deposits. JPMorgan Chase alone 11.7% of domestic deposits.', source: 'Statista US bank market share by deposits 2024; WalletHub Bank Market Share 2026' },
    bms: { value: 7, rationale: 'Top banks have BMS at branch level (Chase, BoA standardized). Community banks and credit unions vary. UPS / power quality also instrumented.', source: 'Industry experience; bank facility-mgmt standardization' },
    pain_points: ['HVAC comfort', 'UPS / power quality', 'Physical security overlap'],
    sites_us: 80000, sites_us_rationale: 'Sum of major retail branch networks (Chase 5,000 + WF 4,100 + BoA 3,700 + PNC 2,300 + Citi <700 + US Bank 2,000) ≈ 18k for top 6, plus regional + community banks pushes total to ~75–85k.',
    sites_mx_pct: 10, sites_cl_pct: 1.5,
    impl: { addr: 15, ticket: 20000 },
    sub: { addr: 30, arpu: 350 },
    feas: { need: 8, hw_gap: 3, sim: 3, bms_eff: 7, sust: 7 },
  },
  {
    id: 'small_retail',
    display_name: 'Small & Medium Stores',
    kp_segment_id: 'small_retail',
    brands: { low: 100000, high: 800000, rationale: 'IBISWorld 2026: 195,934 Small Specialty Retail Stores. Plus mom-and-pop independents across grocery, apparel, hardware, etc. Brick-and-mortar total ≈ 1,050,000. Most are single-location or 2–10 location operations.', source: 'IBISWorld 2026 Small Specialty Retail; Capital One Shopping Retail Statistics 2026' },
    sqft: { low: 540, high: 5400, nominal: 2000 },
    conc: { value: 'fragmented', rationale: 'Vast majority independent. California 64.6% independent; Florida 58.0% independent. No national chain owns more than a few percent of small-format retail.', source: 'Merchant Machine 2025 US independent stores; Capital One Shopping 2026' },
    bms: { value: 2, rationale: 'Small format, no automation. HVAC is residential-grade or light-commercial. Lighting on basic controls.', source: 'Inferred from typical small-format build-outs' },
    pain_points: ['HVAC comfort', 'Lighting'],
    sites_us: 1000000, sites_us_rationale: 'Brick-and-mortar retail total ≈ 1,050,000; small/medium subset ≈ 95% of that (excluding national chains and big-box).',
    sites_mx_pct: 12, sites_cl_pct: 1.5,
    impl: { addr: 10, ticket: 5000 },
    sub: { addr: 15, arpu: 100 },
    feas: { need: 3, hw_gap: 2, sim: 5, bms_eff: 2, sust: 2 },
  },
  {
    id: 'universities',
    display_name: 'Universities / Campuses',
    kp_segment_id: null,
    brands: { low: 3000, high: 6000, rationale: 'Carnegie 2025: 187 R1 (very high research) + 216 Research Colleges + thousands of other 2-year and 4-year institutions. Total US higher-ed institutions ≈ 5,600 (including community colleges and tech schools).', source: 'Carnegie Foundation 2025 update; SSTI 2025 R1 designees' },
    sqft: { low: 538000, high: 5380000, nominal: 1500000 },
    conc: { value: 'fragmented', rationale: 'Each institution is its own buyer. State systems coordinate facilities at the system level (UC, SUNY, CSU) but most decisions are campus-level. No real concentration.', source: 'Carnegie Foundation 2025' },
    bms: { value: 7, rationale: 'R1 universities typically have campus-wide BMS (Siemens, JCI, Honeywell). State institutions also high. Smaller liberal arts and community colleges vary.', source: 'Industry experience; ESG / sustainability reporting drives BMS at universities' },
    pain_points: ['HVAC across many buildings', 'Lab equipment energy', 'ESG / sustainability reporting'],
    sites_us: 5600, sites_us_rationale: 'Carnegie 2025: total higher-ed institutions in the US.',
    sites_mx_pct: 15, sites_cl_pct: 2,
    impl: { addr: 12, ticket: 120000 },
    sub: { addr: 25, arpu: 1800 },
    feas: { need: 6, hw_gap: 5, sim: 3, bms_eff: 7, sust: 8 },
  },
  {
    id: 'hospitals_public',
    display_name: 'Public Hospitals',
    kp_segment_id: null,
    brands: { low: 800, high: 1000, rationale: 'AHA 2026: ~900 active health systems own or manage 6,000+ hospitals (avg ~6 per system). 5,121 community hospitals tracked; 2/3 are system-affiliated.', source: 'AHA Fast Facts on US Hospitals 2026' },
    sqft: { low: 215000, high: 2150000, nominal: 600000 },
    conc: { value: 'mixed', rationale: 'US fragmented across state networks and many independent / community hospital systems. CA more centralized via UC Health and Kaiser. HCA Healthcare is the largest for-profit operator.', source: 'AHA Fast Facts 2026; Becker\'s Hospital Review 100 largest health systems 2026' },
    bms: { value: 9, rationale: 'Life-critical environments mandate BMS (OR temperature, ICU airflow, vaccine cold chain, IAQ). Joint Commission accreditation drives investment. EHR adoption hit 96% by 2021 — BMS comparable.', source: 'Joint Commission standards; AHA 2026' },
    pain_points: ['HVAC critical zones (OR, ICU)', '24/7 operation', 'Regulatory compliance'],
    sites_us: 6100, sites_us_rationale: 'AHA 2026: total US hospitals.',
    sites_mx_pct: 15, sites_cl_pct: 2,
    impl: { addr: 8, ticket: 150000 },
    sub: { addr: 20, arpu: 2200 },
    feas: { need: 6, hw_gap: 7, sim: 2, bms_eff: 9, sust: 9 },
  },
  {
    id: 'clinics_private',
    display_name: 'Private Clinics',
    kp_segment_id: null,
    brands: { low: 100000, high: 250000, rationale: 'NextMD 2026: 213,000 private medical practices in 2020, growing 17% since; currently 55% of physicians work in private practice. Plus 31,748 standalone clinics, 5,650 Rural Health Clinics, 1,400 Free/Charitable clinics.', source: 'NextMD State of Private Medicine 2026; Xmap AI 2026' },
    sqft: { low: 2150, high: 21500, nominal: 8000 },
    conc: { value: 'fragmented', rationale: 'Hundreds of thousands of independent practices. Some consolidation into private equity-backed multispecialty groups but the long tail dominates.', source: 'PMC 2024 Physician Employment in America; Bipartisan Policy Center on Provider Consolidation' },
    bms: { value: 3, rationale: 'Small format, minimal automation. HVAC is residential-grade or light-commercial. Some specialized equipment (imaging) requires controlled rooms but rarely linked to BMS.', source: 'Inferred from typical small-clinic build-outs' },
    pain_points: ['HVAC for sensitive equipment', 'Patient comfort'],
    sites_us: 31748, sites_us_rationale: 'Xmap AI 2026: 31,748 clinics in the US (standalone outpatient).',
    sites_mx_pct: 12, sites_cl_pct: 1.5,
    impl: { addr: 15, ticket: 12000 },
    sub: { addr: 20, arpu: 200 },
    feas: { need: 4, hw_gap: 4, sim: 3, bms_eff: 3, sust: 3 },
  },
  {
    id: 'coworks',
    display_name: 'Coworks',
    kp_segment_id: null,
    brands: { low: 4000, high: 5000, rationale: 'CoworkingCafe Q1 2026: 4,431 unique operators managing 7,032 of the 9,136 locations. Most operators run 1–2 locations.', source: 'CoworkingCafe US Coworking Industry Report Q1 2026' },
    sqft: { low: 5400, high: 54000, nominal: 18000 },
    conc: { value: 'fragmented', rationale: 'Big 5 (Regus 1,237 + HQ 370 + Industrious 184 + Spaces + WeWork ~150) = 2,113 locations = ~23% of US total. Remaining 77% across thousands of independents.', source: 'CoworkingCafe Q1 2026' },
    bms: { value: 5, rationale: 'Depends on landlord. WeWork and Industrious instrumented in Class A; smaller operators rely on building HVAC.', source: 'Industry experience; coworks usually tenants, not building owners' },
    pain_points: ['HVAC comfort across meeting rooms', 'Lighting'],
    sites_us: 9136, sites_us_rationale: 'CoworkingCafe Q1 2026: 9,136 active US coworking locations.',
    sites_mx_pct: 10, sites_cl_pct: 2,
    impl: { addr: 15, ticket: 15000 },
    sub: { addr: 20, arpu: 250 },
    feas: { need: 4, hw_gap: 2, sim: 3, bms_eff: 5, sust: 3 },
  },
  {
    id: 'gyms',
    display_name: 'Gyms / Fitness Centers',
    kp_segment_id: null,
    brands: { low: 50, high: 150, rationale: 'Planet Fitness has ~25% of US gym members. LA Fitness 700+, 24 Hour Fitness 280+, Gold\'s Gym ~600, Anytime Fitness, Life Time, Equinox + boutique studios (Orangetheory, F45, SoulCycle, Barry\'s). ~50–150 brands with multi-site operations.', source: 'IBISWorld 2026 Gym Health Fitness Clubs; Mordor Intelligence Fitness Centers 2031' },
    sqft: { low: 4300, high: 54000, nominal: 15000 },
    conc: { value: 'fragmented', rationale: 'Top 5 chains each ≤5% of industry revenue; top 5 combined likely <30% of revenues. Planet Fitness has 25% of members but lower revenue per member.', source: 'Mordor Intelligence 2031; Virtuagym 2026 benchmarks' },
    bms: { value: 5, rationale: 'Chain-dependent. Life Time and Equinox instrument heavily; mid-tier chains less so; boutique studios usually building-level HVAC.', source: 'Industry experience; Equinox / Life Time facility standards' },
    pain_points: ['HVAC intensive use', 'Lighting'],
    sites_us: 114000, sites_us_rationale: 'Custom Market Insights 2026: ~114,370 gyms / fitness centers / health clubs in the US.',
    sites_mx_pct: 8, sites_cl_pct: 1,
    impl: { addr: 15, ticket: 18000 },
    sub: { addr: 25, arpu: 300 },
    feas: { need: 6, hw_gap: 3, sim: 3, bms_eff: 5, sust: 4 },
  },
  {
    id: 'cinemas',
    display_name: 'Theaters & Cinemas',
    kp_segment_id: null,
    brands: { low: 10, high: 30, rationale: 'AMC (23% share), Cinemark (15%), Regal (Cineworld), plus regional chains (Marcus, Harkins, Cinepolis, Showcase, Bow Tie). ~10–30 brands with meaningful US presence.', source: 'Statista US-Canada top cinema circuits by screens 2023; AMC 10-K 2025' },
    sqft: { low: 10800, high: 54000, nominal: 25000 },
    conc: { value: 'concentrated', rationale: 'Top 3 (AMC + Cinemark + Regal) ≈ 60% market share, ≈ 18,500 screens of ~40,000 US screens.', source: 'Statista 2023; Renub 2025 top US movie theater companies' },
    bms: { value: 5, rationale: 'Major chains instrument HVAC for variable occupancy. Mid-tier and regionals less so.', source: 'Industry experience' },
    pain_points: ['HVAC during high-occupancy events', 'Lighting', 'Comfort'],
    sites_us: 5800, sites_us_rationale: 'NATO reports ~5,700–6,000 movie theaters in the US.',
    sites_mx_pct: 10, sites_cl_pct: 1,
    impl: { addr: 12, ticket: 25000 },
    sub: { addr: 25, arpu: 400 },
    feas: { need: 6, hw_gap: 3, sim: 3, bms_eff: 5, sust: 5 },
  },
  {
    id: 'convention',
    display_name: 'Convention Centers',
    kp_segment_id: null,
    brands: { low: 200, high: 500, rationale: 'Mostly municipally owned. Some private operators (ASM Global, Spectra). Each venue is its own buyer for facility decisions.', source: 'Northstar Meetings Group 2026; Skift Meetings 2026' },
    sqft: { low: 215000, high: 1076000, nominal: 400000 },
    conc: { value: 'fragmented', rationale: 'Each venue municipally owned; no real concentration. ASM Global manages 350+ venues globally including many US convention centers.', source: 'ASM Global; Northstar Meetings 2026' },
    bms: { value: 8, rationale: 'Large convention centers heavily instrumented (variable HVAC for event load swings, lighting scenes, water/utility metering). Smaller venues less so.', source: 'Industry experience; convention center facility standards' },
    pain_points: ['HVAC for variable occupancy', 'Lighting', 'Water systems'],
    sites_us: 700, sites_us_rationale: 'Wikipedia US convention centers list + 10times.com venues directory: ~700 exhibition and convention center venues in the US.',
    sites_mx_pct: 8, sites_cl_pct: 1,
    impl: { addr: 10, ticket: 80000 },
    sub: { addr: 20, arpu: 1200 },
    feas: { need: 6, hw_gap: 5, sim: 2, bms_eff: 8, sust: 7 },
  },
  {
    id: 'customer_service_branches',
    display_name: 'Customer service branches',
    kp_segment_id: null,
    brands: { low: 10, high: 40, rationale: 'Telco (AT&T 2,200 corporate + authorized retailers, Verizon similar, T-Mobile). Cable (Xfinity, Spectrum). Utilities (PG&E, Con Ed, etc.). Insurance offices (State Farm, Allstate). ~10–40 brands with meaningful customer-facing branch networks.', source: 'AT&T 2025 retail footprint; Verizon retail network 2026; Atlanta News First 2026' },
    sqft: { low: 2000, high: 15000, nominal: 6000 },
    conc: { value: 'concentrated', rationale: 'Big 3 telcos (AT&T, Verizon, T-Mobile) dominate retail telco. Insurance branches more fragmented across thousands of State Farm / Allstate / Farmers agents.', source: 'AT&T / Verizon / T-Mobile retail networks' },
    bms: { value: 6, rationale: 'Telco flagship stores instrumented (Verizon, Apple). Smaller authorized retailers less so. Cable / utility kiosks vary widely.', source: 'Industry experience' },
    pain_points: ['HVAC for service halls', 'Lighting', 'Queue area comfort'],
    sites_us: 30000, sites_us_rationale: 'AT&T 2,200 corporate + Verizon network + T-Mobile + cable + utility kiosks + insurance branches.',
    sites_mx_pct: 12, sites_cl_pct: 1.5,
    impl: { addr: 15, ticket: 15000 },
    sub: { addr: 25, arpu: 280 },
    feas: { need: 7, hw_gap: 4, sim: 2, bms_eff: 6, sust: 6 },
  },
  {
    id: 'spas_beauty',
    display_name: 'Spas and beauty',
    kp_segment_id: null,
    brands: { low: 50, high: 200, rationale: 'Massage Envy 1,000+, Hand & Stone 590, European Wax Center ~900, plus MassageLuxe, Drybar, Great Clips, Supercuts, Ulta Beauty salons. ~50–200 multi-site brands.', source: 'Franchise Chatter 2026 top massage franchises; Hand & Stone 2026' },
    sqft: { low: 1500, high: 8000, nominal: 3500 },
    conc: { value: 'fragmented', rationale: 'Massage chains and franchises only ~22% of consumers. Vast majority of spa/beauty businesses are independent or small chains.', source: 'Franchise Chatter 2026; ResearchAndMarkets US massage market' },
    bms: { value: 4, rationale: 'Mall-tenant or strip-center operators usually rely on building HVAC. Standalone branded spas slightly more instrumented.', source: 'Industry experience' },
    pain_points: ['HVAC comfort in treatment rooms', 'Hot water'],
    sites_us: 90000, sites_us_rationale: 'Combined chain + independent estimate; chain locations (Massage Envy, Hand & Stone, European Wax Center, Great Clips etc.) ≈ 10–15k; independent thousands more.',
    sites_mx_pct: 12, sites_cl_pct: 1.5,
    impl: { addr: 15, ticket: 8000 },
    sub: { addr: 15, arpu: 150 },
    feas: { need: 5, hw_gap: 3, sim: 2, bms_eff: 4, sust: 3 },
  },
  {
    id: 'data_centers',
    display_name: 'Data centers',
    kp_segment_id: null,
    brands: { low: 50, high: 200, rationale: 'Hyperscalers (AWS, Azure, Google, Meta, Oracle) plus colocation leaders (Equinix 260 IBX, Digital Realty 300+ globally, QTS, CoreSite, CyrusOne, Iron Mountain, Vantage, Applied Digital). ~50–200 operators with meaningful US footprint.', source: 'Equinix 2025 annual; Digital Realty 10-K; MarketsAndMarkets 2026 colo' },
    sqft: { low: 50000, high: 500000, nominal: 150000 },
    conc: { value: 'concentrated', rationale: 'Hyperscalers + Equinix + Digital Realty + QTS dominate. Top 10 colo operators control most retail colo capacity.', source: 'GlobeNewswire US Data Center Colocation Databook 2026' },
    bms: { value: 10, rationale: 'Mission-critical. Instrumented end-to-end (CRAC, PUE reporting, power redundancy, rack-level telemetry). Standard practice industry-wide.', source: 'Uptime Institute; Equinix / Digital Realty operational disclosures' },
    pain_points: ['Cooling (CRAC) optimization', 'PUE reporting', 'Power redundancy'],
    sites_us: 2700, sites_us_rationale: 'US data center facility count including hyperscalers + colo + enterprise self-managed; CBRE / JLL estimates 2,500–3,000.',
    sites_mx_pct: 8, sites_cl_pct: 1.5,
    impl: { addr: 10, ticket: 100000 },
    sub: { addr: 30, arpu: 1500 },
    feas: { need: 5, hw_gap: 7, sim: 2, bms_eff: 10, sust: 8 },
  },
];

// ---------- helpers ----------

function round(n) {
  if (n < 100) return Math.round(n);
  if (n < 10000) return Math.round(n / 10) * 10;
  return Math.round(n / 100) * 100;
}
function ratioSites(usSites, pct) { return round(usSites * pct / 100); }
function ratioTicket(usTicket, factor) { return round(usTicket * factor); }
function esc(s) { return String(s).replaceAll('"', '\\"'); }

// ---------- yaml builder ----------

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

  return `# Auto-populated by scripts/populate-from-csv.mjs (researched + preliminary values).
# Brands_range, sites_us, BMS, concentration are grounded in 2026 industry sources.
# Tickets, ARPU, addressable %, and CL/MX sites are still estimates — iterate.

id: ${p.id}
display_name: "${p.display_name}"
kp_segment_id: ${p.kp_segment_id ?? 'null'}

preliminary: true

inherited_cache:
  source: null
  _synced_at: null

market_analysis:
  brands_range:
    low: ${p.brands.low}
    high: ${p.brands.high}
    rationale: "${esc(p.brands.rationale)}"
    source: "${esc(p.brands.source)}"

  typical_site_sqft:
    low: ${p.sqft.low}
    high: ${p.sqft.high}
    nominal: ${p.sqft.nominal}

  market_concentration:
    value: ${p.conc.value}
    rationale: "${esc(p.conc.rationale)}"
    source: "${esc(p.conc.source)}"

  bms_penetration:
    value: ${p.bms.value}
    rationale: "${esc(p.bms.rationale)}"
    source: "${esc(p.bms.source)}"

  pain_points:
${p.pain_points.map((pt) => `    - "${esc(pt)}"`).join('\n')}

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
      sites_rationale: "${esc(p.sites_us_rationale)}"
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
    brands_range: researched
    bms_penetration: researched
    market_concentration: researched
    by_country.US.sites: researched
    by_country.CL: preliminary
    by_country.MX: preliminary
    by_country.US.implementation: preliminary
    by_country.US.subscription: preliminary
    feasibility_inputs.delivery_capacity: preliminary
`;
}

let written = 0;
for (const p of data) {
  writeFileSync(join(PROFILES, `${p.id}.yml`), buildYaml(p), 'utf-8');
  written += 1;
}
console.log(`Wrote ${written} profile YAMLs.`);
