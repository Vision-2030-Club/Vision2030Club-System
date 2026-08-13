/**
 * Verification of the access model (spec §10).
 *
 *   npm run db:test
 *
 * Every assertion here goes through the REST API as a signed-in person, not
 * through the application. That is the whole point: the UI can be bypassed, so
 * proving the rules means proving them at the layer an attacker would actually
 * reach. If a test passes here it passes regardless of what the front end does.
 *
 * The script seeds its own people (emails prefixed `permtest-`), runs, and
 * deletes them again. It is safe to re-run, and safe against a database with
 * real data in it — it never touches a row it did not create.
 */
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

const PASSWORD = 'permission-tests-9f2a!';
const PREFIX = 'permtest-';

const db = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

// -----------------------------------------------------------------------------
// Test harness
// -----------------------------------------------------------------------------

const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const mark = passed ? '  ok  ' : ' FAIL ';
  console.log(`${mark} ${name}${detail && !passed ? `\n         ${detail}` : ''}`);
}

// -----------------------------------------------------------------------------
// Talking to the API the way anything outside the app would
// -----------------------------------------------------------------------------

async function rest(token, path, init = {}) {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
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

const rpc = (token, name, args) =>
  rest(token, `rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

/** A write is "refused" whether RLS hid the row or a trigger raised. */
const refused = (result) =>
  !result.ok || (Array.isArray(result.body) && result.body.length === 0);

const allowed = (result) =>
  result.ok && Array.isArray(result.body) && result.body.length > 0;

async function signIn(email) {
  const response = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await response.json();
  if (!body.access_token) {
    throw new Error(`Could not sign in as ${email}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function adminFetch(path, init = {}) {
  const response = await fetch(`${API_URL}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
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

// -----------------------------------------------------------------------------
// Seeding
// -----------------------------------------------------------------------------

const PEOPLE = {
  root: { role: 'super_admin', team: 'IT', student: '490000001', national: '1900000001' },
  alice: { role: 'member', team: 'IT', student: '490000002', national: '1900000002' },
  dana: { role: 'team_director', team: 'DESIGN', student: '490000003', national: '1900000003' },
  huda: { role: 'team_director', team: 'HR', student: '490000004', national: '1900000004' },
  gina: { role: 'guest', team: 'CLUB_MGMT', student: '490000005', national: '1900000005' },
};

async function cleanUp() {
  // Children first — some of these have no cascade back to members.
  await db.query(
    `delete from calendar_entries where created_by in
       (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(
    `delete from requests where submitted_by in
       (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(
    `delete from asset_checkouts where member_id in
       (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(`delete from assets where tag like $1`, [`${PREFIX}%`]);
  await db.query(`delete from attendance_records where member_id in
       (select id from members where email like $1)`, [`${PREFIX}%`]);
  await db.query(`delete from member_sensitive where member_id in
       (select id from members where email like $1)`, [`${PREFIX}%`]);
  await db.query(`delete from members where email like $1`, [`${PREFIX}%`]);
  await db.query(`delete from members where student_id = '400000999'`);

  const { body } = await adminFetch('admin/users?per_page=200');
  for (const user of body?.users ?? []) {
    if (user.email?.startsWith(PREFIX)) {
      await adminFetch(`admin/users/${user.id}`, { method: 'DELETE' });
    }
  }
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
      throw new Error(
        `Could not create the auth account for ${email}: ${JSON.stringify(created.body)}`,
      );
    }

    const { rows } = await db.query(
      `insert into members
         (auth_user_id, email, name_en, name_ar, student_id, team_id, role_id)
       values ($1, $2, $3, $4, $5,
               (select id from teams where key = $6),
               (select id from roles where key = $7))
       returning id`,
      [created.body.id, email, name, name, spec.student, spec.team, spec.role],
    );

    await db.query(
      `insert into member_sensitive (member_id, national_id) values ($1, $2)`,
      [rows[0].id, spec.national],
    );

    people[name] = {
      id: rows[0].id,
      email,
      authId: created.body.id,
      token: await signIn(email),
    };
  }

  return people;
}

// -----------------------------------------------------------------------------
// The tests
// -----------------------------------------------------------------------------

async function run(people) {
  const { root, alice, dana, huda, gina } = people;

  const teamId = async (key) =>
    (await db.query('select id from teams where key = $1', [key])).rows[0].id;

  const designTeam = await teamId('DESIGN');

  // --- §2: a Member may not edit another member -----------------------------
  check(
    'a Member editing another member is refused',
    refused(
      await rest(alice.token, `members?id=eq.${dana.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name_en: 'edited by alice' }),
      }),
    ),
  );

  // --- §2 rollback: the single most important pair --------------------------
  check(
    'a non-HR Director editing a member is refused',
    refused(
      await rest(dana.token, `members?id=eq.${alice.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name_en: 'edited by a non-HR director' }),
      }),
    ),
  );

  const danaSensitive = await rest(
    dana.token,
    `member_sensitive?member_id=eq.${alice.id}&select=national_id`,
  );
  check(
    'a non-HR Director reading member_sensitive is refused',
    !allowed(danaSensitive),
    JSON.stringify(danaSensitive.body),
  );

  check(
    'an HR Director editing a member is allowed',
    allowed(
      await rest(huda.token, `members?id=eq.${alice.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ college: 'Computer Science' }),
      }),
    ),
  );

  const hudaSensitive = await rest(
    huda.token,
    `member_sensitive?member_id=eq.${alice.id}&select=national_id`,
  );
  check(
    'an HR Director reading member_sensitive is allowed',
    allowed(hudaSensitive),
    JSON.stringify(hudaSensitive.body),
  );

  // --- §6: club calendar entries -------------------------------------------
  const clubEntry = await rest(root.token, 'calendar_entries', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'club',
      title: `${PREFIX}club event`,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_by: root.id,
    }),
  });
  check('a Super Admin can create a club calendar entry', allowed(clubEntry));

  check(
    'a Member creating a club calendar entry is refused',
    refused(
      await rest(alice.token, 'calendar_entries', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'club',
          title: `${PREFIX}member club event`,
          starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + 3_600_000).toISOString(),
          created_by: alice.id,
        }),
      }),
    ),
  );

  // --- Guest sees club calendar entries and nothing else --------------------
  const guestCalendar = await rest(
    gina.token,
    'calendar_entries?select=id,kind&kind=eq.club',
  );
  check(
    'a Guest can read club calendar entries',
    allowed(guestCalendar),
    JSON.stringify(guestCalendar.body),
  );

  for (const table of ['projects', 'tasks', 'assets', 'attendance_records']) {
    const result = await rest(gina.token, `${table}?select=id&limit=5`);
    check(
      `a Guest reading ${table} gets nothing`,
      !allowed(result),
      `status ${result.status}: ${JSON.stringify(result.body)}`,
    );
  }

  // `members` is the one exception, and it is deliberate: members_select ends
  // with `or id = current_member_id()`, so everyone can see their own row and
  // nothing more. Guest holds members.view = none, so that is all they get.
  const guestMembers = await rest(gina.token, 'members?select=id');
  check(
    'a Guest reading members sees only their own row',
    guestMembers.ok &&
      guestMembers.body.length === 1 &&
      guestMembers.body[0].id === gina.id,
    JSON.stringify(guestMembers.body),
  );

  // --- §3: the request engine ----------------------------------------------
  const { rows: typeRows } = await db.query(
    `select id from request_types where key = 'meeting_request'`,
  );
  const meetingType = typeRows[0].id;

  const startAt = new Date(Date.now() + 86_400_000).toISOString();

  const created = await rest(alice.token, 'requests', {
    method: 'POST',
    body: JSON.stringify({
      request_type_id: meetingType,
      submitted_by: alice.id,
      target_kind: 'team',
      target_team_id: designTeam,
      status: 'pending',
      data: {
        title: `${PREFIX}meeting`,
        proposed_start: startAt,
        proposed_end: new Date(Date.now() + 90_000_000).toISOString(),
      },
    }),
  });
  check('a Member can submit a Meeting Request', allowed(created));

  const requestId = Array.isArray(created.body) ? created.body[0]?.id : null;

  if (requestId) {
    // An illegal jump must raise, not quietly do nothing.
    const illegal = await rpc(dana.token, 'transition_request', {
      p_request: requestId,
      p_to_status: 'countered_by_requester',
      p_note: 'illegal jump',
    });
    const stillPending = await db.query('select status from requests where id = $1', [
      requestId,
    ]);
    check(
      'an illegal status jump raises an error',
      !illegal.ok && String(JSON.stringify(illegal.body)).includes('not allowed'),
      JSON.stringify(illegal.body),
    );
    check(
      'the illegal jump changed nothing',
      stillPending.rows[0].status === 'pending',
      `status is ${stillPending.rows[0].status}`,
    );

    // Five counters, alternating sides. No calendar entry may appear yet.
    const counterSteps = [
      [dana, 'countered_by_target'],
      [alice, 'countered_by_requester'],
      [dana, 'countered_by_target'],
      [alice, 'countered_by_requester'],
      [dana, 'countered_by_target'],
    ];

    let countersOk = true;
    let calendarLeaked = false;

    for (const [actor, status] of counterSteps) {
      const step = await rpc(actor.token, 'transition_request', {
        p_request: requestId,
        p_to_status: status,
        p_note: `counter to ${status}`,
      });
      if (!step.ok) {
        countersOk = false;
        check(`counter to ${status}`, false, JSON.stringify(step.body));
        break;
      }

      const { rows } = await db.query(
        'select count(*)::int n from calendar_entries where source_request_id = $1',
        [requestId],
      );
      if (rows[0].n !== 0) calendarLeaked = true;
    }

    check('five counters all succeeded', countersOk);
    check('no calendar entry existed during the counter loop', !calendarLeaked);

    // Approval is the only thing that reaches the calendar.
    const approve = await rpc(alice.token, 'transition_request', {
      p_request: requestId,
      p_to_status: 'approved',
      p_note: 'agreed',
    });
    check('the requester can accept the final counter', approve.ok, JSON.stringify(approve.body));

    const { rows: entryRows } = await db.query(
      'select count(*)::int n from calendar_entries where source_request_id = $1',
      [requestId],
    );
    check(
      'approval created exactly one calendar entry',
      entryRows[0].n === 1,
      `found ${entryRows[0].n}`,
    );

    const { rows: historyRows } = await db.query(
      'select count(*)::int n from request_status_history where request_id = $1',
      [requestId],
    );
    // 5 counters + 1 approval; the initial insert may or may not be recorded.
    check(
      'request_status_history recorded every legal change',
      historyRows[0].n >= 6,
      `found ${historyRows[0].n} history rows`,
    );
  }

  // --- §4: CSV import is all-or-nothing ------------------------------------
  const goodRow = {
    email: `${PREFIX}import@example.test`,
    name_en: 'Imported Person',
    name_ar: 'شخص',
    student_id: '400000999',
    national_id: '1000000999',
    team: 'IT',
    role: 'member',
  };
  const badRow = { ...goodRow, email: `${PREFIX}import2@example.test`, student_id: '400000998', national_id: '99' };

  const badImport = await rpc(root.token, 'import_members', { p_rows: [goodRow, badRow] });
  const badReport = badImport.body;
  check(
    'an import with one bad national ID reports the problem',
    badReport?.ok === false && badReport.errors?.some((e) => e.field === 'national_id'),
    JSON.stringify(badReport),
  );

  const { rows: writtenRows } = await db.query(
    `select count(*)::int n from members where student_id in ('400000999','400000998')`,
  );
  check(
    'the failed import wrote nothing at all',
    writtenRows[0].n === 0,
    `found ${writtenRows[0].n} members`,
  );

  const firstImport = await rpc(root.token, 'import_members', { p_rows: [goodRow] });
  check(
    'a clean import creates the member',
    firstImport.body?.ok === true && firstImport.body.created === 1,
    JSON.stringify(firstImport.body),
  );

  const secondImport = await rpc(root.token, 'import_members', {
    p_rows: [{ ...goodRow, name_en: 'Imported Person Renamed' }],
  });
  const { rows: dupeRows } = await db.query(
    `select count(*)::int n from members where student_id = '400000999'`,
  );
  check(
    're-importing an existing student ID updates rather than duplicating',
    secondImport.body?.ok === true &&
      secondImport.body.updated === 1 &&
      dupeRows[0].n === 1,
    `${JSON.stringify(secondImport.body)}, ${dupeRows[0].n} rows`,
  );

  // --- §8: one active holder per asset -------------------------------------
  const { rows: assetRows } = await db.query(
    `insert into assets (tag, name_en, name_ar) values ($1, 'Test Camera', 'كاميرا')
     returning id`,
    [`${PREFIX}camera`],
  );
  const assetId = assetRows[0].id;

  const checkout = (person) =>
    rest(person.token, 'asset_checkouts', {
      method: 'POST',
      body: JSON.stringify({
        asset_id: assetId,
        member_id: person.id,
        checked_out_by: person.id,
      }),
    });

  const [first, second] = await Promise.all([checkout(alice), checkout(dana)]);
  const succeeded = [first, second].filter((r) => allowed(r)).length;
  check(
    'two concurrent checkouts of one asset: exactly one succeeds',
    succeeded === 1,
    `${succeeded} succeeded — ${JSON.stringify([first.status, second.status])}`,
  );

  // --- §9: attendance is invisible by default ------------------------------
  await db.query(
    `insert into attendance_records (member_id, activity_name, occurred_at, status)
     values ($1, $2, now(), 'present')`,
    [alice.id, `${PREFIX}activity`],
  );

  const danaAttendance = await rest(dana.token, 'attendance_records?select=id');
  check(
    'a non-HR Director cannot read attendance',
    !allowed(danaAttendance),
    JSON.stringify(danaAttendance.body),
  );

  const hudaAttendance = await rest(huda.token, 'attendance_records?select=id');
  check(
    'an HR Director can read attendance',
    allowed(hudaAttendance),
    JSON.stringify(hudaAttendance.body),
  );
}

// -----------------------------------------------------------------------------

await db.connect();

try {
  await cleanUp();
  const people = await seed();
  await run(people);
} finally {
  await cleanUp();
  await db.end();
}

const failed = results.filter((r) => !r.passed);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed.`,
);

if (failed.length) {
  console.log('\nFailed:');
  for (const failure of failed) console.log(`  - ${failure.name}`);
  process.exit(1);
}
