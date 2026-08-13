-- =============================================================================
-- 0001 — Foundation: teams, roles, members, and the permission TABLES.
--
-- Design note (spec §2): permissions are DATA, not code. Nothing here contains
-- a rule like "if the role is Team Director then ...". Instead we store a
-- (role, permission) -> scope mapping and read it at check time, so changing
-- what a role can do is an UPDATE, never a redeploy.
-- =============================================================================

create extension if not exists citext;

-- Private schema for helper functions. Supabase only exposes `public` through
-- the API, so nothing in `app` is callable from outside the database.
create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- The six scopes from spec §2. `none` is the default for anything unmapped.
create type permission_scope as enum (
  'all',
  'own_team',
  'own_projects',
  'assigned',
  'own',
  'none'
);

create type membership_status as enum ('active', 'inactive', 'alumni');

-- -----------------------------------------------------------------------------
-- Teams and roles
-- -----------------------------------------------------------------------------

create table teams (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,          -- stable handle, e.g. 'HR', 'IT'
  name_en     text not null,
  name_ar     text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on column teams.key is
  'Stable identifier used by seeds and permission overrides. Renaming a team''s
   display name must never require touching this.';

-- Exactly seven roles, and a person holds exactly ONE of them (spec §2).
-- "Team Director" is a single role — the UI shows "Director of {team}" by
-- combining the role with the person''s team, which needs no schema change.
create table roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name_en     text not null,
  name_ar     text not null,
  sort_order  integer not null default 100,  -- display order only
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Members
-- -----------------------------------------------------------------------------

create table members (
  id               uuid primary key default gen_random_uuid(),

  -- Linked the first time this person signs in (spec §5). A CSV import creates
  -- profile data only, so this stays NULL until then.
  auth_user_id     uuid unique references auth.users (id) on delete set null,

  email            citext not null unique,
  name_en          text not null,
  name_ar          text not null,
  phone            text,

  -- Spec §5: exactly 9 digits, must start with 4. Also the CSV import match key.
  student_id       text not null unique check (student_id ~ '^4[0-9]{8}$'),

  -- One team, one role — enforced by these being plain columns rather than
  -- join tables. There is deliberately no way to hold two of either.
  team_id          uuid not null references teams (id),
  role_id          uuid not null references roles (id),

  college          text,
  academic_level   text,
  graduation_term  text,   -- free text, e.g. 'Second Semester 1448H'
  status           membership_status not null default 'active',
  join_date        date not null default current_date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index members_team_id_idx on members (team_id);
create index members_role_id_idx on members (role_id);

comment on column members.graduation_term is
  'Free text, maintained manually. Nothing in the system derives membership
   status from it (spec §1).';

-- Spec §5: national IDs live APART from the directory, with their own policy.
-- "Everyone can see the member directory" must not imply "everyone can see
-- national IDs", and the cheapest way to guarantee that is a separate table
-- that directory queries simply never join to.
create table member_sensitive (
  member_id    uuid primary key references members (id) on delete cascade,
  national_id  text not null check (national_id ~ '^[12][0-9]{9}$'),
  updated_at   timestamptz not null default now()
);

-- Skills come from a fixed list, but the list itself is data (spec §10).
create table skills (
  id       uuid primary key default gen_random_uuid(),
  key      text not null unique,
  name_en  text not null,
  name_ar  text not null
);

create table member_skills (
  member_id  uuid not null references members (id) on delete cascade,
  skill_id   uuid not null references skills (id) on delete cascade,
  primary key (member_id, skill_id)
);

-- -----------------------------------------------------------------------------
-- Permission mapping (spec §2)
-- -----------------------------------------------------------------------------

create table permissions (
  key             text primary key,
  description_en  text not null,
  description_ar  text not null
);

-- The baseline: what a role may do club-wide.
create table role_permissions (
  role_id         uuid not null references roles (id) on delete cascade,
  permission_key  text not null references permissions (key) on delete cascade,
  scope           permission_scope not null,
  primary key (role_id, permission_key)
);

-- Team-specific exception to the baseline.
--
-- This is how spec §2's "only HR's Directors may edit members" stays data:
--   baseline  (team_director, members.manage) -> none
--   override  (team_director, members.manage, team = HR) -> all
-- No code knows what "HR" means. Deleting the override row removes the power,
-- and adding one for another team grants it — both without a deploy.
create table role_permission_team_overrides (
  role_id         uuid not null references roles (id) on delete cascade,
  permission_key  text not null references permissions (key) on delete cascade,
  team_id         uuid not null references teams (id) on delete cascade,
  scope           permission_scope not null,
  primary key (role_id, permission_key, team_id)
);

-- -----------------------------------------------------------------------------
-- Role changes are audited (spec §2: role escalation must be gated)
-- -----------------------------------------------------------------------------

create table role_change_log (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references members (id) on delete cascade,
  from_role_id uuid references roles (id),
  to_role_id   uuid not null references roles (id),
  changed_by   uuid references members (id),
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Shared updated_at trigger
-- -----------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger members_touch_updated_at
  before update on members
  for each row execute function app.touch_updated_at();

create trigger member_sensitive_touch_updated_at
  before update on member_sensitive
  for each row execute function app.touch_updated_at();
