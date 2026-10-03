-- =============================================================================
-- 0068 — Short links: a fixed address the club can print as a QR code, whose
-- destination is changed from the admin pages whenever it needs to be.
--
-- A QR code is the address baked into it. Print `/go/apply` on a poster and
-- the poster keeps working as long as `/go/apply` sends people somewhere
-- useful — which is the row in this table, not the code. The admin page at
-- /admin/links creates the row, shows the QR, and edits the destination.
--
-- Anonymous visitors never read the table: they call `resolve_short_link`,
-- a definer function that returns the one destination and counts the visit.
--
-- Apply by pasting into the Supabase SQL editor. Every statement re-runs
-- safely.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The permission: a Presidency matter, one row per role to move elsewhere
-- -----------------------------------------------------------------------------

insert into permissions (key, description_en, description_ar) values
  ('links.manage',
   'Create short links and QR codes, and change where they lead',
   'إنشاء الروابط المختصرة ورموز QR وتغيير وجهتها')
on conflict (key) do update
  set description_en = excluded.description_en,
      description_ar = excluded.description_ar;

-- Deny for every role first, then grant. Anything forgotten stays denied.
insert into role_permissions (role_id, permission_key, scope)
select r.id, 'links.manage', 'none'::permission_scope
from roles r
on conflict (role_id, permission_key) do nothing;

update role_permissions rp
set scope = 'all'::permission_scope
where rp.permission_key = 'links.manage'
  and rp.role_id in (select id from roles where key in ('super_admin', 'president', 'vice_president'));

-- -----------------------------------------------------------------------------
-- The table
-- -----------------------------------------------------------------------------

create table if not exists short_links (
  slug        text primary key,
  label       text not null,
  target_url  text not null,
  visits      bigint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The slug is what gets printed: short, lower-case, nothing a QR scanner or
  -- a hand-typed address could mangle.
  constraint short_links_slug_shape check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  constraint short_links_target_is_http check (target_url ~* '^https?://'),
  constraint short_links_label_present check (length(trim(label)) between 1 and 120)
);

comment on table short_links is
  'A fixed address (/go/<slug>) printed on posters and QR codes; its target is edited from /admin/links. resolve_short_link serves anonymous visitors.';

drop trigger if exists short_links_touch_updated_at on short_links;
create trigger short_links_touch_updated_at
  before update on short_links
  for each row execute function app.touch_updated_at();

alter table short_links enable row level security;

drop policy if exists short_links_select on short_links;
create policy short_links_select on short_links
  for select using ((select app.can('links.manage')));

drop policy if exists short_links_insert on short_links;
create policy short_links_insert on short_links
  for insert with check ((select app.can('links.manage')));

drop policy if exists short_links_update on short_links;
create policy short_links_update on short_links
  for update
  using ((select app.can('links.manage')))
  with check ((select app.can('links.manage')));

drop policy if exists short_links_delete on short_links;
create policy short_links_delete on short_links
  for delete using ((select app.can('links.manage')));

-- -----------------------------------------------------------------------------
-- Resolving a slug for someone who scanned the code
--
-- Definer, so it reads past RLS; it hands back only the destination and
-- counts the visit on the way. Null when the slug does not exist.
-- -----------------------------------------------------------------------------

create or replace function public.resolve_short_link(p_slug text)
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update short_links
     set visits = visits + 1
   where slug = p_slug
  returning target_url;
$$;

comment on function public.resolve_short_link(text) is
  'The destination behind /go/<slug>, counting the visit. Null for an unknown slug.';

grant select, insert, update, delete on short_links to authenticated;
grant execute on function public.resolve_short_link(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
