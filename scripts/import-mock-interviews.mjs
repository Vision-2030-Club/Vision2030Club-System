/**
 * Brings the April 2026 mock-interview week into the interviews database as
 * an ARCHIVED edition, read-only, so HR has the history and the schema has
 * been through real data before the next event.
 *
 *   npm run interviews:import -- --dry      read the workbook, report, write nothing
 *   npm run interviews:import               import (refuses if the edition exists)
 *   npm run interviews:import -- --redo     delete that edition and import again
 *
 * Reads `mockinterviews.xlsx` from the repo root (gitignored: it holds ~950
 * people's emails and phones) and writes through the project's REST API with
 * the service role — port 5432 is blocked on some networks, HTTPS never is.
 * Rows are inserted in bulk where a failure would mean a bad file (rooms,
 * companies, applications, preferences) and one by one where the database's
 * own constraints may legitimately refuse a row (sessions that overlap in a
 * room, bookings that double-book a student); those are listed, not lost.
 *
 * Duplicate submissions (the same email twice) keep the LATEST as the
 * application and put the earlier ones in the audit log as `import_duplicate`.
 * The workbook has no CV files: Drive links become `cv_external_url`; upload
 * paths are kept as `cv_import_ref` text.
 */
import { randomBytes } from 'node:crypto';
import { openWorkbook } from './lib/xlsx.mjs';

const FILE = 'mockinterviews.xlsx';
const SLUG = 'april-2026';
const ZONE = 'Asia/Riyadh';
const DRY = process.argv.includes('--dry');
const REDO = process.argv.includes('--redo');

