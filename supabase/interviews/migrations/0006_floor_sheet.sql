-- =============================================================================
-- 0006 — The floor sheet: where each edition's live Google Sheet is remembered.
--
-- One spreadsheet per edition, created the first time the floor changes after
-- the club's Google account is connected (lib/google/sheets.ts). Stored here,
-- next to tv_token, rather than in `settings`, because it names an external
-- resource this database owns the lifecycle of — the same reasoning 0001 gives
-- for tv_token being its own column.
-- =============================================================================

alter table editions add column floor_sheet_id  text;
alter table editions add column floor_sheet_url text;

create or replace function public.set_floor_sheet(
  p_edition    uuid,
  p_sheet_id   text,
  p_sheet_url  text
)
returns editions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v editions;
begin
  update editions
     set floor_sheet_id = p_sheet_id, floor_sheet_url = p_sheet_url
   where id = p_edition
   returning * into v;

  if v.id is null then
    perform app.refuse('not_found', 'No such edition.');
  end if;
  return v;
end;
$$;
