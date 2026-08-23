-- =============================================================================
-- 0036 — A status can void data that is no longer true.
--
-- Found by `npm run db:design`: §7 says a revision cycle needs a NEW Starting
-- Date and Delivery Date before work can restart. `required_data_keys` (0033)
-- only asks whether they are PRESENT — and after the first acceptance they
-- always are, still sitting in `data` from last time. So the second round let
-- the request go straight back to In Progress carrying dates Design had
-- already missed.
--
-- Presence was the wrong question. The right one is "is this commitment still
-- current?", and the answer is no the moment the work comes back for changes.
--
--   request_statuses.clears_data_keys  keys wiped on entering this status
--
-- Paired with `required_data_keys`, that expresses the whole rule as two rows:
-- Revision Required voids the dates, In Progress refuses to be entered without
-- them. Neither mentions design work, and the loop is checked identically on
-- the first pass and the fiftieth.
-- =============================================================================

alter table request_statuses
  add column if not exists clears_data_keys text[] not null default '{}';

comment on column request_statuses.clears_data_keys is
  'Keys removed from requests.data when a request ENTERS this status, because
   arriving here makes them untrue. A status should not both clear and collect
   the same key — that configuration can never be satisfied.';

create or replace function app.validate_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule     request_actor_rule;
  v_perm     text;
  v_status   request_statuses%rowtype;
  v_key      text;
  v_missing  text[] := '{}';
  v_system   boolean;
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

  v_system := coalesce(current_setting('app.system_move', true), '') = 'on';

  if not v_system then
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
  end if;

  select * into v_status
  from request_statuses s
  where s.request_type_id = new.request_type_id and s.key = new.status;

  -- Void first. Arriving somewhere is what makes these untrue, so they go
  -- before anything is asked about what the request now holds.
  if array_length(v_status.clears_data_keys, 1) > 0 then
    foreach v_key in array v_status.clears_data_keys loop
      new.data := new.data - v_key;
    end loop;
  end if;

  -- Required data is checked for EVERYBODY, the system included. "In Progress
  -- needs both dates" is a fact about the request, not about who is asking.
  if array_length(v_status.required_data_keys, 1) > 0 then
    foreach v_key in array v_status.required_data_keys loop
      if nullif(btrim(coalesce(new.data ->> v_key, '')), '') is null then
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

-- §7: coming back for changes voids the dates Design committed to. The next
-- move into In Progress therefore has to collect them again — which its
-- transition already asks for, and `required_data_keys` already insists on.
update request_statuses s
   set clears_data_keys = '{starting_date,delivery_date}'
  from request_types t
 where t.id = s.request_type_id
   and t.key = 'design_request'
   and s.key = 'revision_required';
