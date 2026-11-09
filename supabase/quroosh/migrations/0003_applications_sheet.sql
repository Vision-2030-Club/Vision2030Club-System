-- =============================================================================
-- Quroosh database — 0003: the applications Google Sheet.
--
-- Every application is also written, as a row, to one Google Sheet per club
-- project (src/lib/quroosh/applicationSheet.ts), the way Mock Interviews
-- keeps its registrations sheet. The sheet is made by the app in the Google
-- account connected under Admin → Google; this migration only remembers
-- which sheet it is, so every submission adds to the same one.
--
-- The database stays the record: nothing is read back from the sheet.
--
-- Nothing is deleted. Safe to re-run: the columns are added if missing, the
-- function replaced.
-- =============================================================================

alter table settings
  add column if not exists sheet_id  text,
  add column if not exists sheet_url text check (sheet_url is null or sheet_url ~ '^https://');

comment on column settings.sheet_id is
  'The Google Sheet every application is copied to (0003). Made by the app on the first application or Sync now.';
comment on column settings.sheet_url is
  'Its link, shown to the project''s managers (0003).';

-- Remembers the project's sheet. Called by the app's server only, after it
-- has made the sheet; a project without settings has no form, so no sheet.
create or replace function public.save_sheet(
  p_project uuid,
  p_sheet_id text,
  p_sheet_url text
)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  update settings
     set sheet_id = nullif(p_sheet_id, ''),
         sheet_url = nullif(p_sheet_url, '')
   where project_id = p_project;
  if not found then
    perform app.refuse('not_found', 'This form does not exist.');
  end if;
end;
$$;

revoke execute on function public.save_sheet(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_sheet(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
