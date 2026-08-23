-- =============================================================================
-- 0033 — A transition can ask questions, and a status can insist on answers.
--
-- Two columns, and between them they remove the last place where one request
-- type's needs were hard-coded into shared code.
--
--   request_transitions.field_schema     what this MOVE collects
--   request_statuses.required_data_keys  what a request must HAVE to sit here
--
-- Until now, the request screen carried a special case: if a type had a field
-- called `proposed_start`, it drew two date inputs. That is the counter-offer
-- form for meetings, written into a component every other type also uses. With
-- `field_schema` on the transition it becomes configuration, and the special
-- case goes away.
--
-- `required_data_keys` is the other half, and it is what §7's Design Request
-- needs: "cannot enter In Progress without a Starting Date and a Delivery
-- Date" becomes one row that holds for the first acceptance AND for every
-- revision cycle afterwards, without anyone remembering to re-check it.
-- =============================================================================

alter table request_transitions
  add column if not exists field_schema jsonb not null default '[]'::jsonb;

comment on column request_transitions.field_schema is
  'Extra inputs collected WITH this move — same JSON shape as a type''s own
   field_schema. The answers are merged into requests.data.';

alter table request_statuses
  add column if not exists required_data_keys text[] not null default '{}';

comment on column request_statuses.required_data_keys is
  'Keys that must be present and non-empty in requests.data for a request to be
   in this status. Checked on every transition INTO it, so a loop back through
   the same status is checked again.';

-- -----------------------------------------------------------------------------
-- Enforcement
--
-- Added to the existing transition trigger rather than a new one, so there is
-- still exactly one place that decides whether a move is legal. The check runs
-- after the actor rule: "you may not do that" is a more useful answer than
-- "you left a field blank" when both are true.
-- -----------------------------------------------------------------------------

create or replace function app.validate_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule     request_actor_rule;
  v_perm     text;
  v_required text[];
  v_key      text;
  v_missing  text[] := '{}';
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select t.actor_rule, t.required_permission
    into v_rule, v_perm
  from request_transitions t
  where t.request_type_id = new.request_type_id
    and t.from_status = old.status
    and t.to_status = new.status;

  if not found then
    raise exception 'Status change % -> % is not allowed for this request type',
      old.status, new.status
      using errcode = '23514';
  end if;

  if v_rule = 'requester' then
    if new.submitted_by is distinct from app.current_member_id() then
      raise exception 'Only the person who submitted this request can do that'
        using errcode = '42501';
    end if;

  elsif v_rule = 'target_approver' then
    if not app.can_act_on_request(new.target_team_id, new.target_project_id,
                                  new.target_member_id) then
      raise exception 'You are not an approver for this request''s target'
        using errcode = '42501';
    end if;

  elsif v_rule = 'permission' then
    if not app.can(v_perm,
                   p_team    => new.target_team_id,
                   p_project => new.target_project_id,
                   p_owner   => new.submitted_by) then
      raise exception 'That change requires the % permission', v_perm
        using errcode = '42501';
    end if;
  end if;

  -- What the DESTINATION insists on. `new.data` already carries this move's
  -- answers, because transition_request writes the status and the patch in one
  -- statement — which is the whole reason it does.
  select s.required_data_keys into v_required
  from request_statuses s
  where s.request_type_id = new.request_type_id and s.key = new.status;

  if v_required is not null and array_length(v_required, 1) > 0 then
    foreach v_key in array v_required loop
      if coalesce(nullif(btrim(coalesce(new.data ->> v_key, '')), ''), null) is null then
        v_missing := v_missing || v_key;
      end if;
    end loop;

    if array_length(v_missing, 1) > 0 then
      raise exception 'This step needs: %', array_to_string(v_missing, ', ')
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- The meeting counter-offer, as configuration
--
-- §2 lets a Counter change the time, switch between online and in person, and
-- change the room. All three are now questions the transition asks — which is
-- what closes the gap left open in step 3, where a counter could only move the
-- time because the room input had nowhere generic to live.
--
-- `app.sync_meeting_hold` already reacts to whatever lands in `data`, so
-- nothing else has to change: answer "a different room" here and the hold
-- moves to it, or fails against the exclusion constraint if it is taken.
-- -----------------------------------------------------------------------------

update request_transitions rt
   set field_schema = '[
     {"key":"proposed_start","type":"datetime","required":true,
      "label_en":"New proposed start","label_ar":"الوقت المقترح الجديد"},
     {"key":"proposed_end","type":"datetime","required":false,
      "label_en":"New proposed end","label_ar":"نهاية الوقت المقترح"},
     {"key":"meeting_type","type":"select","required":true,
      "label_en":"Online or in person?","label_ar":"عن بُعد أم حضورياً؟",
      "options":[
        {"value":"online","label_en":"Online (Google Meet)","label_ar":"عن بُعد (Google Meet)"},
        {"value":"in_person","label_en":"In person","label_ar":"حضورياً"}
      ]},
     {"key":"room_id","type":"select","required":false,
      "options_source":"rooms",
      "label_en":"Room (in-person only)","label_ar":"القاعة (للاجتماع الحضوري)"}
   ]'::jsonb
  from request_types t
 where t.id = rt.request_type_id
   and t.key = 'meeting_request'
   and rt.to_status in ('countered_by_target', 'countered_by_requester');
