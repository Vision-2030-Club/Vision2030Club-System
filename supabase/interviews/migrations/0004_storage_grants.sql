-- =============================================================================
-- 0004 — The two buckets, and locking the API roles out.
--
-- Buckets: `cvs` (private, PDF only, 5 MB) and `exports` (private). Neither
-- has a storage policy of any kind — the server signs a short-lived URL when
-- an interviewer or HR opens a CV, and nothing else can reach a file.
--
-- Roles: on a Supabase project the `anon` and `authenticated` roles are
-- granted access to new tables and functions by default. Row Level Security
-- with no policies already returns them nothing, and this takes the grants
-- away as well, so a leaked anon key cannot even call a function. The service
-- role — the only client this database ever has — keeps everything.
--
-- Both blocks are guarded so the same file also runs on a plain Postgres
-- (where neither the storage schema nor those roles exist), which is how the
-- migrations are checked before they touch the real project.
-- =============================================================================

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('cvs', 'cvs', false, 5242880, array['application/pdf'])
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  insert into storage.buckets (id, name, public)
  values ('exports', 'exports', false)
  on conflict (id) do update set public = excluded.public;
exception
  when insufficient_privilege or undefined_table then
    raise warning
      'Could not create the storage buckets from SQL (%). Create two PRIVATE buckets named `cvs` (5 MB, application/pdf) and `exports` in the dashboard.',
      sqlerrm;
end
$$;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('revoke all on schema app from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;

  -- Functions are executable by PUBLIC unless told otherwise.
  revoke all on all functions in schema public from public;
  alter default privileges in schema public revoke all on functions from public;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant select, insert, update, delete on all tables in schema public to service_role;
    grant usage, select on all sequences in schema public to service_role;
    grant execute on all functions in schema public to service_role;
    alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
    alter default privileges in schema public grant execute on functions to service_role;
  end if;
end
$$;

-- PostgREST caches the schema; tell it to look again.
notify pgrst, 'reload schema';
