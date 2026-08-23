-- =============================================================================
-- 0025 — Asset Request, end to end.
--
-- 0023 made "ask Finance for equipment" a request type, but the asset was free
-- text: a Media member wanting the camera had to name it from memory, and
-- Finance had to match the words to a row by hand. This closes both gaps.
--
--   1. `requestable_assets` — a catalogue of WHAT the club owns, readable by
--      anyone signed in, deliberately separate from the register of WHO has
--      what. Picking a camera off a list is not the same as reading the
--      custody history, and only the second is Finance's business.
--
--   2. `app.hook_checkout_asset` — on approval, the checkout row appears by
--      itself, held by the requester until the date they said they would
--      bring it back. Exactly the shape of the Meeting Request hook in 0007:
--      the engine still knows nothing about assets, and the only link is one
--      row in `request_hooks` plus the hook name on the type.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The catalogue
--
-- `security_invoker = off` is the load-bearing word here, and it is chosen,
-- not defaulted into: the view runs as its OWNER, so RLS on `assets` does not
-- apply and a member who cannot read the register can still see this list.
-- That is safe only because of what the view does NOT select — no checkout
-- rows, no holder, no history, and no retired equipment. Adding a column here
-- widens what every member in the club can see, so add one only on purpose.
-- -----------------------------------------------------------------------------

create or replace view public.requestable_assets
with (security_invoker = off) as
select
  a.id,
  a.tag,
  a.name_en,
  a.name_ar,
  a.description,
  a.status,
  -- Whether it is free right now. A boolean, not the holder's name: "someone
  -- has it" is what a requester needs; "who" is the register's business.
  not exists (
    select 1 from asset_checkouts c
    where c.asset_id = a.id and c.returned_at is null
  ) as is_available
from assets a
where a.status <> 'retired'
  and app.is_signed_in();

comment on view public.requestable_assets is
  'What the club owns, for people filing an Asset Request. Bypasses RLS on
   assets BY DESIGN (security_invoker = off) and is kept safe by its column
   list, not by a policy — see migration 0025 before adding a column.';

grant select on public.requestable_assets to authenticated;

-- -----------------------------------------------------------------------------
-- 2. The approval hook
--
-- Runs as the table owner, like every other hook, because the approver is
-- acting on the REQUESTER's behalf: the checkout belongs to the member who
-- asked, not to the Finance Director who clicked Approve.
-- -----------------------------------------------------------------------------

create or replace function app.hook_checkout_asset(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r         requests%rowtype;
  v_asset   uuid;
  v_due     date;
  v_holder  uuid;
begin
  select * into r from requests where id = p_request;

  v_asset := nullif(r.data ->> 'asset_id', '')::uuid;

  -- A request approved without a specific asset chosen is a legitimate
  -- outcome — Finance may have agreed in principle and be handing over
  -- something else. Approval must not fail because of it.
  if v_asset is null then
    return;
  end if;

  v_due := nullif(r.data ->> 'return_by', '')::date;

  -- Whoever is holding it stays holding it. The partial unique index in 0009
  -- would refuse a second active checkout anyway; returning early turns that
  -- into a no-op instead of an error that would roll back the approval.
  select member_id into v_holder
  from asset_checkouts
  where asset_id = v_asset and returned_at is null;

  if v_holder is not null then
    return;
  end if;

  insert into asset_checkouts (asset_id, member_id, due_back_on, checked_out_by, note)
  values (
    v_asset,
    r.submitted_by,
    v_due,
    app.current_member_id(),   -- the approver, acting for the requester
    'Asset Request ' || r.id::text
  );

  -- `assets.status` is not touched here: `asset_checkouts_sync_status` (0009)
  -- already flips it on insert, and doing it twice would mean two places to
  -- keep in step.
end;
$$;

insert into request_hooks (name, function_schema, function_name, description)
values (
  'checkout_asset',
  'app',
  'hook_checkout_asset',
  'Hands the requested asset to the requester when an Asset Request is approved.'
)
on conflict (name) do update
  set function_schema = excluded.function_schema,
      function_name   = excluded.function_name,
      description     = excluded.description;

-- -----------------------------------------------------------------------------
-- 3. The type itself
--
-- `options_source` is new in the field schema: the select's choices are looked
-- up live rather than frozen into the JSON, because the club buys and retires
-- equipment and a hard-coded list would be wrong within a term. The renderer
-- treats an unknown source as an empty list, so this stays additive.
-- -----------------------------------------------------------------------------

update request_types
   set on_approval_hook = 'checkout_asset',
       description_en = 'Ask Finance to lend you a piece of club equipment for an event.',
       description_ar = 'طلب استعارة إحدى عهد النادي من الفريق المالي لفعالية.',
       field_schema = '[
         {"key":"asset_id","type":"select","required":true,
          "options_source":"assets",
          "label_en":"Which item?","label_ar":"أي عهدة؟"},
         {"key":"event","type":"text","required":true,
          "label_en":"For which event?","label_ar":"لأي فعالية؟"},
         {"key":"purpose","type":"textarea","required":false,
          "label_en":"What will you use it for?","label_ar":"وصف الاستخدام"},
         {"key":"needed_from","type":"date","required":true,
          "label_en":"Needed from","label_ar":"مطلوبة من تاريخ"},
         {"key":"return_by","type":"date","required":true,
          "label_en":"Returning on","label_ar":"تاريخ الإرجاع"}
       ]'::jsonb
 where key = 'asset_request';
