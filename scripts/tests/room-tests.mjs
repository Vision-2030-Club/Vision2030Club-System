/**
 * Verification of the room booking rules (§4).
 *
 *   npm run db:rooms
 *
 * Same discipline as the other suites: every assertion goes through the REST
 * API as a signed-in person, not through the application, because the UI can
 * be bypassed and the rules have to hold at the layer an attacker reaches.
 *
 * The centrepiece is the double-booking guarantee. §4 asks for it "at the data
 * layer ... regardless of how many people are looking at the schedule at once",
 * so the test that matters most fires two identical bookings CONCURRENTLY and
 * checks that exactly one survives.
 *
 * Seeds its own people (`roomtest-`) and its own room, then removes both. Safe
 * to re-run and safe against a database with real data — it never touches a
 * row it did not create.
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const {
  SUPABASE_DB_URL,
  NEXT_PUBLIC_SUPABASE_URL: API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
} = process.env;

for (const [name, value] of Object.entries({
  SUPABASE_DB_URL,
  NEXT_PUBLIC_SUPABASE_URL: API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
})) {
  if (!value) {
    console.error(`${name} is not set in .env.local.`);
    process.exit(1);
  }
}

const PASSWORD = 'room-tests-4b7d!';
const PREFIX = 'roomtest-';
const ROOM_TAG = 'roomtest room';

const db = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function adminFetch(path, options = {}) {
  const response = await fetch(`${API_URL}/auth/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

async function signIn(email) {
  const { body } = await adminFetch('token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return body?.access_token ?? null;
}

async function rest(token, path, options = {}) {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body };
}

/** A write that was accepted, as opposed to refused by a policy. */
const allowed = (result) => result.ok && Array.isArray(result.body) && result.body.length > 0;

// -----------------------------------------------------------------------------
// People. One of each kind that §4 distinguishes.
// -----------------------------------------------------------------------------

const PEOPLE = {
  it: { role: 'team_director', team: 'IT', student: '491000001', national: '1910000001' },
  design: { role: 'team_director', team: 'DESIGN', student: '491000002', national: '1910000002' },
  pm: { role: 'project_manager', team: 'MEDIA', student: '491000003', national: '1910000003' },
  member: { role: 'member', team: 'DESIGN', student: '491000004', national: '1910000004' },
  pres: { role: 'president', team: 'CLUB_MGMT', student: '491000005', national: '1910000005' },
};

async function cleanUp() {
  await db.query(
    `delete from room_bookings where booked_by in
       (select id from members where email like $1)
        or room_id in (select id from rooms where name_en = $2)`,
    [`${PREFIX}%`, ROOM_TAG],
  );
  await db.query(`delete from project_managers where member_id in
       (select id from members where email like $1)`, [`${PREFIX}%`]);
  await db.query(`delete from projects where name_en = $1`, [`${PREFIX}project`]);
  // Rooms are not deletable through the API by design; the service role can.
  await db.query(`delete from rooms where name_en = $1`, [ROOM_TAG]);
  await db.query(`delete from member_sensitive where member_id in
       (select id from members where email like $1)`, [`${PREFIX}%`]);
  await db.query(`delete from members where email like $1`, [`${PREFIX}%`]);

  const { body } = await adminFetch('admin/users?per_page=200');
  for (const user of body?.users ?? []) {
    if (user.email?.startsWith(PREFIX)) {
      await adminFetch(`admin/users/${user.id}`, { method: 'DELETE' });
    }
  }
}

/*
 * The club can change its booking window whenever it likes — and has. A suite
 * that assumed noon-to-midnight started failing the day somebody set closing
 * to 21:00, which is a bug in the test, not in the system. So the window is
 * pinned for the run and put back afterwards, the same way db:prove flips a
 * permission row and reverts it.
 */
let savedWindow = null;

async function pinBookingWindow() {
  const { rows } = await db.query(
    `select opens_minute, closes_minute, days_ahead from booking_settings where id`,
  );
  savedWindow = rows[0];
  await db.query(
    `update booking_settings set opens_minute = 720, closes_minute = 1440, days_ahead = 14
      where id`,
  );
}

async function restoreBookingWindow() {
  if (!savedWindow) return;
  await db.query(
    `update booking_settings
        set opens_minute = $1, closes_minute = $2, days_ahead = $3
      where id`,
    [savedWindow.opens_minute, savedWindow.closes_minute, savedWindow.days_ahead],
  );
  savedWindow = null;
}

