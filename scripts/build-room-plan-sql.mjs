/**
 * Turns the club's Mock Interviews room timetable (the "Rooms" sheet of
 * "Confirmed Participants _ 5th edition افترض.xlsx") into one SQL file for
 * the Mock Interviews SQL editor, which assigns every company to its rooms.
 *
 *   node scripts/build-room-plan-sql.mjs "path/to/sheet.xlsx" room-plan.sql
 *
 * The sheet: a "Day N - DD Mon" heading per day, a TIME / Room 1 … Room 14
 * header, one row per 20-minute slot from 14:00 to 19:40 (Excel time
 * values), two full-width "Prayer Break" rows, and the company's name in
 * each cell. Column P holds notes. A company's run of cells in one room on
 * one day is one assignment (create_session); the prayer-break rows do not
 * split it.
 *
 * What the club decided on 2026-10-16 about this sheet, encoded below:
 *   - Companies and rooms already exist in the edition; names match the
 *     sheet exactly (English or Arabic name). "Room 3f" is Room 3.
 *   - "<X> LAST INTERVIEW @ 6:00PM NO PRAYER BREAK" (BSF, Impact 46, Pwc,
 *     alan) means Maghrib only: those companies keep Asr, interview at 17:30
 *     during Maghrib, and also at 18:00 when their room is free then. BSF on
 *     18 Oct gets 17:30 only, because TTP has Room 3 at 18:00.
 *   - Everyone else keeps both breaks, exactly as drawn.
 *
 * The SQL does nothing until pasted into the editor by a person. Step 1 is a
 * read-only preview; step 2 is one transaction that stops, writing nothing,
 * if a name does not match, a room is ambiguous, the edition already has
 * assignments, 0017 is missing, or any assignment's times come out
 * different from what this script expects.
 */
import { writeFileSync } from 'node:fs';
import { openWorkbook } from './lib/xlsx.mjs';

const [XLSX, OUT] = process.argv.slice(2);
if (!XLSX || !OUT) {
  console.error('Usage: node scripts/build-room-plan-sql.mjs "<sheet.xlsx>" <out.sql>');
  process.exit(1);
}

const EDITION_SLUG = 'mockup-interviews-2026';
const YEAR = 2026;
const ROOM_ALIASES = { 'Room 3f': 'Room 3' };
/** Companies that interview through Maghrib (the sheet's column-P notes). */
const NO_MAGHRIB = new Set(['BSF', 'Impact 46', 'Pwc', 'alan']);
const MAGHRIB = ['17:30', '18:00'];
const ACTOR = { kind: 'system', name: 'Room plan import (5th edition sheet)' };

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const COLS = 'BCDEFGHIJKLMNO'.split('');

const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const excelTime = (v) => toTime(Math.round(Number(v) * 24 * 60));
const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------------------
// Read the grid into blocks
// ---------------------------------------------------------------------------

const wb = openWorkbook(XLSX);
if (!wb.sheetNames.includes('Rooms')) {
  console.error(`No "Rooms" sheet in ${XLSX} (sheets: ${wb.sheetNames.join(', ')}).`);
  process.exit(1);
}
const rows = wb.rows('Rooms').filter((r) => Object.values(r.cells).some((v) => v));

let day = null;
let header = {};
const open = new Map();
const blocks = [];
const notes = [];
const problems = [];
const close = (key) => {
  if (open.has(key)) blocks.push(open.get(key));
  open.delete(key);
};

