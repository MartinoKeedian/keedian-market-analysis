-- ============================================================
-- Keedian Market Analysis — initial schema
-- All tables live in the `kma` schema (separate from `public`
-- which holds the JCP tables in the same Supabase project).
--
-- After running this, expose `kma` in Supabase API settings:
--   Settings → API → Exposed schemas → add `kma`
-- Until that toggle is on, the JS client can't reach these tables.
-- ============================================================

create extension if not exists "pgcrypto";

create schema if not exists kma;

-- Grants — the anon and authenticated roles need USAGE on the schema
-- itself before they can hit the tables inside.
grant usage on schema kma to anon, authenticated;
grant select on all tables in schema kma to anon;
grant select, insert, update on all tables in schema kma to authenticated;
alter default privileges in schema kma grant select on tables to anon;
alter default privileges in schema kma grant select, insert, update on tables to authenticated;

-- ------------------------------------------------------------
-- kma.profiles — one row per profile (structural data)
-- ------------------------------------------------------------
create table if not exists kma.profiles (
  id text primary key,
  display_name text not null,
  kp_segment_id text,
  preliminary boolean not null default true,

  typical_site_sqft_low integer,
  typical_site_sqft_high integer,
  typical_site_sqft_nominal integer,

  market_concentration_value text check (
    market_concentration_value is null
    or market_concentration_value in ('fragmented', 'mixed', 'concentrated')
  ),
  market_concentration_rationale text,
  market_concentration_source text,

  bms_penetration_value integer check (
    bms_penetration_value is null
    or (bms_penetration_value >= 1 and bms_penetration_value <= 10)
  ),
  bms_penetration_rationale text,
  bms_penetration_source text,

  brands_range_low integer,
  brands_range_high integer,
  brands_range_rationale text,
  brands_range_source text,

  pain_points text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_kp_segment_idx on kma.profiles(kp_segment_id);

-- ------------------------------------------------------------
-- kma.country_data — per (profile, country) market data
-- ------------------------------------------------------------
create table if not exists kma.country_data (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null references kma.profiles(id) on delete cascade,
  country_code text not null check (country_code in ('CL', 'MX', 'US')),

  sites_low integer,
  sites_high integer,
  sites_nominal integer,
  sites_rationale text,

  impl_addressable_pct numeric(5,2),
  impl_avg_ticket_usd numeric(12,2),

  sub_addressable_pct numeric(5,2),
  sub_arpu_monthly_usd numeric(12,2),

  updated_at timestamptz not null default now(),

  unique (profile_id, country_code)
);

create index if not exists country_data_profile_idx on kma.country_data(profile_id);

-- ------------------------------------------------------------
-- kma.feasibility_inputs — 5 inputs per profile (1–10 scale)
-- ------------------------------------------------------------
create table if not exists kma.feasibility_inputs (
  profile_id text primary key references kma.profiles(id) on delete cascade,
  need_perception integer check (need_perception between 1 and 10),
  hw_gap integer check (hw_gap between 1 and 10),
  similar_clients_exist integer check (similar_clients_exist between 1 and 10),
  bms_penetration_effect integer check (bms_penetration_effect between 1 and 10),
  sustainment_upside integer check (sustainment_upside between 1 and 10),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- kma.audit_log — change history (who edited what, when)
-- ------------------------------------------------------------
create table if not exists kma.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id text not null,
  field_name text not null,
  old_value text,
  new_value text,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists audit_log_table_record_idx on kma.audit_log(table_name, record_id);
create index if not exists audit_log_changed_at_idx on kma.audit_log(changed_at desc);

-- ------------------------------------------------------------
-- updated_at triggers
-- ------------------------------------------------------------
create or replace function kma.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_set_updated_at on kma.profiles;
create trigger profiles_set_updated_at
  before update on kma.profiles
  for each row execute function kma.set_updated_at();

drop trigger if exists country_data_set_updated_at on kma.country_data;
create trigger country_data_set_updated_at
  before update on kma.country_data
  for each row execute function kma.set_updated_at();

drop trigger if exists feasibility_inputs_set_updated_at on kma.feasibility_inputs;
create trigger feasibility_inputs_set_updated_at
  before update on kma.feasibility_inputs
  for each row execute function kma.set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security
-- Anonymous: read-only
-- Authenticated: read + write on data tables; insert on audit log
-- ------------------------------------------------------------
alter table kma.profiles enable row level security;
alter table kma.country_data enable row level security;
alter table kma.feasibility_inputs enable row level security;
alter table kma.audit_log enable row level security;

drop policy if exists profiles_read on kma.profiles;
create policy profiles_read on kma.profiles for select using (true);

drop policy if exists profiles_write on kma.profiles;
create policy profiles_write on kma.profiles for update using (auth.role() = 'authenticated');

drop policy if exists country_data_read on kma.country_data;
create policy country_data_read on kma.country_data for select using (true);

drop policy if exists country_data_write on kma.country_data;
create policy country_data_write on kma.country_data for update using (auth.role() = 'authenticated');

drop policy if exists feasibility_read on kma.feasibility_inputs;
create policy feasibility_read on kma.feasibility_inputs for select using (true);

drop policy if exists feasibility_write on kma.feasibility_inputs;
create policy feasibility_write on kma.feasibility_inputs for update using (auth.role() = 'authenticated');

drop policy if exists audit_read on kma.audit_log;
create policy audit_read on kma.audit_log for select using (true);

drop policy if exists audit_insert on kma.audit_log;
create policy audit_insert on kma.audit_log for insert with check (auth.role() = 'authenticated');
