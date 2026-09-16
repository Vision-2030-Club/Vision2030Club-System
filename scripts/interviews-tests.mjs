/**
 * Verification of the Mock Interviews database.
 *
 *   npm run db:interviews
 *
 * Runs against the INTERVIEWS Supabase project: the functions over a direct
 * connection (which is how the concurrency check can open two connections
 * and fire them at once), the REST surface with the anon key to prove the
 * API roles get nothing, and the service role to prove the server can.
 *
 * Seeds one edition (`dbtest-…`) and deletes it, and everything under it,
 * at the end. Nothing it touches is anyone else's.
 *
 * Needs, from .env.local: INTERVIEWS_SUPABASE_DB_URL, INTERVIEWS_SUPABASE_URL,
 * INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY, and — for the anon checks —
 * INTERVIEWS_SUPABASE_ANON_KEY (the project's publishable key; skipped if unset).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const {
  INTERVIEWS_SUPABASE_DB_URL: DB_URL,
  INTERVIEWS_SUPABASE_URL: API_URL,
  INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  INTERVIEWS_SUPABASE_ANON_KEY: ANON_KEY,
} = process.env;

for (const [name, value] of Object.entries({
  INTERVIEWS_SUPABASE_DB_URL: DB_URL,
  INTERVIEWS_SUPABASE_URL: API_URL,
  INTERVIEWS_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
})) {
  if (!value) {
    console.error(`${name} is not set in .env.local.`);
    process.exit(1);
  }
}

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${name}${detail && !passed ? `\n         ${detail}` : ''}`);
}

const client = () => new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const db = client();

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
async function refused(sql, params = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return `${error.message} [hint=${error.hint ?? ''}]`;
  }
}

const J = JSON.stringify;
const ACTOR = J({ kind: 'member', id: '11111111-1111-1111-1111-111111111111', name: 'Suite Manager' });
const tok = () => randomBytes(24).toString('hex');
const STAMP = Date.now().toString(36);

async function restAs(key, path, init = {}) {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
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
  return { status: response.status, ok: response.ok, body };
}

let editionId = null;

async function cleanUp() {
  if (!editionId) return;
  await db.query(`delete from audit_log where edition_id = $1`, [editionId]);
  await db.query(`delete from editions where id = $1`, [editionId]);
  editionId = null;
}

async function run() {
  // --- an edition, opened -------------------------------------------------
  const edition = await one(`select * from create_edition($1::jsonb, $2::jsonb)`, [
    J({ name_en: `dbtest ${STAMP}`, name_ar: 'اختبار', public_slug: `dbtest-${STAMP}`, tv_token: tok() }),
    ACTOR,
  ]);
  editionId = edition.id;
  check('create_edition', edition.status === 'draft');

  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  await one(`select update_edition($1, $2::jsonb, $3::jsonb)`, [
    editionId,
    J({
      status: 'active',
      apply_opens_at: iso(-3600e3), apply_closes_at: iso(86400e3),
      booking_opens_at: iso(-3600e3), booking_closes_at: iso(7 * 86400e3),
      settings: { max_preferences: 2, change_cutoff_hours: 1 },
    }),
    ACTOR,
  ]);
  const settings = await one(`select edition_settings($1) as s`, [editionId]);
  check('settings merge with defaults', settings.s.max_preferences === 2 && settings.s.tv_call_minutes === 5);

  const room1 = await one(`select * from upsert_room($1, null, $2::jsonb, $3::jsonb)`, [editionId, J({ name: 'Room 1' }), ACTOR]);
  const room2 = await one(`select * from upsert_room($1, null, $2::jsonb, $3::jsonb)`, [editionId, J({ name: 'Room 2' }), ACTOR]);
  const c1 = await one(`select * from upsert_company($1, null, $2::jsonb, $3::jsonb)`, [editionId, J({ name_en: 'Alpha', name_ar: 'ألفا', access_token: tok() }), ACTOR]);
  const c2 = await one(`select * from upsert_company($1, null, $2::jsonb, $3::jsonb)`, [editionId, J({ name_en: 'Beta', name_ar: 'بيتا', access_token: tok(), access_pin: '1234' }), ACTOR]);

  // --- applying -----------------------------------------------------------
  const t1 = tok();
  const t2 = tok();
  const a1 = await one(`select submit_application($1, $2::jsonb, $3) as r`, [
    editionId, J({ email: `sara-${STAMP}@example.test`, name: 'Sara', preferences: [c1.id, c2.id], cv_path: 'x/1.pdf', locale: 'ar' }), t1,
  ]);
  check('submit_application inserts', a1.r.replaced === false && a1.r.personal_token === t1);
  const a1b = await one(`select submit_application($1, $2::jsonb, $3) as r`, [
    editionId, J({ email: `SARA-${STAMP}@example.test`, name: 'Sara B', preferences: [c1.id, c2.id], cv_path: 'x/2.pdf' }), tok(),
  ]);
  check('a second submission (case-insensitive email) updates in place', a1b.r.replaced === true && a1b.r.id === a1.r.id && a1b.r.previous_cv_path === 'x/1.pdf');
  const a2 = await one(`select submit_application($1, $2::jsonb, $3) as r`, [
    editionId, J({ email: `omar-${STAMP}@example.test`, name: 'Omar', preferences: [c1.id], cv_path: 'x/3.pdf', locale: 'en' }), t2,
  ]);
  check('too many preferences refused', /at most 2/.test((await refused(`select submit_application($1, $2::jsonb, $3)`, [
    editionId, J({ email: `x-${STAMP}@example.test`, name: 'X', preferences: [c1.id, c2.id, room1.id], cv_path: 'x/4.pdf' }), tok(),
  ])) ?? ''));

  // --- decisions ----------------------------------------------------------
  await one(`select decide_preference($1, $2, 'accepted', null, $3::jsonb)`, [a1.r.id, c1.id, ACTOR]);
  await one(`select decide_preference($1, $2, 'accepted', null, $3::jsonb)`, [a1.r.id, c2.id, ACTOR]);
  await one(`select decide_preference($1, $2, 'accepted', null, $3::jsonb)`, [a2.r.id, c1.id, ACTOR]);
  const acceptedMails = await q(`select * from email_outbox where edition_id = $1 and kind = 'accepted'`, [editionId]);
  check('one acceptance email per student', acceptedMails.length === 2);
  check('re-submitting after a decision is refused', /already been reviewed/.test((await refused(`select submit_application($1, $2::jsonb, $3)`, [
    editionId, J({ email: `sara-${STAMP}@example.test`, name: 'Sara', preferences: [c1.id], cv_path: 'x/5.pdf' }), tok(),
  ])) ?? ''));

  // --- sessions -----------------------------------------------------------
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const s1 = await one(`select create_session($1, $2::jsonb, $3::jsonb) as r`, [
    editionId, J({ company_id: c1.id, room_id: room1.id, day: tomorrow, start_time: '14:00', end_time: '15:00', slot_minutes: 20 }), ACTOR,
  ]);
  check('create_session generates slots', s1.r.slots === 3);
  check('a room hosts one company at a time', /already in use/.test((await refused(`select create_session($1, $2::jsonb, $3::jsonb)`, [
    editionId, J({ company_id: c2.id, room_id: room1.id, day: tomorrow, start_time: '14:30', end_time: '15:30', slot_minutes: 10 }), ACTOR,
  ])) ?? ''));
  const s2 = await one(`select create_session($1, $2::jsonb, $3::jsonb) as r`, [
    editionId, J({ company_id: c2.id, room_id: room2.id, day: tomorrow, start_time: '14:00', end_time: '15:00', slot_minutes: 20 }), ACTOR,
  ]);
  const slotsC1 = await q(`select * from slots where session_id = $1 order by starts_at`, [s1.r.session_id]);
  const slotsC2 = await q(`select * from slots where session_id = $1 order by starts_at`, [s2.r.session_id]);
  const firstStart = await one(`select to_char($1::timestamptz at time zone 'Asia/Riyadh', 'HH24:MI') as t`, [slotsC1[0].starts_at]);
  check('slots are on the edition clock', firstStart.t === '14:00', firstStart.t);

  // --- THE concurrency check: two connections, one slot, at the same instant
  const [x, y] = [client(), client()];
  await Promise.all([x.connect(), y.connect()]);
  const race = await Promise.allSettled([
    x.query(`select * from book_slot($1, $2)`, [t1, slotsC1[0].id]),
    y.query(`select * from book_slot($1, $2)`, [t2, slotsC1[0].id]),
  ]);
  await Promise.all([x.end(), y.end()]);
  const winners = race.filter((r) => r.status === 'fulfilled').length;
  const loserMessage = race.find((r) => r.status === 'rejected')?.reason?.message ?? '';
  check('two students booking one slot at once: exactly one wins', winners === 1, `${winners} won`);
  check('the loser is told someone was first', /took that slot first/.test(loserMessage), loserMessage);

  const winnerToken = race[0].status === 'fulfilled' ? t1 : t2;
  const loserToken = winnerToken === t1 ? t2 : t1;

  check('a second slot with the same company is refused', /already hold/.test((await refused(`select book_slot($1, $2)`, [winnerToken, slotsC1[1].id])) ?? ''));
  const loserBooking = await one(`select * from book_slot($1, $2)`, [loserToken, slotsC1[1].id]);
  check('the other student books the next slot', loserBooking.stage === 'scheduled');

  // Sara holds c1 14:00 (or 14:20); give her c2 at the overlapping time → refused.
  const saraBooking = await one(`select * from bookings where application_id = $1 and company_id = $2 and cancelled_at is null`, [a1.r.id, c1.id]);
  const overlapping = slotsC2.find((s) => new Date(s.starts_at).getTime() === new Date(saraBooking.starts_at).getTime());
  check('overlapping interviews for one student are refused', /overlaps/.test((await refused(`select book_slot($1, $2)`, [t1, overlapping.id])) ?? ''));
  const other = slotsC2.find((s) => new Date(s.starts_at).getTime() !== new Date(saraBooking.starts_at).getTime());
  const saraC2 = await one(`select * from book_slot($1, $2)`, [t1, other.id]);
  check('a non-overlapping slot with the second company books', saraC2.company_id === c2.id);

  // --- moving, cancelling, cutoff ------------------------------------------
  const freeC1 = slotsC1.find((s) => s.id !== saraBooking.slot_id && s.id !== loserBooking.slot_id);
  const moved = await one(`select * from move_booking($1, $2, $3)`, [t1, saraBooking.id, freeC1.id]);
  check('move_booking changes the same row', moved.id === saraBooking.id && moved.slot_id === freeC1.id);
  check('closing a held slot is refused', /holds this slot/.test((await refused(`select set_slot_closed($1, true, $2::jsonb)`, [freeC1.id, ACTOR])) ?? ''));
  check('a session with bookings cannot be deleted', /hold slots/.test((await refused(`select delete_session($1, $2::jsonb)`, [s1.r.session_id, ACTOR])) ?? ''));

  await q(`update bookings set starts_at = now() + interval '30 minutes', ends_at = now() + interval '50 minutes' where id = $1`, [saraC2.id]);
  check('changes inside the cutoff are refused', /Changes close/.test((await refused(`select cancel_booking($1, $2, null)`, [t1, saraC2.id])) ?? ''));
  const staffCancel = await one(`select * from staff_cancel_booking($1, 'desk', $2::jsonb)`, [saraC2.id, ACTOR]);
  check('staff can cancel inside the cutoff; the row stays', staffCancel.cancelled_at !== null);
  const cancelledMail = await q(`select * from email_outbox where edition_id = $1 and kind = 'booking_cancelled'`, [editionId]);
  check('a cancellation email is queued', cancelledMail.length === 1);

  // --- stages ---------------------------------------------------------------
  const b = loserBooking.id;
  check('an organizer cannot skip stages', Boolean(await refused(`select advance_stage($1, 'done', $2::jsonb, false)`, [b, ACTOR])));
  const arrived = await one(`select * from advance_stage($1, 'arrived', $2::jsonb, false)`, [b, ACTOR]);
  check('scheduled → arrived stamps arrival', arrived.arrived_at !== null);
  await one(`select * from advance_stage($1, 'in_interview', $2::jsonb, false)`, [b, ACTOR]);
  const done = await one(`select * from advance_stage($1, 'done', $2::jsonb, false)`, [b, ACTOR]);
  check('forward to done', done.finished_at !== null);
  check('two steps back refused for an organizer', Boolean(await refused(`select advance_stage($1, 'arrived', $2::jsonb, false)`, [b, ACTOR])));
  const back = await one(`select * from advance_stage($1, 'in_interview', $2::jsonb, false)`, [b, ACTOR]);
  check('one step back allowed', back.stage === 'in_interview');
  const any = await one(`select * from advance_stage($1, 'scheduled', $2::jsonb, true)`, [b, ACTOR]);
  check('a manager sets any stage', any.stage === 'scheduled' && any.arrived_at === null);

  // --- feedback -------------------------------------------------------------
  await one(`select * from advance_stage($1, 'arrived', $2::jsonb, false)`, [b, ACTOR]);
  const fb = await one(`select * from submit_feedback($1, $2, $3::jsonb)`, [c1.access_token, b, J({ ratings: { communication: 4 }, overall: 'good' })]);
  check('a company writes feedback through its link', fb.ratings.communication === 4 && fb.released_at === null);
  check('another company cannot', /not on your list/.test((await refused(`select submit_feedback($1, $2, $3::jsonb)`, [c2.access_token, b, J({})])) ?? ''));
  const released = await one(`select release_feedback($1, $2::jsonb) as n`, [editionId, ACTOR]);
  check('release_feedback queues the emails', released.n === 1);
  check('released feedback is frozen', /already been sent/.test((await refused(`select submit_feedback($1, $2, $3::jsonb)`, [c1.access_token, b, J({})])) ?? ''));

  // --- reminders, outbox ------------------------------------------------------
  await q(`update bookings set booked_at = now() - interval '3 hours' where edition_id = $1`, [editionId]);
  await q(`update bookings set stage = 'scheduled' where id = $1`, [b]);
  const r1 = await one(`select enqueue_reminders(48) as n`);
  const r2 = await one(`select enqueue_reminders(48) as n`);
  check('reminders are queued once', r1.n >= 1 && r2.n === 0, `${r1.n} then ${r2.n}`);

  // --- the API surface --------------------------------------------------------
  const svc = await restAs(SERVICE_KEY, `rpc/claim_email_outbox`, { method: 'POST', body: J({ p_limit: 100 }) });
  check('the service role leases the outbox over REST', svc.ok && Array.isArray(svc.body) && svc.body.length > 0, `${svc.status} ${J(svc.body).slice(0, 120)}`);
  const svcRead = await restAs(SERVICE_KEY, `editions?select=id&id=eq.${editionId}`);
  check('the service role reads over REST', svcRead.ok && svcRead.body.length === 1);

  if (ANON_KEY) {
    const anonRead = await restAs(ANON_KEY, `editions?select=id&id=eq.${editionId}`);
    check('the anon key reads nothing', !anonRead.ok || (Array.isArray(anonRead.body) && anonRead.body.length === 0), `${anonRead.status} ${J(anonRead.body).slice(0, 120)}`);
    const anonApps = await restAs(ANON_KEY, `applications?select=email&limit=1`);
    check('the anon key cannot read applications', !anonApps.ok || (Array.isArray(anonApps.body) && anonApps.body.length === 0), `${anonApps.status}`);
    const anonRpc = await restAs(ANON_KEY, `rpc/book_slot`, { method: 'POST', body: J({ p_token: t1, p_slot: slotsC1[2].id }) });
    check('the anon key cannot call a function', !anonRpc.ok, `${anonRpc.status} ${J(anonRpc.body).slice(0, 120)}`);
    const anonStorage = await fetch(`${API_URL}/storage/v1/object/cvs/x/1.pdf`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } });
    check('the cvs bucket refuses an unsigned read', !anonStorage.ok, String(anonStorage.status));
  } else {
    console.log('  skip  INTERVIEWS_SUPABASE_ANON_KEY is not set — anon-key checks skipped');
  }

  // --- audit -------------------------------------------------------------------
  const kinds = await q(`select distinct actor_kind from audit_log where edition_id = $1`, [editionId]);
  check('the audit log names students, members and companies', ['company', 'member', 'student'].every((k) => kinds.some((r) => r.actor_kind === k)), J(kinds));
  const snap = await one(`select edition_snapshot($1) as s`, [editionId]);
  check('edition_snapshot carries every table', snap.s.applications.length === 2 && snap.s.bookings.length >= 3 && snap.s.audit_log.length > 10);
}

await db.connect();
try {
  await run();
} catch (error) {
  console.error('\nThe suite stopped early:', error.message);
  results.push({ name: 'suite completed', passed: false });
} finally {
  await cleanUp();
  await db.end();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