const { INTERVIEWS_SUPABASE_URL: URL_, INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
if (!URL_ || !KEY) {
  console.error('INTERVIEWS_SUPABASE_URL and INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.');
  process.exit(1);
}

const tok = () => randomBytes(24).toString('hex');
const hasArabic = (s) => /[؀-ۿ]/.test(s ?? '');

const UNIVERSITIES = {
  'جامعة الملك سعود': 'ksu',
  'جامعة الإمام محمد بن سعود': 'imamu',
  'جامعة الأميرة نورة': 'pnu',
  'جامعة الأمير سلطان': 'psu',
  'جامعة الأمير سطام': 'psau',
  'جامعة الفيصل': 'alfaisal',
  'جامعة الإمام عبدالرحمن بن فيصل': 'iau',
  'أخرى': 'other',
};
const LEVELS = {
  'السنة الأولى': 'year1', 'السنة الثانية': 'year2', 'السنة الثالثة': 'year3',
  'السنة الرابعة': 'year4', 'السنة الخامسة': 'year5', 'خريج حديث': 'graduate',
  'Fresh Graduate': 'graduate', 'Senior: 4th year': 'year4', 'Senior: 5th year': 'year5', 'Junior: 3rd year': 'year3',
};
const ENGLISH = { 'متقدم': 'advanced', 'متوسط': 'intermediate', 'مبتدئ': 'beginner', Advanced: 'advanced', Intermediate: 'intermediate', Beginner: 'beginner' };
const STAGES = { scheduled: 'scheduled', arrived: 'arrived', in_interview: 'in_interview', done: 'done', noshow: 'no_show' };

// ---------------------------------------------------------------------------
// The REST client — the same PostgREST the app uses, as the service role
// ---------------------------------------------------------------------------

async function rest(path, init = {}) {
  const response = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' ? body.message ?? JSON.stringify(body) : String(body);
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${message}`);
  }
  return body;
}

const insert = (table, rows) => rest(table, { method: 'POST', body: JSON.stringify(rows) });

/** Bulk insert in slices, so one request never carries thousands of rows. */
async function insertMany(table, rows, size = 200) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(...(await insert(table, rows.slice(i, i + size))));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const wb = openWorkbook(FILE);
console.log(`Sheets: ${wb.sheetNames.join(', ')}`);

const companies = wb.records('Companies').filter((r) => r.ID && r.ID !== 'ID');
const apps = wb.records('Apps').filter((r) => r.ID && r.ID !== 'ID' && r.EMAIL && r.EMAIL.includes('@'));
const slots = wb.records('Slots').filter((r) => r.COID && r.ID && r.DATE && r.TIME);
const checkins = wb.records('Checkins').filter((r) => r.KEY && r.KEY !== 'KEY');
const logs = wb.records('Logs').filter((r) => r.ID && r.ID !== 'ID');

const checkinByKey = new Map();
for (const c of checkins) {
  const when = Object.values(c).find((v) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(v)));
  checkinByKey.set(c.KEY, { stage: STAGES[c.VALUE] ?? 'scheduled', when: when ?? null });
}

const companyRows = companies.map((c, i) => {
  let ar = c.NAMEAR;
  let en = c.NAMEEN;
  if (!hasArabic(ar) && hasArabic(en)) [ar, en] = [en, ar];
  if (!ar) ar = en;
  if (!en) en = ar;
  return {
    import_ref: c.ID,
    name_en: en.trim(),
    name_ar: ar.trim(),
    logo_url: c.LOGOURL || null,
    desc_en: (hasArabic(c.DESCEN) ? c.DESCAR : c.DESCEN) || null,
    desc_ar: (hasArabic(c.DESCAR) ? c.DESCAR : c.DESCEN) || null,
    is_hidden: /^(true|1)$/i.test(c.HIDDEN ?? ''),
    sort_order: (i + 1) * 10,
    access_token: tok(),
  };
});

const byEmail = new Map();
const duplicates = [];
for (const a of apps.sort((x, y) => String(x.SUBMITTEDAT).localeCompare(String(y.SUBMITTEDAT)))) {
  const email = a.EMAIL.trim().toLowerCase();
  if (byEmail.has(email)) duplicates.push(byEmail.get(email));
  byEmail.set(email, a);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

const applicationRows = [...byEmail.values()].map((a) => {
  const uni = UNIVERSITIES[a.UNIVERSITY?.trim()] ?? (a.UNIVERSITY ? 'other' : null);
  const cvlink = (a.CVLINK ?? '').trim();
  return {
    import_ref: a.ID,
    email: a.EMAIL.trim().toLowerCase(),
    phone: a.PHONE || null,
    name: a.NAME?.trim() || a.EMAIL,
    is_club_member: /^(نعم|yes)$/i.test(a.VISION2030CLUBMEMBER ?? '') ? true : /^(لا|no)$/i.test(a.VISION2030CLUBMEMBER ?? '') ? false : null,
    university: uni,
    university_other: uni === 'other' && !UNIVERSITIES[a.UNIVERSITY?.trim()] ? a.UNIVERSITY : null,
    level: LEVELS[a.LEVEL?.trim()] ?? null,
    college: a.COLLEGE || null,
    major: a.MAJOR || null,
    gpa: a.GPA && !/^[-.]$/.test(a.GPA) ? a.GPA : null,
    english_level: ENGLISH[a.ENGLISHPROFICIENCYLEVEL?.trim()] ?? null,
    why_first: a.WHYFIRST || null,
    locale: hasArabic(a.WHYFIRST) || hasArabic(a.NAME) ? 'ar' : 'en',
    cv_external_url: /^https?:\/\//.test(cvlink) ? cvlink : null,
    cv_import_ref: cvlink && !/^https?:\/\//.test(cvlink) ? cvlink : null,
    submitted_at: a.SUBMITTEDAT || null,
    personal_token: tok(),
    source: 'import',
  };
});

/** What each student asked for and what HR decided, keyed by the old id. */
const choicesByRef = new Map(
  [...byEmail.values()].map((a) => [
    a.ID,
    { preferences: parseJson(a.PREFERENCES, []), statuses: parseJson(a.COMPANYSTATUSES, {}) },
  ]),
);

const sessionMap = new Map();
for (const s of slots) {
  const key = `${s.COID}|${s.DATE}|${s.ROOM}`;
  const list = sessionMap.get(key) ?? { coid: s.COID, date: s.DATE, room: s.ROOM, slots: [] };
  list.slots.push({ id: s.ID, time: s.TIME, booked: s.BOOKED || null });
  sessionMap.set(key, list);
}
const minutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const label = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const sessionRows = [...sessionMap.values()].map((s) => {
  const times = [...new Set(s.slots.map((x) => x.time))].sort((a, b) => minutes(a) - minutes(b));
  let step = 20;
  if (times.length > 1) {
    step = Math.min(...times.slice(1).map((t, i) => minutes(t) - minutes(times[i])));
    if (!(step >= 5 && step <= 60 && step % 5 === 0)) step = Math.max(5, Math.min(60, Math.round(step / 5) * 5 || 5));
  }
  return { ...s, times, step, start: times[0], end: minutes(times[times.length - 1]) + step };
});

const roomNames = [...new Set(slots.map((s) => s.ROOM))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

console.log(`\nRead: ${companyRows.length} companies, ${apps.length} application rows (${applicationRows.length} unique emails, ${duplicates.length} earlier duplicates), ${slots.length} slots in ${sessionRows.length} sessions across ${roomNames.length} rooms, ${checkins.length} check-ins, ${logs.length} log lines.`);

if (DRY) {
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const problems = [];
const counts = { rooms: 0, companies: 0, applications: 0, preferences: 0, sessions: 0, slots: 0, bookings: 0, notes: 0 };
const at = (date, time) => `${date} ${time}:00 ${ZONE}`;

const existing = await rest(`editions?public_slug=eq.${SLUG}&select=id`);
if (existing.length) {
  if (!REDO) {
    console.error(`An edition with slug "${SLUG}" already exists. Run with --redo to replace it.`);
    process.exit(1);
  }
  await rest(`audit_log?edition_id=eq.${existing[0].id}`, { method: 'DELETE' });
  await rest(`editions?id=eq.${existing[0].id}`, { method: 'DELETE' });
  console.log('Replaced the existing edition.');
}

const [edition] = await insert('editions', [{
  name_en: 'Mock Interviews — April 2026',
  name_ar: 'المقابلات التجريبية — أبريل 2026',
  public_slug: SLUG,
  status: 'archived',
  time_zone: ZONE,
  tv_token: tok(),
}]);
const editionId = edition.id;
// Every row of a bulk insert must carry the same keys (PostgREST insists), so
// `at` is always present: the old log's own timestamp, or now.
const note = (action, table, rowId, detail, atTime = null) => ({
  edition_id: editionId, at: atTime || new Date().toISOString(), actor_kind: 'system', actor_name: 'import',
  action, table_name: table, row_id: rowId, after: detail,
});

try {
  const rooms = await insertMany('rooms', roomNames.map((name, i) => ({ edition_id: editionId, name, sort_order: (i + 1) * 10 })));
  const roomIds = new Map(rooms.map((r) => [r.name, r.id]));
  counts.rooms = rooms.length;

  const insertedCompanies = await insertMany('companies', companyRows.map((c) => ({ ...c, edition_id: editionId })));
  const companyIds = new Map(insertedCompanies.map((c) => [c.import_ref, c.id]));
  counts.companies = insertedCompanies.length;

  const insertedApps = await insertMany(
    'applications',
    applicationRows.map((a) => ({ ...a, edition_id: editionId })),
  );
  const applicationIds = new Map(insertedApps.map((a) => [a.import_ref, a.id]));
  counts.applications = insertedApps.length;

  const preferenceRows = [];
  for (const a of applicationRows) {
    const applicationId = applicationIds.get(a.import_ref);
    const choices = choicesByRef.get(a.import_ref) ?? { preferences: [], statuses: {} };
    let rank = 0;
    const seen = new Set();
    for (const ref of choices.preferences) {
      const companyId = companyIds.get(ref);
      if (!companyId || seen.has(companyId)) continue;
      seen.add(companyId);
      rank += 1;
      const decision = ['accepted', 'rejected'].includes(choices.statuses[ref]) ? choices.statuses[ref] : 'pending';
      preferenceRows.push({
        edition_id: editionId, application_id: applicationId, company_id: companyId, rank, decision,
        decided_at: decision === 'pending' ? null : (a.submitted_at ?? new Date().toISOString()),
      });
    }
  }
  counts.preferences = (await insertMany('application_preferences', preferenceRows)).length;

  for (const s of sessionRows) {
    const companyId = companyIds.get(s.coid);
    const roomId = roomIds.get(s.room);
    if (!companyId || !roomId) {
      problems.push(`session ${s.coid} ${s.date} ${s.room}: unknown company or room`);
      continue;
    }
    /*
     * The old tool let two companies overlap in one room; the new database
     * does not (sessions_room_no_overlap). Rather than drop the history, such
     * a session goes into a companion room named "<room> (overlap)", and the
     * report says so — the constraint keeps its meaning for every future
     * edition and nothing from April is lost.
     */
    let session;
    let placedRoomId = roomId;
    const sessionRow = () => ({
      edition_id: editionId, company_id: companyId, room_id: placedRoomId, day: s.date,
      starts_at: at(s.date, s.start), ends_at: at(s.date, label(s.end)), slot_minutes: s.step,
    });
    try {
      [session] = await insert('sessions', [sessionRow()]);
    } catch (error) {
      if (!/sessions_room_no_overlap/.test(error.message)) {
        problems.push(`session ${s.coid} ${s.date} ${s.room} ${s.start}–${label(s.end)}: ${error.message}`);
        continue;
      }
      const overlapName = `${s.room} (overlap)`;
      if (!roomIds.has(overlapName)) {
        const [extra] = await insert('rooms', [{ edition_id: editionId, name: overlapName, note: 'Two companies shared this room in the old schedule', sort_order: 900 }]);
        roomIds.set(overlapName, extra.id);
        counts.rooms += 1;
      }
      placedRoomId = roomIds.get(overlapName);
      try {
        [session] = await insert('sessions', [sessionRow()]);
        problems.push(`session ${s.coid} ${s.date} ${s.room} ${s.start}–${label(s.end)}: overlapped another company; placed in "${overlapName}"`);
      } catch (error2) {
        problems.push(`session ${s.coid} ${s.date} ${s.room} ${s.start}–${label(s.end)}: ${error2.message}`);
        continue;
      }
    }
    counts.sessions += 1;
    const roomForSlots = placedRoomId;

    const slotRows = s.slots.map((slot) => ({
      edition_id: editionId, session_id: session.id, company_id: companyId, room_id: roomForSlots,
      starts_at: at(s.date, slot.time), ends_at: at(s.date, label(minutes(slot.time) + s.step)),
    }));
    let inserted;
    try {
      inserted = await insertMany('slots', slotRows);
      counts.slots += inserted.length;
    } catch (error) {
      problems.push(`slots of session ${s.coid} ${s.date} ${s.room}: ${error.message}`);
      continue;
    }

    for (const [i, slot] of s.slots.entries()) {
      if (!slot.booked) continue;
      const applicationId = applicationIds.get(slot.booked);
      if (!applicationId) {
        problems.push(`slot ${slot.id}: booked by unknown application ${slot.booked}`);
        continue;
      }
      const checkin = checkinByKey.get(`${slot.booked}_${s.coid}`);
      try {
        await insert('bookings', [{
          edition_id: editionId, slot_id: inserted[i].id, application_id: applicationId, company_id: companyId,
          starts_at: inserted[i].starts_at, ends_at: inserted[i].ends_at,
          stage: checkin?.stage ?? 'scheduled',
          stage_changed_at: checkin?.when ? `${checkin.when} ${ZONE}` : null,
          booked_by_kind: 'student', booked_at: inserted[i].starts_at,
        }]);
        counts.bookings += 1;
      } catch (error) {
        problems.push(`booking ${slot.id} for ${slot.booked}: ${error.message}`);
      }
    }
  }

  const notes = [
    ...duplicates.map((dup) => note('import_duplicate', 'applications', dup.ID, dup)),
    ...logs.map((l) => note('import_log', 'logs', l.ID, l, l.TIMESTAMP || null)),
  ];
  counts.notes = (await insertMany('audit_log', notes)).length;

  console.log(`\nImported edition ${editionId} (${SLUG}, archived):`);
  for (const [k, v] of Object.entries(counts)) console.log(`   ${String(v).padStart(5)}  ${k}`);
  if (problems.length) {
    console.log(`\n${problems.length} row(s) could not be written as they were (listed, not lost — the workbook still has them):`);
    for (const p of problems) console.log(`   ${p}`);
  }
} catch (error) {
  console.error(`\nFailed part-way: ${error.message}\nRemoving the half-written edition so a re-run starts clean.`);
  await rest(`audit_log?edition_id=eq.${editionId}`, { method: 'DELETE' });
  await rest(`editions?id=eq.${editionId}`, { method: 'DELETE' });
  process.exitCode = 1;
}
