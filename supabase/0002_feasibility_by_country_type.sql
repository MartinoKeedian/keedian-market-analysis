-- ============================================================
-- Feasibility inputs by country × project type
-- ============================================================
-- Before: kma.feasibility_inputs (one row per profile, 5 inputs)
-- After:  kma.feasibility (six rows per profile = 3 countries × 2 types)
--
-- Each input still 1-10 scale. Migration copies the current profile-
-- level values to all 6 (country, type) combinations so the user can
-- then differentiate via UI edits. project_type ∈ {implementation,
-- subscription}; the "full" mode is derived in scoring (average of
-- impl + sub rows for the selected country).
-- ============================================================

create table if not exists kma.feasibility (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null references kma.profiles(id) on delete cascade,
  country_code text not null check (country_code in ('CL', 'MX', 'US')),
  project_type text not null check (project_type in ('implementation', 'subscription')),

  need_perception integer check (need_perception between 1 and 10),
  hw_gap integer check (hw_gap between 1 and 10),
  similar_clients_exist integer check (similar_clients_exist between 1 and 10),
  bms_penetration_effect integer check (bms_penetration_effect between 1 and 10),
  sustainment_upside integer check (sustainment_upside between 1 and 10),

  updated_at timestamptz not null default now(),
  unique (profile_id, country_code, project_type)
);

create index if not exists feasibility_profile_idx on kma.feasibility(profile_id);
create index if not exists feasibility_lookup_idx on kma.feasibility(profile_id, country_code, project_type);

-- Updated_at trigger
drop trigger if exists feasibility_set_updated_at on kma.feasibility;
create trigger feasibility_set_updated_at
  before update on kma.feasibility
  for each row execute function kma.set_updated_at();

-- Seed from the existing per-profile rows (if any). Idempotent via ON CONFLICT.
insert into kma.feasibility (
  profile_id, country_code, project_type,
  need_perception, hw_gap, similar_clients_exist,
  bms_penetration_effect, sustainment_upside
)
select
  fi.profile_id,
  c.code,
  t.type,
  fi.need_perception,
  fi.hw_gap,
  fi.similar_clients_exist,
  fi.bms_penetration_effect,
  fi.sustainment_upside
from kma.feasibility_inputs fi
cross join (values ('CL'), ('MX'), ('US')) as c(code)
cross join (values ('implementation'), ('subscription')) as t(type)
on conflict (profile_id, country_code, project_type) do nothing;

-- RLS policies
alter table kma.feasibility enable row level security;

drop policy if exists feasibility_read on kma.feasibility;
create policy feasibility_read on kma.feasibility for select using (true);

drop policy if exists feasibility_write on kma.feasibility;
create policy feasibility_write on kma.feasibility for update using (auth.role() = 'authenticated');

-- Grants
grant select on kma.feasibility to anon;
grant select, insert, update on kma.feasibility to authenticated;

-- Drop the old single-row-per-profile table. We've migrated its data above.
drop table if exists kma.feasibility_inputs cascade;
