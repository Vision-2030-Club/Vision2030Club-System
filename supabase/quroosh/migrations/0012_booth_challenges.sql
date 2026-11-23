-- Quroosh 0012: the questions booth's two games for Quroosh 2026.
--
-- Data only: no table, column or function changes. Adds four challenges
-- (0008) with their questions to the Quroosh project:
--
--   Genesis                       no day: played on every day of the event
--   الجلسة الحوارية · 2026-11-23   عبدالله الدبوس (MyFatoorah)
--   الجلسة الحوارية · 2026-11-24   عبدالرحمن المرشد (The Chefz)
--   الجلسة الحوارية · 2026-11-25   أحمد العنزي (برق)
--
-- Each challenge keeps the 0008 defaults: 20 seconds a question, 3,000
-- quroosh at most. Managers can change both, and the questions, on the
-- Challenges page afterwards; the booth's QR code is on each challenge's page.
--
-- The project is the one that has guest accounts (0006). The file refuses to
-- run if that is not exactly one project, rather than guessing.
--
-- Safe to run twice: a challenge that already exists for the same booth and
-- day is left alone, questions included.

do $$
declare
  v_project uuid;
  v_count   int;
  v_id      uuid;
  c         jsonb;
  q         jsonb;
  n         int;
begin
  select count(distinct project_id), min(project_id::text)::uuid
    into v_count, v_project
    from accounts;

  if v_count <> 1 then
    raise exception 'Expected guest accounts for exactly one project, found %. Set the project id by hand.', v_count;
  end if;

  for c in select * from jsonb_array_elements($json$[
    {
      "booth": "Genesis",
      "topic": "جينيسيس",
      "day": null,
      "questions": [
        {"prompt": "متى أُعلن عن إطلاق جينيسيس كشركة مستقلة؟",
         "options": ["2015", "2009", "2020", "2010"], "correct": 0},
        {"prompt": "في أي دولة تأسست علامة جينيسيس؟",
         "options": ["اليابان", "كوريا الجنوبية", "السعودية", "ألمانيا"], "correct": 1},
        {"prompt": "ما الحدث الرياضي السعودي الذي كانت جينيسيس شريكاً رئيسياً له؟",
         "options": ["دورة الألعاب السعودية", "كأس العالم", "الألعاب الأولمبية", "سباق الفورملا"], "correct": 0}
      ]
    },
    {
      "booth": "الجلسة الحوارية",
      "topic": "عبدالله الدبوس · MyFatoorah",
      "day": "2026-11-23",
      "questions": [
        {"prompt": "متى أُسست MyFatoorah؟",
         "options": ["2010", "2016", "2020", "2024"], "correct": 1},
        {"prompt": "ما هي الخدمات التي تقدمها MyFatoorah؟",
         "options": ["الفواتير الإلكترونية", "الدفع عبر رمز QR", "أجهزة نقاط البيع", "جميع ما سبق"], "correct": 3},
        {"prompt": "من مؤسس MyFatoorah؟",
         "options": ["حمد البكر", "عبدالله الدبوس", "عبدالرحمن العليان", "إبراهيم الجاسم"], "correct": 1}
      ]
    },
    {
      "booth": "الجلسة الحوارية",
      "topic": "عبدالرحمن المرشد · The Chefz",
      "day": "2026-11-24",
      "questions": [
        {"prompt": "متى أُسس تطبيق The Chefz؟",
         "options": ["2010", "2016", "2020", "2024"], "correct": 1},
        {"prompt": "من أي مدينة سعودية انطلق تطبيق The Chefz؟",
         "options": ["جدة", "الدمام", "الرياض", "الخبر"], "correct": 2},
        {"prompt": "من أبرز مؤسسي تطبيق The Chefz والرئيس التنفيذي له؟",
         "options": ["عبدالرحمن المرشد", "عمر العليان", "نواف الحريري", "أيمن السند"], "correct": 0}
      ]
    },
    {
      "booth": "الجلسة الحوارية",
      "topic": "أحمد العنزي · برق",
      "day": "2026-11-25",
      "questions": [
        {"prompt": "في أي عام تأسست شركة برق؟",
         "options": ["2015", "2020", "2023", "2026"], "correct": 2},
        {"prompt": "من مؤسس شركة برق؟",
         "options": ["أحمد العنزي", "هشام الفالح", "إبراهيم الجاسم", "حمد البكر"], "correct": 0},
        {"prompt": "من أبرز الخدمات التي يقدمها تطبيق برق؟",
         "options": ["التحويلات المالية المحلية والدولية", "توصيل الطلبات", "حجز تذاكر السينما", "الرعاية الصحية"], "correct": 0}
      ]
    }
  ]$json$::jsonb)
  loop
    if exists (
      select 1 from challenges
       where project_id = v_project
         and booth = c->>'booth'
         and day is not distinct from (c->>'day')::date
    ) then
      raise notice 'Skipped: % (%), already there', c->>'booth', coalesce(c->>'day', 'every day');
      continue;
    end if;

    -- The token is what the booth's QR code holds: 48 lowercase hex characters.
    insert into challenges (project_id, token, booth, topic, day)
    values (
      v_project,
      substr(md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), 1, 48),
      c->>'booth',
      c->>'topic',
      (c->>'day')::date
    )
    returning id into v_id;

    n := 0;
    for q in select * from jsonb_array_elements(c->'questions') loop
      n := n + 1;
      insert into challenge_questions (challenge_id, position, prompt, options, correct)
      values (v_id, n, q->>'prompt', q->'options', (q->>'correct')::smallint);
    end loop;

    raise notice 'Added: % (%), % questions', c->>'booth', coalesce(c->>'day', 'every day'), n;
  end loop;
end
$$;
