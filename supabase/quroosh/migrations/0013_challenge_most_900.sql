-- Quroosh 0013: a booth challenge pays at most 900 quroosh, not 3,000.
--
--   * New challenges start at 900 (the column default and challenge_save).
--   * Existing challenges still on the old default of 3,000 move to 900,
--     including the four booth challenges of 0012. A challenge a manager set
--     to any other number is left alone.
--   * Attempts already finished keep what they were paid: nothing in the
--     ledger is recounted.
--
-- With the formula of 0008 and three questions, a right answer is now worth
-- 150 to 300 quroosh, depending on how quickly it came.
--
-- Managers can still set any challenge to another number on its page.
-- Safe to run twice, and safe to run before or after 0012.

alter table challenges alter column max_points set default 900;

update challenges set max_points = 900 where max_points = 3000;

-- Same as 0008, with 900 in place of 3000 when no number is given.
create or replace function public.challenge_save(
  p_project uuid,
  p_id uuid,
  p_token text,
  p_booth text,
  p_topic text,
  p_day date,
  p_seconds integer,
  p_max_points integer,
  p_active boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into challenges (project_id, token, booth, topic, day, seconds_per_question, max_points, active)
    values (p_project, p_token, btrim(p_booth), nullif(btrim(coalesce(p_topic, '')), ''), p_day,
            coalesce(p_seconds, 20), coalesce(p_max_points, 900), coalesce(p_active, true))
    returning id into v_id;
  else
    update challenges c
       set booth = btrim(p_booth),
           topic = nullif(btrim(coalesce(p_topic, '')), ''),
           day = p_day,
           seconds_per_question = coalesce(p_seconds, c.seconds_per_question),
           max_points = coalesce(p_max_points, c.max_points),
           active = coalesce(p_active, c.active)
     where c.id = p_id and c.project_id = p_project
    returning c.id into v_id;
    if v_id is null then
      perform app.refuse('not_found', 'This challenge does not exist.');
    end if;
  end if;
  return v_id;
exception
  when check_violation or not_null_violation or unique_violation then
    perform app.refuse('challenge_invalid', 'The challenge could not be saved: ' || sqlerrm);
    return null;
end;
$$;

revoke execute on function public.challenge_save(uuid, uuid, text, text, text, date, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.challenge_save(uuid, uuid, text, text, text, date, integer, integer, boolean) to service_role;

notify pgrst, 'reload schema';
