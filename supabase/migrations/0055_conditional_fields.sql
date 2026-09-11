-- =============================================================================
-- 0055 — A field can wait for an answer before it is asked.
--
-- `show_when` on a field in `field_schema` — {"key": …, "value": …} — means
-- "only ask this when THAT field holds THIS value". The form leaves the
-- field out entirely otherwise, and the server skips it the same way, so a
-- required-but-hidden question is never demanded (src/lib/requests.ts,
-- `fieldApplies`). Nothing else about a field changes.
--
-- Applied here to every question that already had an "only if" in its label:
-- the free-text "if other, what?" after a type select, and the room (and the
-- note about the place) for a meeting that is in person.
-- =============================================================================

-- Adds show_when to one field of a schema, leaving the rest untouched.
create or replace function app.field_show_when(
  p_schema     jsonb,
  p_field      text,
  p_when_key   text,
  p_when_value text
)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (select jsonb_agg(
       case when f ->> 'key' = p_field
            then f || jsonb_build_object('show_when',
                        jsonb_build_object('key', p_when_key, 'value', p_when_value))
            else f end
       order by o)
     from jsonb_array_elements(p_schema) with ordinality as x (f, o)),
    '[]'::jsonb)
$$;

-- --- The "if other, what?" questions (0054) ----------------------------------

update request_types
   set field_schema = app.field_show_when(field_schema, 'content_type_other', 'content_type', 'other')
 where key = 'content_request';

update request_types
   set field_schema = app.field_show_when(field_schema, 'document_type_other', 'document_type', 'other')
 where key = 'legal_document_request';

-- --- The room, only for an in-person meeting ---------------------------------

-- The Meeting Request's own form: the room and the note about the place.
update request_types
   set field_schema = app.field_show_when(
         app.field_show_when(field_schema, 'room_id', 'meeting_type', 'in_person'),
         'location', 'meeting_type', 'in_person')
 where key = 'meeting_request';

-- Every transition that asks about a room: the meeting counter-offers (0033)
-- and the "require a meeting first" checkpoints (0041, 0054), whichever type
-- they belong to.
update request_transitions
   set field_schema = app.field_show_when(field_schema, 'room_id', 'meeting_type', 'in_person')
 where field_schema @> '[{"key": "room_id"}]'::jsonb;

-- And the template those checkpoints are stamped from, so the next type to
-- use it gets the same behaviour.
create or replace function app.meeting_transition_fields()
returns jsonb
language sql
immutable
as $$
  select '[
    {"key":"meeting_title","type":"text","required":true,
     "label_en":"Meeting title","label_ar":"عنوان الاجتماع"},
    {"key":"meeting_reason","type":"textarea","required":false,
     "label_en":"What needs discussing?","label_ar":"ما الذي يحتاج نقاشاً؟"},
    {"key":"meeting_type","type":"select","required":true,
     "label_en":"Online or in person?","label_ar":"عن بُعد أم حضورياً؟",
     "options":[
       {"value":"online","label_en":"Online (Google Meet)","label_ar":"عن بُعد (Google Meet)"},
       {"value":"in_person","label_en":"In person","label_ar":"حضورياً"}
     ]},
    {"key":"room_id","type":"select","required":false,
     "options_source":"rooms",
     "show_when":{"key":"meeting_type","value":"in_person"},
     "label_en":"Room","label_ar":"القاعة"},
    {"key":"proposed_start","type":"datetime","required":true,
     "label_en":"Proposed start","label_ar":"الوقت المقترح"},
    {"key":"proposed_end","type":"datetime","required":false,
     "label_en":"Proposed end","label_ar":"نهاية الوقت المقترح"}
  ]'::jsonb
$$;

-- The labels no longer need to say "in-person only" — the form shows it only then.
update request_types
   set field_schema = (
     select jsonb_agg(
       case when f ->> 'key' = 'room_id'
            then f || '{"label_en":"Room","label_ar":"القاعة"}'::jsonb
            else f end
       order by o)
     from jsonb_array_elements(field_schema) with ordinality as x (f, o))
 where key = 'meeting_request';

update request_transitions
   set field_schema = (
     select jsonb_agg(
       case when f ->> 'key' = 'room_id'
            then f || '{"label_en":"Room","label_ar":"القاعة"}'::jsonb
            else f end
       order by o)
     from jsonb_array_elements(field_schema) with ordinality as x (f, o))
 where field_schema @> '[{"key": "room_id"}]'::jsonb;

notify pgrst, 'reload schema';