async function seed() {
  const people = {};

  for (const [name, spec] of Object.entries(PEOPLE)) {
    const email = `${PREFIX}${name}@example.test`;
    const created = await adminFetch('admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
    });
    if (!created.ok) {
      throw new Error(`Could not create ${email}: ${JSON.stringify(created.body)}`);
    }

    const { rows } = await db.query(
      `insert into members (auth_user_id, email, name_en, name_ar, student_id, team_id, role_id)
       values ($1, $2, $3, $3, $4,
               (select id from teams where key = $5),
               (select id from roles where key = $6))
       returning id`,
      [created.body.id, email, name, spec.student, spec.team, spec.role],
    );
    await db.query(
      `insert into member_sensitive (member_id, national_id) values ($1, $2)`,
      [rows[0].id, spec.national],
    );

    people[name] = { id: rows[0].id, email, token: await signIn(email) };
    if (!people[name].token) throw new Error(`Could not sign in as ${email}`);
  }

  // A project the PM actually manages, so "own_projects" has something to hit.
  const { rows: proj } = await db.query(
    `insert into projects (name_en, name_ar, owning_team_id)
     values ($1, $1, (select id from teams where key = 'MEDIA'))
     returning id`,
    [`${PREFIX}project`],
  );
  await db.query(`insert into project_managers (project_id, member_id) values ($1, $2)`, [
    proj[0].id, people.pm.id,
  ]);
  people.projectId = proj[0].id;

  const { rows: room } = await db.query(
    `insert into rooms (name_en, name_ar) values ($1, $1) returning id`,
    [ROOM_TAG],
  );
  people.roomId = room[0].id;

  const { rows: teams } = await db.query(
    `select key, id from teams where key in ('DESIGN','IT','MEDIA')`,
  );
  people.teams = Object.fromEntries(teams.map((row) => [row.key, row.id]));

  return people;
}

// -----------------------------------------------------------------------------

