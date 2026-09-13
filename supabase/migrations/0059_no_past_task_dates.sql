-- =============================================================================
-- 0059 — A task's dates cannot be behind the club's calendar.
--
-- The IT team could create a task due last week. The New Task and send-back
-- forms are checked in tasks/actions.ts (a date typed into a form is on the
-- club's calendar; toDateInput gives today on that clock). The third place a
-- task's dates come from is data: the "Accept and start the work" move on a
-- Content/Media/Design/Legal Document request asks for a starting and a
-- delivery date. Marking them `no_past` (0057) puts the same floor there —
-- RequestFields sets the input's `min`, requests/actions.ts refuses.
-- =============================================================================

update request_transitions
   set field_schema = (
     select jsonb_agg(
       case when f ->> 'key' in ('starting_date', 'delivery_date')
            then f || '{"no_past": true}'::jsonb
            else f end
       order by o)
     from jsonb_array_elements(field_schema) with ordinality as x (f, o))
 where field_schema @> '[{"key": "starting_date"}]'::jsonb
    or field_schema @> '[{"key": "delivery_date"}]'::jsonb;