for (const r of rows) {
  const a = (r.cells.A ?? '').trim();
  const dayMatch = a.match(/^Day \d+ - (\d{1,2}) ([A-Z][a-z]{2})$/);
  if (dayMatch) {
    for (const k of [...open.keys()]) close(k);
    const month = MONTHS[dayMatch[2]];
    if (!month) problems.push(`row ${r.row}: month "${dayMatch[2]}" not understood`);
    day = `${YEAR}-${String(month).padStart(2, '0')}-${dayMatch[1].padStart(2, '0')}`;
    continue;
  }
  if (a === 'TIME') {
    header = Object.fromEntries(COLS.map((c) => [c, (r.cells[c] ?? '').trim()]));
    continue;
  }
  if (r.cells.P) notes.push(`${day} row ${r.row}: ${r.cells.P}`);
  if (/^Prayer Break/.test(a)) continue; // a break row does not split a block
  if (!/^0?\.\d+$/.test(a)) {
    if (a && !/افترض/.test(a)) problems.push(`row ${r.row}: column A "${a}" is neither a day, a time nor a prayer break`);
    continue;
  }
  if (!day) {
    problems.push(`row ${r.row}: a time before any "Day N" heading`);
    continue;
  }
  const t = excelTime(a);
  for (const c of COLS) {
    const key = `${day}|${c}`;
    const company = (r.cells[c] ?? '').trim();
    const b = open.get(key);
    if (b && b.company === company) {
      b.rows.push(t);
      continue;
    }
    close(key);
    if (company) {
      const sheetRoom = header[c];
      if (!sheetRoom) problems.push(`row ${r.row}: a company in column ${c}, which has no room heading`);
      open.set(key, { day, room: ROOM_ALIASES[sheetRoom] ?? sheetRoom, sheetRoom, company, rows: [t] });
    }
  }
}
for (const k of [...open.keys()]) close(k);

// ---------------------------------------------------------------------------
// Turn blocks into assignments, applying the club's decisions
// ---------------------------------------------------------------------------

const busyAt = (d, room, time) =>
  blocks.some((b) => b.day === d && b.room === room && b.rows.includes(time));

const plan = blocks.map((b) => {
  const first = b.rows[0];
  const last = b.rows.at(-1);
  const p = {
    day: b.day,
    room: b.room,
    company: b.company,
    start: first,
    end: toTime(toMin(last) + 20),
    extendTo: null,
    noMaghrib: NO_MAGHRIB.has(b.company),
    expected: [...b.rows],
  };
  if (!p.noMaghrib) return p;

  // 17:30 always; 18:00 too when the room is free then. Asr is kept, so the
  // run before 17:10 is exactly the sheet's rows.
  if (last === '18:00') {
    p.expected = [...b.rows.slice(0, -1), '17:30', '18:00'];
  } else if (last === '17:10') {
    if (!busyAt(b.day, b.room, '18:00')) {
      p.end = '18:20';
      p.expected = [...b.rows, ...MAGHRIB];
    } else {
      // Made up to 17:30 with the break, then grown to 17:50 once the break is off.
      p.extendTo = '17:50';
      p.expected = [...b.rows, '17:30'];
    }
  } else {
    problems.push(
      `${b.day} ${b.room} ${b.company}: a no-Maghrib company whose last row is ${last}, which the club's decision does not cover`,
    );
  }
  return p;
});

// Every no-Maghrib note names a company in the plan, and every such company has a note.
for (const name of NO_MAGHRIB) {
  if (!plan.some((p) => p.company === name)) problems.push(`no-Maghrib company "${name}" is not in the sheet`);
}

