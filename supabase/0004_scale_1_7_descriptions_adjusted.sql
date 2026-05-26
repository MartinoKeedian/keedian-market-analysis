-- ============================================================
-- 0004: Feasibility scale 1-7 (numeric/decimal), descriptions table,
--       adjusted impact + assumptions on country_data.
-- ============================================================

-- 1. Drop existing CHECK constraints on feasibility 1-10
do $$ begin
  alter table kma.feasibility drop constraint if exists feasibility_need_perception_check;
  alter table kma.feasibility drop constraint if exists feasibility_hw_gap_check;
  alter table kma.feasibility drop constraint if exists feasibility_similar_clients_exist_check;
  alter table kma.feasibility drop constraint if exists feasibility_bms_penetration_effect_check;
  alter table kma.feasibility drop constraint if exists feasibility_sustainment_upside_check;
exception when others then null; end $$;

-- 2. Change feasibility column types from integer to numeric(3,1)
alter table kma.feasibility
  alter column need_perception type numeric(3,1) using need_perception::numeric(3,1),
  alter column hw_gap type numeric(3,1) using hw_gap::numeric(3,1),
  alter column similar_clients_exist type numeric(3,1) using similar_clients_exist::numeric(3,1),
  alter column bms_penetration_effect type numeric(3,1) using bms_penetration_effect::numeric(3,1),
  alter column sustainment_upside type numeric(3,1) using sustainment_upside::numeric(3,1);

-- 3. Rescale existing data from 1-10 → 1-7 proportionally:
-- new = round((((old - 1) / 9) * 6 + 1), 1)
update kma.feasibility set
  need_perception        = case when need_perception        is not null then round(((need_perception        - 1) / 9.0 * 6 + 1)::numeric, 1) else null end,
  hw_gap                 = case when hw_gap                 is not null then round(((hw_gap                 - 1) / 9.0 * 6 + 1)::numeric, 1) else null end,
  similar_clients_exist  = case when similar_clients_exist  is not null then round(((similar_clients_exist  - 1) / 9.0 * 6 + 1)::numeric, 1) else null end,
  bms_penetration_effect = case when bms_penetration_effect is not null then round(((bms_penetration_effect - 1) / 9.0 * 6 + 1)::numeric, 1) else null end,
  sustainment_upside     = case when sustainment_upside     is not null then round(((sustainment_upside     - 1) / 9.0 * 6 + 1)::numeric, 1) else null end;

-- 4. Re-add CHECK constraints for 1-7
alter table kma.feasibility
  add constraint feasibility_need_perception_check        check (need_perception        is null or (need_perception        >= 1 and need_perception        <= 7)),
  add constraint feasibility_hw_gap_check                 check (hw_gap                 is null or (hw_gap                 >= 1 and hw_gap                 <= 7)),
  add constraint feasibility_similar_clients_exist_check  check (similar_clients_exist  is null or (similar_clients_exist  >= 1 and similar_clients_exist  <= 7)),
  add constraint feasibility_bms_penetration_effect_check check (bms_penetration_effect is null or (bms_penetration_effect >= 1 and bms_penetration_effect <= 7)),
  add constraint feasibility_sustainment_upside_check     check (sustainment_upside     is null or (sustainment_upside     >= 1 and sustainment_upside     <= 7));

-- 5. Same treatment for BMS penetration market data (kma.country_data.bms_penetration_value):
-- it was 1-10 integer; make it numeric(3,1) 1-7 to keep scales consistent.
do $$ begin
  alter table kma.country_data drop constraint if exists country_data_bms_check;
exception when others then null; end $$;

alter table kma.country_data
  alter column bms_penetration_value type numeric(3,1) using bms_penetration_value::numeric(3,1);

update kma.country_data set bms_penetration_value =
  case when bms_penetration_value is not null
    then round(((bms_penetration_value - 1) / 9.0 * 6 + 1)::numeric, 1)
    else null
  end;

alter table kma.country_data
  add constraint country_data_bms_check check (bms_penetration_value is null or (bms_penetration_value >= 1 and bms_penetration_value <= 7));

