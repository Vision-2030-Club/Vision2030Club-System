-- =============================================================================
-- 0024 — Profile photo and experience history; skills removed.
--
-- Three changes to what a member profile IS:
--
--   1. A photo. The file lives in a PRIVATE storage bucket and the row stores
--      only its path, so reading a photo goes through the same signed-URL step
--      as any other restricted read. A public bucket would have made every
--      member's face reachable by anyone holding the URL, which is exactly the
--      kind of "the directory is readable, therefore everything is" leak that
--      member_sensitive exists to prevent.
--
--   2. A free-form experience history, LinkedIn-style: roles held, where, and
--      when. Yours is yours to write — the policy lets the person themself and
--      anyone holding members.manage write it, and anyone who can see the
--      directory read it.
--
--   3. Skills are gone. The fixed list never described anybody accurately and
--      the history above replaces what it was reached for.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The photo
-- -----------------------------------------------------------------------------

alter table members add column if not exists avatar_path text;

comment on column members.avatar_path is
  'Object path inside the private `avatars` storage bucket, of the form
   <member_id>/<file>. Never a URL: the application signs one per render, so
   the file stays as unreadable to a signed-out stranger as the row is.';

-- The bucket and its policies. storage.objects belongs to the storage service
-- rather than to us, so this is wrapped: on a database where the migration
-- role cannot write there, the rest of the file still applies and the operator
-- gets a warning naming what to create by hand.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars', 'avatars', false, 2097152,
    array['image/jpeg', 'image/png', 'image/webp']
  )
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Reading is what makes a signed URL possible, so it follows the directory:
  -- if you may see members at all, you may see their photos.
  drop policy if exists avatars_select on storage.objects;
  create policy avatars_select on storage.objects
    for select using (
      bucket_id = 'avatars' and (select app.is_signed_in())
    );

  -- Writing is confined to your own folder. The first path segment is the
  -- member id, so "my folder" needs no lookup — and no member can overwrite
  -- another's photo even though they share one bucket.
  drop policy if exists avatars_write on storage.objects;
  create policy avatars_write on storage.objects
    for all
    using (
      bucket_id = 'avatars'
      and (
        (storage.foldername(name))[1] = (select app.current_member_id())::text
        or (select app.can('members.manage'))
      )
    )
    with check (
      bucket_id = 'avatars'
      and (
        (storage.foldername(name))[1] = (select app.current_member_id())::text
        or (select app.can('members.manage'))
      )
    );
exception
  when insufficient_privilege or undefined_table then
    raise warning
      'Could not configure the `avatars` storage bucket from SQL (%). Create a PRIVATE bucket named `avatars` in the Supabase dashboard and add the two policies from this migration by hand.',
      sqlerrm;
end
$$;

-- my_member() is what the app shell reads, so the photo has to come with it.
create or replace function public.my_member()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(x)
  from (
    select
      m.id, m.email, m.name_en, m.name_ar, m.status, m.student_id, m.avatar_path,
      m.team_id, t.key as team_key, t.name_en as team_name_en, t.name_ar as team_name_ar,
      m.role_id, r.key as role_key, r.name_en as role_name_en, r.name_ar as role_name_ar
    from members m
    join teams t on t.id = m.team_id
    join roles r on r.id = m.role_id
    where m.auth_user_id = auth.uid()
  ) x
$$;

grant execute on function public.my_member() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Experience history
--
-- `ended_on is null` means "still doing it", which is why there is no separate
-- boolean: two ways to say the same thing eventually disagree.
-- -----------------------------------------------------------------------------

create table if not exists member_experience (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members (id) on delete cascade,
  title         text not null,
  organization  text not null,
  description   text,
  started_on    date not null,
  ended_on      date,
  created_at    timestamptz not null default now(),
  constraint member_experience_dates check (ended_on is null or ended_on >= started_on)
);

create index if not exists member_experience_member_idx
  on member_experience (member_id, started_on desc);

alter table member_experience enable row level security;

-- Same reach as the directory row it hangs off: seeing the person means seeing
-- their history.
drop policy if exists member_experience_select on member_experience;
create policy member_experience_select on member_experience
  for select using (
    (select app.can('members.view'))
    or member_id = (select app.current_member_id())
  );

-- Your own history is yours to write. members.manage covers HR fixing a typo.
drop policy if exists member_experience_write on member_experience;
create policy member_experience_write on member_experience
  for all
  using (
    member_id = (select app.current_member_id())
    or (select app.can('members.manage'))
  )
  with check (
    member_id = (select app.current_member_id())
    or (select app.can('members.manage'))
  );

-- -----------------------------------------------------------------------------
-- 3. Skills, removed
--
-- Dropped rather than left unused: an empty table with live policies is a
-- thing the next reader has to work out the status of.
-- -----------------------------------------------------------------------------

drop table if exists member_skills;
drop table if exists skills;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- The blanket grant above re-grants DELETE on task_scores, which 0015 exists
-- to take away (§8: a score is removed by cascade, never by hand). Any file
-- repeating that line has to repeat this one.
revoke delete on task_scores from authenticated;
