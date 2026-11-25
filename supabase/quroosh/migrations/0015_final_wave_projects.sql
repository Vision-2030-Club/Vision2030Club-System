-- Quroosh 0015: the ten projects of the Final Wave (الحفل الختامي) for
-- Quroosh 2026.
--
-- Data only: no table, column or function changes. Needs 0014. Adds the ten
-- projects on stage at the closing ceremony, each with its brief, in the
-- order the club gave them (2026-11-25). Their wording is the club's.
--
-- The projects are added to the list only: the Final Wave stays as it was
-- (hidden until a manager opens it on the الحفل الختامي page). Managers can
-- rewrite, hide or add projects there afterwards.
--
-- The project is the one that has guest accounts (0006). The file refuses to
-- run if that is not exactly one project, rather than guessing.
--
-- Safe to run twice: a project whose name is already on the list is left
-- alone, brief included.

do $$
declare
  v_project uuid;
  v_count   int;
  p         jsonb;
begin
  select count(distinct project_id), min(project_id::text)::uuid
    into v_count, v_project
    from accounts;

  if v_count <> 1 then
    raise exception 'Expected guest accounts for exactly one project, found %. Set the project id by hand.', v_count;
  end if;

  for p in select * from jsonb_array_elements($json$[
    {"name": "جايك",
     "brief": "جايك تطبيق لخدمات الحلاقة المنزلية في الرياض، يتيح لك حجز موعد يناسبك، ويوصّل لك الحلاق إلى باب بيتك"},
    {"name": "هوستلي",
     "brief": "هوستلي شركة ناشئة تقدم حلول تأثيث متكاملة لمستثمري قطاع التأجير اليومي، بهدف تسهيل تجهيز الوحدات السكنية ورفع عوائدها الاستثمارية."},
    {"name": "محصلة",
     "brief": "محصّلة تكشف للتجار الربح الحقيقي لكل طلب من متاجرهم المرتبطة، بحساب التكلفة والرسوم والشحن والمرتجعات والضريبة تلقائياً، لقرارات تنمّي أرباحهم."},
    {"name": "Reach more",
     "brief": "ريتش مور موظف ذكاء اصطناعي يمكنك الاعتماد عليه لكامل تجربة العميل، يجاوب، يؤهل، يبيع، يحجز، يذكر، يتابع، ويستمر بالتعلم، يعمل على كل قنوات تواصل الشركات"},
    {"name": "سراج",
     "brief": "سراج شركة سعودية ناشئة متخصصة في تطوير حلول مبتكرة مدعومة بالذكاء الاصطناعي في مجال البحث والإنقاذ لخدمة ودعم مختلف القطاعات الحيوية"},
    {"name": "C2C",
     "brief": "هو تطبيق يتيح للمشتري خيارات أمان مختلفة للمبايعات عن بعد عبر التوثيق بكود يضمن للبائع الموثوقية وللمشتري الحقوق"},
    {"name": "أكاديمية فريد",
     "brief": "فريد أكاديمي منظومة متكاملة للتعلّم الاجتماعي والعاطفي: جلسات فردية، واشتراك عائلي تفاعلي، ومنصّة مدرسية؛ نطمح لنكون المنصّة الأكبر عالميًا بالمجال بحلول 2030."},
    {"name": "رعد",
     "brief": "رعد تطبيق سعودي للتنقل المجدول، يربط الركاب بكابتن ثابت لرحلاتهم المتكررة، باشتراكات شهرية توفر تجربة تنقل يومية أكثر موثوقية واستقرارًا."},
    {"name": "قطة باي",
     "brief": "حوّلنا «القطة» من سلوك اجتماعي إلى وسيلة دفع إلكترونية، تُمكّن التجار من الاستفادة من القوة الشرائية للمجموعة وتفتح الفرص لنمو ومبيعات أعلى."},
    {"name": "MyTrip",
     "brief": "منظومة تقنية ذكية تعيد تعريف تجربة المسافر داخل المطارات، عبر أتمتة رحلته، وتسهيل تنقله، وربطه بالبيانات والخدمات لحظيًّا"}
  ]$json$::jsonb)
  loop
    -- final_project_save (0014) checks the lengths and puts each one last,
    -- so the list keeps this file's order.
    if not exists (
      select 1 from final_projects f
       where f.project_id = v_project and f.name = p->>'name'
    ) then
      perform public.final_project_save(v_project, null, p->>'name', p->>'brief');
    end if;
  end loop;
end;
$$;