-- 6. Descriptions table — what each value (1..7) means per (input × project_type)
create table if not exists kma.feasibility_descriptions (
  input_name text not null,
  project_type text not null check (project_type in ('implementation', 'subscription')),
  description text,                                -- multi-line, free-form. User can include "1: ...", "2: ..." lines.
  updated_at timestamptz not null default now(),
  primary key (input_name, project_type)
);

drop trigger if exists feasibility_descriptions_set_updated_at on kma.feasibility_descriptions;
create trigger feasibility_descriptions_set_updated_at
  before update on kma.feasibility_descriptions
  for each row execute function kma.set_updated_at();

-- Seed with initial descriptions (drawn from the user's reference Excel)
insert into kma.feasibility_descriptions (input_name, project_type, description) values
  ('need_perception', 'implementation', '1: BMS high penetration without improvement opportunities
2: Low–medium BMS penetration, low ROI potential
3: Medium BMS penetration, medium ROI potential
4: Low BMS penetration, medium ROI potential
5: High BMS penetration, improvements potential
6: Medium BMS penetration, high ROI potential
7: Low BMS penetration, high ROI potential'),
  ('need_perception', 'subscription', '1: NO BMS and no services required
2: BMS, but internal team fully manages
3: Low penetration, low ROI potential
4: Low penetration, high ROI potential
5: Medium penetration, medium ROI
6: Medium penetration, but high ROI potential
7: Most of the clients have BMS and require support in their use'),
  ('hw_gap', 'implementation', '1: Highly complex and ad-hoc, non BMS monitoring
2:
3: Highly specialized or complex installation, but standard without experience
4:
5: Highly specialized or complex installation, but standard with experience
6: Medium complexity but existing
7: Simple, standard wireless and already existing'),
  ('hw_gap', 'subscription', '1: Specific ad-hoc operations, usually not BMS
2: New capabilities required not in the roadmap (e.g., complex water systems)
3:
4: Complex solutions
5:
6: Standard operation with the solution in the short term
7: Operation fully available in Keedian (e.g., mostly focused in HVAC)'),
  ('similar_clients_exist', 'implementation', '1: No references — cold start
2:
3:
4: Single reference, recent
5: Multiple references but indirect
6: Multiple referenceable customers
7: Anchored by flagship customer (e.g., Chedraui, 7-Eleven)'),
  ('similar_clients_exist', 'subscription', '1: No references — cold start
2:
3:
4: Single reference on subscription
5: Multiple references on subscription
6: Several recurring-revenue references
7: Established flagship subscription customer'),
  ('bms_penetration_effect', 'implementation', '1: Very high BMS penetration — little room for new install
2:
3:
4: Medium BMS penetration
5:
6:
7: Very low BMS penetration — large greenfield opportunity'),
  ('bms_penetration_effect', 'subscription', '1: No BMS — no instrumented base to service
2:
3:
4: Medium BMS penetration
5:
6:
7: High BMS penetration — easy SaaS overlay'),
  ('sustainment_upside', 'implementation', '1: No legacy BMS to upgrade or sustain
2:
3:
4: Some legacy installations
5:
6:
7: Large aging BMS base needing replacement / sustainment'),
  ('sustainment_upside', 'subscription', '1: No legacy BMS to sustain
2:
3:
4: Some sustainment opportunity
5:
6:
7: Massive recurring sustainment opportunity')
on conflict (input_name, project_type) do nothing;

-- 7. Adjusted impact + additional assumptions on country_data (per project_type)
alter table kma.country_data
  add column if not exists impl_adjusted_impact_usd numeric(15,2),
  add column if not exists impl_additional_assumptions text,
  add column if not exists sub_adjusted_impact_usd numeric(15,2),
  add column if not exists sub_additional_assumptions text;

-- 8. RLS for the new descriptions table
alter table kma.feasibility_descriptions enable row level security;
drop policy if exists feasibility_descriptions_read on kma.feasibility_descriptions;
create policy feasibility_descriptions_read on kma.feasibility_descriptions for select using (true);
drop policy if exists feasibility_descriptions_write on kma.feasibility_descriptions;
create policy feasibility_descriptions_write on kma.feasibility_descriptions for update using (auth.role() = 'authenticated');

grant select on kma.feasibility_descriptions to anon;
grant select, insert, update on kma.feasibility_descriptions to authenticated;
