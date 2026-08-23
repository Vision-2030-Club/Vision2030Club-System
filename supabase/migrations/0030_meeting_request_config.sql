-- =============================================================================
-- 0030 — The Meeting Request, reconfigured.
--
-- Everything here is DATA. The Meetings component gained rooms, an online /
-- in-person choice and a confirm hook in 0029; this file is the type's form
-- and its hook name, which is all the engine needs to start using them.
--
-- No new form component was written for any of it: the three new questions are
-- rows in `field_schema`, and the two that need a live list use the same
-- `options_source` mechanism the asset picker uses.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. "Booking the room as" — the groups this person may speak for
--
-- §4 forbids booking on behalf of a group you are not part of, and §5 (as
-- confirmed) makes the proposer's side symmetric with the target's. Both need
-- the same list, and `app.can` already knows it: a Director's rooms.book scope
-- is own_team, a PM's is own_projects, the Presidency's is all.
--
-- `security_invoker = on` matters here — the view has to see the CALLER's
-- permissions, not the owner's, or everyone would be offered everything.
-- -----------------------------------------------------------------------------

create or replace view public.my_booking_identities
with (security_invoker = on) as
select
  'presidency'::text as id,
  'Presidency'       as name_en,
  'الرئاسة'          as name_ar
where app.effective_scope('rooms.book') = 'all'

union all

select 'team:' || t.id, t.name_en, t.name_ar
from teams t
where app.effective_scope('rooms.book') = 'own_team'
  and app.can('rooms.book', p_team => t.id)
  and t.is_active

union all

select 'project:' || p.id, p.name_en, p.name_ar
from projects p
where app.effective_scope('rooms.book') = 'own_projects'
  and app.can('rooms.book', p_project => p.id);

comment on view public.my_booking_identities is
  'The groups the CALLER may book a room as. Filtered by app.can, so the picker
   can never offer something room_bookings_insert would then refuse.';

grant select on public.my_booking_identities to authenticated;

-- -----------------------------------------------------------------------------
-- 2. The form
--
-- `meeting_type` and `room_id` are ordinary select fields; the room list and
-- the identity list are looked up live because both change over time. Neither
-- is marked required, because whether a room is needed depends on the answer
-- to another question — something a static schema cannot express. The database
-- says so instead, in `app.sync_meeting_hold`: proposing an in-person meeting
-- without a room is refused with a sentence that explains itself.
-- -----------------------------------------------------------------------------

update request_types
   set on_approval_hook = 'confirm_meeting',
       field_schema = '[
         {"key":"title","type":"text","required":true,
          "label_en":"Meeting title","label_ar":"عنوان الاجتماع"},
         {"key":"description","type":"textarea","required":false,
          "label_en":"What is it about?","label_ar":"موضوع الاجتماع"},
         {"key":"meeting_type","type":"select","required":true,
          "label_en":"Online or in person?","label_ar":"عن بُعد أم حضورياً؟",
          "options":[
            {"value":"online","label_en":"Online (Google Meet)","label_ar":"عن بُعد (Google Meet)"},
            {"value":"in_person","label_en":"In person","label_ar":"حضورياً"}
          ]},
         {"key":"proposer_identity","type":"select","required":false,
          "options_source":"booking_identities",
          "label_en":"Booking the room as","label_ar":"حجز القاعة باسم"},
         {"key":"room_id","type":"select","required":false,
          "options_source":"rooms",
          "label_en":"Room (in-person only)","label_ar":"القاعة (للاجتماع الحضوري)"},
         {"key":"proposed_start","type":"datetime","required":true,
          "label_en":"Proposed start","label_ar":"الوقت المقترح للبداية"},
         {"key":"proposed_end","type":"datetime","required":false,
          "label_en":"Proposed end","label_ar":"الوقت المقترح للنهاية"},
         {"key":"location","type":"text","required":false,
          "label_en":"Note about the place","label_ar":"ملاحظة عن المكان"}
       ]'::jsonb
 where key = 'meeting_request';

-- -----------------------------------------------------------------------------
-- 3. Rooms, readable enough to be picked
--
-- The register itself stays behind `rooms_select`, which only the people who
-- may book can read. That is the right rule for the schedule — but somebody
-- proposing an in-person meeting has to be able to NAME a room, and the person
-- proposing is not always the person whose group books it.
--
-- So the picker reads a view listing nothing but the names of rooms in
-- service. Whether the meeting may actually hold one is still decided by
-- `app.sync_meeting_hold`, which asks app.can and refuses out loud.
-- -----------------------------------------------------------------------------

create or replace view public.pickable_rooms
with (security_invoker = off) as
select r.id, r.name_en, r.name_ar
from rooms r
where r.is_active
  and app.is_signed_in();

comment on view public.pickable_rooms is
  'Room NAMES, for the meeting request form. Bypasses RLS on rooms by design
   (security_invoker = off) and is kept safe by its column list: no bookings,
   no holders, no schedule. Adding a column here widens what every signed-in
   member can see.';

grant select on public.pickable_rooms to authenticated;