async function run(p) {
  /*
   * Tomorrow, so every booking is inside the two-week window whatever time the
   * suite runs — and expressed on the CLUB's clock, the way the application
   * sends it. Postgres accepts a zone name inside a timestamp literal, so
   * "13:00 Asia/Riyadh" means the same instant however this machine or the
   * database is configured. Before migration 0027 this suite passed or failed
   * depending on where it was run from, which is how the timezone bug surfaced.
   */
  const ZONE = 'Asia/Riyadh';
  const day = new Date();
  day.setDate(day.getDate() + 1);
  const dayText = day.toISOString().slice(0, 10);
  const iso = (hour, minute = 0) =>
    `${dayText} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00 ${ZONE}`;

  const booking = (extra) => ({
    room_id: p.roomId,
    title: 'Room test',
    ...extra,
  });

  const post = (token, body) =>
    rest(token, 'room_bookings', { method: 'POST', body: JSON.stringify(body) });

  // --- §4: who may book ------------------------------------------------------

  const memberTry = await post(
    p.member.token,
    booking({
      starts_at: iso(13),
      ends_at: iso(14),
      party_kind: 'team',
      team_id: p.teams.DESIGN,
      booked_by: p.member.id,
    }),
  );
  check('a plain Member cannot book at all', !allowed(memberTry), JSON.stringify(memberTry.body));

  const wrongTeam = await post(
    p.design.token,
    booking({
      starts_at: iso(13),
      ends_at: iso(14),
      party_kind: 'team',
      team_id: p.teams.IT,
      booked_by: p.design.id,
    }),
  );
  check(
    'a Director cannot book as a team they do not direct',
    !allowed(wrongTeam),
    JSON.stringify(wrongTeam.body),
  );

  const ownTeam = await post(
    p.design.token,
    booking({
      starts_at: iso(13),
      ends_at: iso(14),
      party_kind: 'team',
      team_id: p.teams.DESIGN,
      booked_by: p.design.id,
    }),
  );
  check('a Director can book as their own team', allowed(ownTeam), JSON.stringify(ownTeam.body));

  const pmOwn = await post(
    p.pm.token,
    booking({
      starts_at: iso(15),
      ends_at: iso(16),
      party_kind: 'project',
      project_id: p.projectId,
      booked_by: p.pm.id,
    }),
  );
  check('a PM can book as a project they manage', allowed(pmOwn), JSON.stringify(pmOwn.body));

  const directorAsPresidency = await post(
    p.design.token,
    booking({
      starts_at: iso(16),
      ends_at: iso(17),
      party_kind: 'presidency',
      booked_by: p.design.id,
    }),
  );
  check(
    'a Director cannot book as Presidency',
    !allowed(directorAsPresidency),
    JSON.stringify(directorAsPresidency.body),
  );

  const presidency = await post(
    p.pres.token,
    booking({
      starts_at: iso(16),
      ends_at: iso(17),
      party_kind: 'presidency',
      booked_by: p.pres.id,
    }),
  );
  check('the President can book as Presidency', allowed(presidency), JSON.stringify(presidency.body));

  const impersonate = await post(
    p.design.token,
    booking({
      starts_at: iso(18),
      ends_at: iso(19),
      party_kind: 'team',
      team_id: p.teams.DESIGN,
      booked_by: p.pm.id, // not themselves
    }),
  );
  check(
    'nobody can book in someone else’s name',
    !allowed(impersonate),
    JSON.stringify(impersonate.body),
  );

  // --- THE GUARANTEE ---------------------------------------------------------
  // Two identical bookings fired at the same moment. This is the assertion §4
  // actually asks for: it must hold no matter how many people are looking.

  const race = (person) =>
    post(
      person.token,
      booking({
        starts_at: iso(20),
        ends_at: iso(21),
        party_kind: 'team',
        team_id: p.teams.DESIGN,
        booked_by: person.id,
      }),
    );
  const raceAsPres = () =>
    post(
      p.pres.token,
      booking({
        starts_at: iso(20),
        ends_at: iso(21),
        party_kind: 'presidency',
        booked_by: p.pres.id,
      }),
    );

  const [a, b] = await Promise.all([race(p.design), raceAsPres()]);
  const winners = [a, b].filter(allowed).length;
  check(
    'two concurrent bookings of one slot: exactly one succeeds',
    winners === 1,
    `${winners} succeeded — ${JSON.stringify([a.status, b.status])}`,
  );

  const overlapping = await post(
    p.pres.token,
    booking({
      starts_at: iso(20, 30),
      ends_at: iso(21, 30),
      party_kind: 'presidency',
      booked_by: p.pres.id,
    }),
  );
  check(
    'a slot starting inside a taken one is refused',
    !allowed(overlapping),
    JSON.stringify(overlapping.body),
  );

  const backToBack = await post(
    p.pres.token,
    booking({
      starts_at: iso(21),
      ends_at: iso(22),
      party_kind: 'presidency',
      booked_by: p.pres.id,
    }),
  );
  check('back-to-back slots are allowed', allowed(backToBack), JSON.stringify(backToBack.body));

  // --- §4: the window --------------------------------------------------------

  const tooEarly = await post(
    p.pres.token,
    booking({
      starts_at: iso(9),
      ends_at: iso(10),
      party_kind: 'presidency',
      booked_by: p.pres.id,
    }),
  );
  check('booking before opening hours is refused', !allowed(tooEarly));

  const notHalfHour = await post(
    p.pres.token,
    booking({
      starts_at: iso(13, 10),
      ends_at: iso(14, 10),
      party_kind: 'presidency',
      booked_by: p.pres.id,
    }),
  );
  check('a slot off the half-hour grid is refused', !allowed(notHalfHour));

  const farAhead = new Date();
  farAhead.setDate(farAhead.getDate() + 40);
  const farText = farAhead.toISOString().slice(0, 10);
  const tooFar = await post(
    p.pres.token,
    booking({
      starts_at: `${farText} 14:00:00 ${ZONE}`,
      ends_at: `${farText} 15:00:00 ${ZONE}`,
      party_kind: 'presidency',
      booked_by: p.pres.id,
    }),
  );
  check('booking beyond the two-week window is refused', !allowed(tooFar));

  // --- §4: IT’s powers -------------------------------------------------------

  const designBlock = await post(
    p.design.token,
    booking({
      starts_at: iso(17),
      ends_at: iso(18),
      status: 'blocked',
      party_kind: 'block',
      booked_by: p.design.id,
    }),
  );
  check('a non-IT Director cannot block time off', !allowed(designBlock));

  const itBlock = await post(
    p.it.token,
    booking({
      starts_at: iso(17),
      ends_at: iso(18),
      status: 'blocked',
      party_kind: 'block',
      booked_by: p.it.id,
      title: 'Maintenance',
    }),
  );
  check('IT can block time off', allowed(itBlock), JSON.stringify(itBlock.body));

  const bookOverBlock = await post(
    p.pres.token,
    booking({
      starts_at: iso(17),
      ends_at: iso(18),
      party_kind: 'presidency',
      booked_by: p.pres.id,
    }),
  );
  check('nobody can book over an IT block', !allowed(bookOverBlock));

  // --- §4: visibility and cancelling ----------------------------------------

  const memberSees = await rest(p.member.token, 'room_bookings?select=id');
  check(
    'a plain Member cannot see the schedule at all',
    (memberSees.body ?? []).length === 0,
    JSON.stringify(memberSees.body),
  );

  const directorSees = await rest(
    p.design.token,
    'room_bookings?select=id,title,booked_by,team_id',
  );
  check(
    'a Director sees every booking in full detail, not just their own',
    (directorSees.body ?? []).length > 1 &&
      (directorSees.body ?? []).some((row) => row.booked_by !== p.design.id),
    `${(directorSees.body ?? []).length} rows`,
  );

  const pmBookingId = pmOwn.body?.[0]?.id;
  const stealCancel = await rest(p.design.token, `room_bookings?id=eq.${pmBookingId}`, {
    method: 'DELETE',
  });
  check(
    'a Director cannot cancel someone else’s booking',
    (stealCancel.body ?? []).length === 0,
    JSON.stringify(stealCancel.body),
  );

  const ownCancel = await rest(p.pm.token, `room_bookings?id=eq.${pmBookingId}`, {
    method: 'DELETE',
  });
  check('a booker can cancel their own booking', (ownCancel.body ?? []).length === 1);

  const designBookingId = ownTeam.body?.[0]?.id;
  const itCancel = await rest(p.it.token, `room_bookings?id=eq.${designBookingId}`, {
    method: 'DELETE',
  });
  check('IT can cancel anyone’s booking', (itCancel.body ?? []).length === 1);

  // --- §4: rooms are retired, never deleted ---------------------------------

  // --- the club's clock (0027) ---------------------------------------------
  // Two copies of the timezone exist on purpose — the trigger cannot read a
  // TypeScript file, and formatDate should not need a database query. This is
  // the check that stops them drifting apart silently.
  const timeFile = await readFile('src/lib/time.ts', 'utf8');
  const inCode = /CLUB_TIME_ZONE = '([^']+)'/.exec(timeFile)?.[1];
  const { rows: tz } = await db.query(`select time_zone from booking_settings where id`);
  check(
    'CLUB_TIME_ZONE in the code matches booking_settings.time_zone',
    inCode === tz[0].time_zone,
    `code says ${inCode}, database says ${tz[0].time_zone}`,
  );

  // A booking written as 14:00 club time must read back as 14:00 club time.
  // Before 0027 this came back three hours out on a UTC database.
  const roundTrip = await post(
    p.pres.token,
    booking({
      starts_at: iso(14),
      ends_at: iso(15),
      party_kind: 'presidency',
      booked_by: p.pres.id,
    }),
  );
  const storedId = roundTrip.body?.[0]?.id;
  const { rows: back } = await db.query(
    `select to_char(starts_at at time zone $2, 'HH24:MI') as club_time
       from room_bookings where id = $1`,
    [storedId, ZONE],
  );
  check(
    'a booking written at 14:00 club time reads back as 14:00',
    back[0]?.club_time === '14:00',
    `read back as ${back[0]?.club_time}`,
  );

  // The schedule page bounds a day with the same zone-named literal. If that
  // did not parse, the grid would silently show an empty day.
  const dayQuery = await rest(
    p.pres.token,
    `room_bookings?select=id&starts_at=gte.${encodeURIComponent(`${dayText} 00:00:00 ${ZONE}`)}` +
      `&starts_at=lt.${encodeURIComponent(`${dayText} 23:59:59 ${ZONE}`)}`,
  );
  check(
    'a day bounded with the zone name finds that day’s bookings',
    (dayQuery.body ?? []).some((row) => row.id === storedId),
    JSON.stringify(dayQuery.body)?.slice(0, 80),
  );

  const roomDelete = await rest(p.it.token, `rooms?id=eq.${p.roomId}`, { method: 'DELETE' });
  check('not even IT can delete a room', !roomDelete.ok, `status ${roomDelete.status}`);

  const retire = await rest(p.it.token, `rooms?id=eq.${p.roomId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: false }),
  });
  check('IT can retire a room', allowed(retire));

  const designRetire = await rest(p.design.token, `rooms?id=eq.${p.roomId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: true }),
  });
  check('a non-IT Director cannot retire a room', !allowed(designRetire));
}

// -----------------------------------------------------------------------------

await db.connect();
try {
  await pinBookingWindow();
  await cleanUp();
  const people = await seed();
  await run(people);
} finally {
  await cleanUp();
  await restoreBookingWindow();
  await db.end();
}

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
