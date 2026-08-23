-- =============================================================================
-- 0022 — One phone format: +9665XXXXXXXX.
--
-- Phone is now a search key in the member directory, which only works if every
-- row is stored the same way. Rather than asking eleven call sites to format
-- correctly, the database normalises on the way in and then refuses anything
-- it could not normalise — so the CSV import, the profile form and any future
-- writer all land on the same shape without knowing about this rule.
--
-- Normalisation is deliberately narrow: it strips separators and accepts the
-- three ways a Saudi mobile is habitually written (05…, 5…, 9665…). Anything
-- else is left untouched, which means the CHECK below rejects it with the
-- number the person actually typed still visible in the error.
-- =============================================================================

create or replace function app.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  with cleaned as (
    -- Separators only. Digits and a leading '+' are all that survives.
    select regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g') as v
  )
  select case
    when v = ''                     then null
    when v ~ '^\+9665[0-9]{8}$'     then v
    when v ~ '^009665[0-9]{8}$'     then '+' || substring(v from 3)
    when v ~ '^9665[0-9]{8}$'       then '+' || v
    when v ~ '^05[0-9]{8}$'         then '+966' || substring(v from 2)
    when v ~ '^5[0-9]{8}$'          then '+966' || v
    else v                          -- left as-is, for the CHECK to reject
  end
  from cleaned;
$$;

comment on function app.normalize_phone(text) is
  'Saudi mobile numbers to the single stored form +9665XXXXXXXX. Returns the
   input unchanged when it does not look like one, so the CHECK constraint —
   not this function — is what reports the problem.';

create or replace function app.normalize_member_phone()
returns trigger
language plpgsql
as $$
begin
  new.phone := app.normalize_phone(new.phone);
  return new;
end;
$$;

drop trigger if exists members_normalize_phone on members;

-- BEFORE, so the CHECK constraint below sees the normalised value.
create trigger members_normalize_phone
  before insert or update of phone on members
  for each row execute function app.normalize_member_phone();

-- Existing rows first: the constraint is added validated, so anything the
-- normaliser cannot rescue has to be cleared rather than silently kept.
update members set phone = app.normalize_phone(phone) where phone is not null;

update members
   set phone = null
 where phone is not null
   and phone !~ '^\+9665[0-9]{8}$';

alter table members drop constraint if exists members_phone_format;

alter table members add constraint members_phone_format
  check (phone is null or phone ~ '^\+9665[0-9]{8}$');

-- Phone is searched from the directory page; the index keeps that a lookup
-- rather than a scan once the club is at full size.
create index if not exists members_phone_idx on members (phone);