if (problems.length) {
  console.error('Problems — nothing written:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

// Sanity: the sheet's own rows, and the expected total after the decisions.
const sheetSlots = blocks.reduce((n, b) => n + b.rows.length, 0);
const finalSlots = plan.reduce((n, p) => n + p.expected.length, 0);

// ---------------------------------------------------------------------------
// Write the SQL
// ---------------------------------------------------------------------------

const values = plan
  .map(
    (p, i) =>
      `  (${i + 1}, date ${sql(p.day)}, ${sql(p.room)}, ${sql(p.company)}, ${sql(p.start)}, ${sql(p.end)}, ` +
      `${p.extendTo ? sql(p.extendTo) : 'null'}, ${p.noMaghrib}, ${sql(p.expected.join(','))})`,
  )
  .join(',\n');
const PLAN_COLUMNS = '(n, day, room, company, start_time, end_time, extend_to, no_maghrib, expected)';
const actor = sql(JSON.stringify(ACTOR));

const days = [...new Set(plan.map((p) => p.day))];
const companies = [...new Set(plan.map((p) => p.company))];
const rooms = [...new Set(plan.map((p) => p.room))];

const file = `-- =============================================================================
-- Room plan for the 5th edition (${EDITION_SLUG}), generated from the
-- "Rooms" sheet by scripts/build-room-plan-sql.mjs. Do not edit by hand:
-- change the sheet or the script and generate again.
--
-- Run in the MOCK INTERVIEWS Supabase project's SQL editor, not the club's.
-- Two steps, each in its own NEW, EMPTY query tab. Needs migration 0017.
--
--   ${plan.length} assignments, ${companies.length} companies, ${rooms.length} rooms, days ${days.join(', ')}.
--   ${sheetSlots} interview times as drawn; ${finalSlots} after the club's decisions:
--   BSF, Impact 46, Pwc and alan interview through Maghrib (17:30, and 18:00
--   when their room is free); everyone keeps Asr; everyone else keeps both.
--
-- Step 2 writes everything or nothing. It stops, writing nothing, if: the
-- edition is not found or archived; 0017 is not applied; a company name does
-- not match exactly one company, or matches a hidden one; a room name does not
-- match exactly one active room; a room's own days (Rooms tab) exclude a day it
-- is used; the edition already has any assignment; or any assignment's times
-- differ from the sheet's after the decisions above.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 — PREVIEW. Read-only. Run this alone first.
-- Every line should say OK. Anything else says what to fix before Step 2.
-- -----------------------------------------------------------------------------

with plan ${PLAN_COLUMNS} as (values
${values}
),
ed as (
  select * from editions where public_slug = ${sql(EDITION_SLUG)}
),
co as (
  select pc.company,
         pc.no_maghrib,
         count(c.id) filter (where not c.is_hidden) as matches,
         count(c.id) filter (where c.is_hidden) as hidden_namesakes,
         string_agg(coalesce(to_jsonb(c) ->> 'asr_break', 'n/a') || '/' || coalesce(to_jsonb(c) ->> 'maghrib_break', 'n/a'), ' ')
           filter (where not c.is_hidden) as breaks
    from (select distinct company, no_maghrib from plan) pc
    left join companies c on c.edition_id = (select id from ed) and (c.name_en = pc.company or c.name_ar = pc.company)
   group by pc.company, pc.no_maghrib
),
ro as (
  select pr.room,
         count(r.id) filter (where r.is_active) as active,
         count(r.id) as total
    from (select distinct room from plan) pr
    left join rooms r on r.edition_id = (select id from ed) and r.name = pr.room
   group by pr.room
),
rd as (
  select distinct p.day, p.room, rm.id as room_id
    from plan p
    join rooms rm on rm.edition_id = (select id from ed) and rm.name = p.room and rm.is_active
),
checks (sort, item, status, detail) as (
  select 1, 'edition', case when (select count(*) from ed) = 1 and (select status from ed) <> 'archived' then 'OK' else 'STOP' end,
         coalesce((select name_en || ' / ' || name_ar || ' — status ' || status
                          || ', booking ' || coalesce(to_char(booking_opens_at, 'YYYY-MM-DD HH24:MI'), 'closed')
                          || ' → ' || coalesce(to_char(booking_closes_at, 'YYYY-MM-DD HH24:MI'), 'closed') from ed),
                  'no edition with slug ${EDITION_SLUG}')
  union all
  select 2, 'migration 0017', case when exists (
           select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'maghrib_break')
         and exists (select 1 from pg_proc where proname = 'set_company_prayer_breaks' and pronamespace = 'public'::regnamespace) then 'OK' else 'STOP' end,
         'per-company prayer breaks'
  union all
  select 3, 'existing assignments', case when count(*) = 0 then 'OK' else 'STOP' end,
         count(*) || ' already in this edition' || case when count(*) > 0 then ' — remove them on the Rooms tab first' else '' end
    from sessions where edition_id = (select id from ed)
  union all
  select 10, 'company: ' || company,
         case when matches = 1 then 'OK' else 'STOP' end,
         case when matches = 0 and hidden_namesakes > 0 then 'only a hidden (removed) company has this name — restore it on the Companies tab'
              when matches = 0 then 'no company with this exact English or Arabic name'
              when matches > 1 then matches || ' visible companies have this name'
              else 'prayer breaks Asr/Maghrib now ' || breaks || ', after '
                   || case when no_maghrib then 'true/false (interviews through Maghrib)' else 'true/true' end
                   || case when hidden_namesakes > 0 then '; a hidden (removed) company with the same name is ignored' else '' end end
    from co
  union all
  select 20, 'room: ' || room,
         case when active = 1 then 'OK' else 'STOP' end,
         case when active = 0 then 'no active room with this exact name (' || total || ' retired)'
              when active > 1 then active || ' active rooms have this name'
              else 'found' end
    from ro
  union all
  select 30, 'room days: ' || rd.room || ' on ' || rd.day,
         'STOP',
         'the room''s own days on the Rooms tab are '
           || (app.edition_settings((select id from ed)) -> 'room_days' -> rd.room_id::text ->> 'from_day') || ' to '
           || (app.edition_settings((select id from ed)) -> 'room_days' -> rd.room_id::text ->> 'to_day')
    from rd
   where (app.edition_settings((select id from ed)) -> 'room_days' -> rd.room_id::text) is not null
     and rd.day not between (app.edition_settings((select id from ed)) -> 'room_days' -> rd.room_id::text ->> 'from_day')::date
                        and (app.edition_settings((select id from ed)) -> 'room_days' -> rd.room_id::text ->> 'to_day')::date
)
select status, item, detail from checks order by (status = 'OK'), sort, item;


-- -----------------------------------------------------------------------------
-- STEP 2 — WRITE. Only after every Step 1 line says OK.
-- Copy from the line just below this box (it says only: begin) to the very
-- end of the file, into a new empty tab, and run it. The last result lists
-- every assignment it made, with its times.
-- -----------------------------------------------------------------------------

begin;

create temporary table room_plan on commit drop as
select * from (values
${values}
) as v ${PLAN_COLUMNS};

alter table room_plan add column company_id uuid, add column room_id uuid, add column session_id uuid;

do $$
declare
  v_actor    jsonb := ${actor}::jsonb;
  e          editions;
  p          record;
  v_bad      text;
  v_res      jsonb;
  v_added    integer;
  v_expect   integer;
begin
  select * into e from editions where public_slug = ${sql(EDITION_SLUG)};
  if e.id is null then
    raise exception 'No edition with slug ${EDITION_SLUG}. Nothing was written.';
  end if;
  if e.status = 'archived' then
    raise exception 'The edition is archived. Nothing was written.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'maghrib_break')
     or not exists (select 1 from pg_proc where proname = 'set_company_prayer_breaks' and pronamespace = 'public'::regnamespace) then
    raise exception 'Migration 0017 (per-company prayer breaks) is not applied. Apply it first. Nothing was written.';
  end if;
  if exists (select 1 from sessions where edition_id = e.id) then
    raise exception 'This edition already has % assignment(s). Remove them on the Rooms tab first. Nothing was written.',
      (select count(*) from sessions where edition_id = e.id);
  end if;

  -- Names: exactly one visible company (the Rooms tab offers only those),
  -- exactly one active room.
  select string_agg(distinct company, ', ') into v_bad
    from room_plan rp
   where (select count(*) from companies c
           where c.edition_id = e.id and not c.is_hidden and (c.name_en = rp.company or c.name_ar = rp.company)) <> 1;
  if v_bad is not null then
    raise exception 'These companies do not match exactly one visible company: %. Nothing was written.', v_bad;
  end if;

  select string_agg(distinct room, ', ') into v_bad
    from room_plan rp
   where (select count(*) from rooms r where r.edition_id = e.id and r.name = rp.room and r.is_active) <> 1;
  if v_bad is not null then
    raise exception 'These rooms do not match exactly one active room: %. Nothing was written.', v_bad;
  end if;

  update room_plan rp
     set company_id = (select c.id from companies c
                        where c.edition_id = e.id and not c.is_hidden and (c.name_en = rp.company or c.name_ar = rp.company)),
         room_id    = (select r.id from rooms r where r.edition_id = e.id and r.name = rp.room and r.is_active);

  -- A room's own days (Rooms tab): the app refuses other days, so this does too.
  select string_agg(distinct rp.room || ' on ' || rp.day, ', ') into v_bad
    from room_plan rp
   where (app.edition_settings(e.id) -> 'room_days' -> rp.room_id::text) is not null
     and rp.day not between (app.edition_settings(e.id) -> 'room_days' -> rp.room_id::text ->> 'from_day')::date
                        and (app.edition_settings(e.id) -> 'room_days' -> rp.room_id::text ->> 'to_day')::date;
  if v_bad is not null then
    raise exception 'Outside the room''s own days (Rooms tab): %. Nothing was written.', v_bad;
  end if;

  -- 1. Every company in the plan starts with both breaks, so its sessions
  --    are made exactly on the sheet's grid. Only companies with a break off
  --    are touched. (No sessions exist yet, so this only sets the switches.)
  for p in select distinct rp.company_id from room_plan rp join companies c on c.id = rp.company_id
            where not (c.asr_break and c.maghrib_break) loop
    perform public.set_company_prayer_breaks(e.id, p.company_id, true, true, v_actor);
  end loop;

  -- 2. The assignments.
  for p in select * from room_plan order by day, start_time, room loop
    v_res := public.create_session(e.id, jsonb_build_object(
      'company_id', p.company_id, 'room_id', p.room_id, 'day', p.day,
      'start_time', p.start_time, 'end_time', p.end_time, 'slot_minutes', 20), v_actor);
    update room_plan set session_id = (v_res ->> 'session_id')::uuid where n = p.n;
  end loop;

  -- 3. Maghrib off for the noted companies: adds 17:30 to each of their
  --    sessions that runs past 18:00. Asr stays.
  for p in select company_id, min(company) as company,
                  count(*) filter (where end_time > '18:00') as spanning
             from room_plan where no_maghrib group by company_id loop
    v_res := public.set_company_prayer_breaks(e.id, p.company_id, true, false, v_actor);
    v_added := (v_res ->> 'slots_added')::integer;
    if v_added <> p.spanning or (v_res ->> 'held')::integer <> 0 then
      raise exception 'Switching Maghrib off for % added % slot(s), expected %. Nothing was written.', p.company, v_added, p.spanning;
    end if;
  end loop;

  -- 4. Where the room is taken at 18:00, grow to 17:50 for the 17:30 interview.
  for p in select * from room_plan where extend_to is not null loop
    v_res := public.extend_session(p.session_id, p.extend_to, v_actor);
    if (v_res ->> 'added')::integer <> 1 then
      raise exception 'Extending % in % on % added %, expected 1. Nothing was written.', p.company, p.room, p.day, v_res ->> 'added';
    end if;
  end loop;

  -- 5. Every assignment's times must be exactly the sheet's, after the decisions.
  select string_agg(rp.day || ' ' || rp.room || ' ' || rp.company || ': got ' || coalesce(got.times, 'nothing')
                    || ', expected ' || rp.expected, E'\\n') into v_bad
    from room_plan rp
    left join lateral (
      select string_agg(to_char(sl.starts_at at time zone e.time_zone, 'HH24:MI'), ',' order by sl.starts_at) as times
        from slots sl where sl.session_id = rp.session_id and not sl.is_closed
    ) got on true
   where coalesce(got.times, '') <> rp.expected;
  if v_bad is not null then
    raise exception E'Times differ from the sheet. Nothing was written.\\n%', v_bad;
  end if;

  select count(*) into v_expect from slots where edition_id = e.id;
  if v_expect <> ${finalSlots} then
    raise exception 'Made % slots, expected ${finalSlots}. Nothing was written.', v_expect;
  end if;
end;
$$;

commit;

-- What was made (the editor shows this last result): one line per assignment.
select to_char(se.day, 'Dy DD Mon') as day,
       r.name as room,
       c.name_en as company,
       c.name_ar as company_ar,
       count(sl.id) as interviews,
       string_agg(to_char(sl.starts_at at time zone e.time_zone, 'HH24:MI'), ' ' order by sl.starts_at) as times
  from sessions se
  join editions e on e.id = se.edition_id
  join rooms r on r.id = se.room_id
  join companies c on c.id = se.company_id
  left join slots sl on sl.session_id = se.id and not sl.is_closed
 where e.public_slug = ${sql(EDITION_SLUG)}
 group by se.day, r.name, r.sort_order, c.name_en, c.name_ar, se.starts_at
 order by se.day, r.sort_order, length(r.name), r.name, se.starts_at;
`;

writeFileSync(OUT, file, 'utf8');

console.log(`Read ${blocks.length} assignments from ${days.length} days, ${companies.length} companies, ${rooms.length} rooms.`);
console.log(`Interview times: ${sheetSlots} as drawn, ${finalSlots} after the club's decisions.`);
console.log('Notes in the sheet:');
for (const n of notes) console.log(`  ${n}`);
console.log('No-Maghrib assignments:');
for (const p of plan.filter((x) => x.noMaghrib)) {
  console.log(`  ${p.day} ${p.room} ${p.company}: ${p.start}–${p.end}${p.extendTo ? ` then to ${p.extendTo}` : ''} → ${p.expected.slice(-3).join(', ')}`);
}
console.log(`Wrote ${OUT}.`);
