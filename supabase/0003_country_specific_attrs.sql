-- ============================================================
-- Move country-varying attributes from kma.profiles to kma.country_data
--
-- Rationale: brands count, site size, BMS penetration, and market
-- concentration realistically differ by country (e.g., Hotels in US
-- have ~7 BMS penetration; in Chile maybe ~4. Pharmacy chains: 10-30
-- in US, 3-5 in Chile.) Storing them at profile level forced one
-- value to display across all 3 country tables, which made the data
-- look "mezclada".
--
-- Pain points and display_name remain profile-level (the segment is
-- the same concept globally; pain points are mostly invariant).
-- ============================================================

-- Add the per-country columns to country_data
alter table kma.country_data
  add column if not exists typical_site_sqft_low integer,
  add column if not exists typical_site_sqft_high integer,
  add column if not exists typical_site_sqft_nominal integer,

  add column if not exists market_concentration_value text,
  add column if not exists market_concentration_rationale text,
  add column if not exists market_concentration_source text,

  add column if not exists bms_penetration_value integer,
  add column if not exists bms_penetration_rationale text,
  add column if not exists bms_penetration_source text,

  add column if not exists brands_range_low integer,
  add column if not exists brands_range_high integer,
  add column if not exists brands_range_rationale text,
  add column if not exists brands_range_source text;

-- Constraints
do $$ begin
  alter table kma.country_data add constraint country_data_concentration_check
    check (market_concentration_value is null
           or market_concentration_value in ('fragmented', 'mixed', 'concentrated'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table kma.country_data add constraint country_data_bms_check
    check (bms_penetration_value is null
           or (bms_penetration_value >= 1 and bms_penetration_value <= 10));
exception when duplicate_object then null; end $$;

-- Seed from the current profile-level values (only if not already set in country_data)
update kma.country_data cd
set
  typical_site_sqft_low = coalesce(cd.typical_site_sqft_low, p.typical_site_sqft_low),
  typical_site_sqft_high = coalesce(cd.typical_site_sqft_high, p.typical_site_sqft_high),
  typical_site_sqft_nominal = coalesce(cd.typical_site_sqft_nominal, p.typical_site_sqft_nominal),
  market_concentration_value = coalesce(cd.market_concentration_value, p.market_concentration_value),
  market_concentration_rationale = coalesce(cd.market_concentration_rationale, p.market_concentration_rationale),
  market_concentration_source = coalesce(cd.market_concentration_source, p.market_concentration_source),
  bms_penetration_value = coalesce(cd.bms_penetration_value, p.bms_penetration_value),
  bms_penetration_rationale = coalesce(cd.bms_penetration_rationale, p.bms_penetration_rationale),
  bms_penetration_source = coalesce(cd.bms_penetration_source, p.bms_penetration_source),
  brands_range_low = coalesce(cd.brands_range_low, p.brands_range_low),
  brands_range_high = coalesce(cd.brands_range_high, p.brands_range_high),
  brands_range_rationale = coalesce(cd.brands_range_rationale, p.brands_range_rationale),
  brands_range_source = coalesce(cd.brands_range_source, p.brands_range_source)
from kma.profiles p
where cd.profile_id = p.id;

-- Drop the moved columns from profiles
alter table kma.profiles
  drop column if exists typical_site_sqft_low,
  drop column if exists typical_site_sqft_high,
  drop column if exists typical_site_sqft_nominal,
  drop column if exists market_concentration_value,
  drop column if exists market_concentration_rationale,
  drop column if exists market_concentration_source,
  drop column if exists bms_penetration_value,
  drop column if exists bms_penetration_rationale,
  drop column if exists bms_penetration_source,
  drop column if exists brands_range_low,
  drop column if exists brands_range_high,
  drop column if exists brands_range_rationale,
  drop column if exists brands_range_source;
