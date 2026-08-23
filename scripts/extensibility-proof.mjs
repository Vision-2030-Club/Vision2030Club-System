/**
 * Extensibility proof (spec §3 and §10).
 *
 *   npm run db:prove
 *
 * Two claims the system makes about itself, checked rather than asserted:
 *
 *   1. A new request workflow is CONFIGURATION. This script adds a
 *      "Sponsorship Request" type using nothing but INSERTs into
 *      request_types / request_statuses / request_transitions, then drives a
 *      real request through it end to end over the REST API. No TypeScript is
 *      touched, nothing is rebuilt, and the running server is never restarted.
 *
 *   2. What a role may do is CONFIGURATION. It flips one row in
 *      role_permissions and shows the same account's access change on the very
 *      next query, then puts the row back.
 *
 * Everything it creates is removed again at the end.
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

const PASSWORD = 'extensibility-proof-4c1d!';
const PREFIX = 'prooftest-';
const TYPE_KEY = 'sponsorship_request';

const db = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${name}${detail && !passed ? `\n         ${detail}` : ''}`);
}

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

const PEOPLE = {
  asker: { role: 'member', team: 'IT', student: '491000001', national: '1910000001' },
  prDirector: { role: 'team_director', team: 'PR', student: '491000002', national: '1910000002' },
};

async function cleanUp() {
  await db.query(
    `delete from requests where request_type_id in
       (select id from request_types where key = $1)`,
    [TYPE_KEY],
  );
  await db.query(
    `delete from requests where submitted_by in
       (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  // Statuses and transitions cascade from the type.
  await db.query('delete from request_types where key = $1', [TYPE_KEY]);
  await db.query(
    `delete from attendance_records where member_id in
       (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(
    `delete from member_sensitive where member_id in
       (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query('delete from members where email like $1', [`${PREFIX}%`]);

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
      'insert into member_sensitive (member_id, national_id) values ($1, $2)',
      [rows[0].id, spec.national],
    );

    people[name] = { id: rows[0].id, email, token: await signIn(email) };
  }
  return people;
}

// -----------------------------------------------------------------------------
// Claim 1 — a new workflow is rows, not code
// -----------------------------------------------------------------------------

async function addSponsorshipType() {
  const { rows } = await db.query(
    `insert into request_types
       (key, name_en, name_ar, description_en, description_ar,
        owning_team_id, field_schema)
     values ($1, 'Sponsorship Request', 'طلب رعاية',
             'Ask Public Relations to approach a sponsor.',
             'طلب من العلاقات العامة التواصل مع راعٍ.',
             (select id from teams where key = 'PR'),
             $2::jsonb)
     returning id`,
    [
      TYPE_KEY,
      JSON.stringify([
        { key: 'sponsor_name', type: 'text', label_en: 'Sponsor', label_ar: 'الراعي', required: true },
        { key: 'amount', type: 'number', label_en: 'Amount (SAR)', label_ar: 'المبلغ', required: true },
        { key: 'purpose', type: 'textarea', label_en: 'Purpose', label_ar: 'الغرض', required: false },
      ]),
    ],
  );
  const typeId = rows[0].id;

  await db.query(
    `insert into request_statuses
       (request_type_id, key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order)
     values
       ($1, 'submitted',    'Submitted',   'مُقدَّم',   true,  false, false, 10),
       ($1, 'under_review', 'Under review','قيد الدراسة', false, false, false, 20),
       ($1, 'approved',     'Approved',    'موافق عليه', false, true,  true,  30),
       ($1, 'rejected',     'Rejected',    'مرفوض',    false, true,  false, 40)`,
    [typeId],
  );

  await db.query(
    `insert into request_transitions
       (request_type_id, from_status, to_status, actor_rule, required_permission,
        label_en, label_ar, sort_order)
     values
       ($1, 'submitted',    'under_review', 'target_approver', null, 'Start review', 'بدء الدراسة', 10),
       ($1, 'under_review', 'approved',     'target_approver', null, 'Approve',      'موافقة',     20),
       ($1, 'under_review', 'rejected',     'target_approver', null, 'Reject',       'رفض',        30),
       ($1, 'submitted',    'rejected',     'target_approver', null, 'Reject',       'رفض',        40)`,
    [typeId],
  );

  return typeId;
}

async function proveNewWorkflow(people, typeId) {
  const { asker, prDirector } = people;

  const prTeam = (await db.query("select id from teams where key = 'PR'")).rows[0].id;

  // Submitted through the same generic endpoint every other type uses.
  const created = await rest(asker.token, 'requests', {
    method: 'POST',
    body: JSON.stringify({
      request_type_id: typeId,
      submitted_by: asker.id,
      target_kind: 'team',
      target_team_id: prTeam,
      status: 'submitted',
      data: { sponsor_name: 'Acme Co', amount: 25000, purpose: 'Hackathon prizes' },
    }),
  });
  check('a brand-new request type accepts a submission', allowed(created));

  const requestId = Array.isArray(created.body) ? created.body[0]?.id : null;
  if (!requestId) return;

  // The engine enforces the transition table it has never seen before.
  const illegal = await rpc(prDirector.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'approved',
    p_note: 'skipping review',
  });
  check(
    'the new type’s transition rules are enforced (submitted -> approved refused)',
    !illegal.ok && JSON.stringify(illegal.body).includes('not allowed'),
    JSON.stringify(illegal.body),
  );

  const review = await rpc(prDirector.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'under_review',
    p_note: 'looking at it',
  });
  check('the PR Director can start review', review.ok, JSON.stringify(review.body));

  const outsider = await rpc(asker.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'approved',
    p_note: 'approving my own request',
  });
  check(
    'the requester cannot approve their own request',
    !outsider.ok,
    JSON.stringify(outsider.body),
  );

  /*
   * A status can insist on data before anything may sit in it (0033), and that
   * too is one UPDATE rather than code. Here we say "Approved needs an agreed
   * amount", watch the approval be refused, then supply it and watch it go
   * through — all against the same running server.
   */
  await db.query(
    `update request_statuses set required_data_keys = '{agreed_amount}'
      where key = 'approved'
        and request_type_id = (select id from request_types where key = $1)`,
    [TYPE_KEY],
  );

  const missingData = await rpc(prDirector.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'approved',
    p_note: 'agreed',
  });
  check(
    'one UPDATE makes a status refuse a move that is missing its data',
    !missingData.ok && JSON.stringify(missingData.body).includes('agreed_amount'),
    JSON.stringify(missingData.body)?.slice(0, 90),
  );

  const withData = await rpc(prDirector.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'approved',
    p_note: 'agreed',
    p_patch: { agreed_amount: '5000' },
  });
  check(
    '…and accepts the same move once the data is supplied with it',
    withData.ok,
    JSON.stringify(withData.body)?.slice(0, 90),
  );

  await db.query(
    `update request_statuses set required_data_keys = '{}'
      where key = 'approved'
        and request_type_id = (select id from request_types where key = $1)`,
    [TYPE_KEY],
  );

  const approve = { ok: withData.ok, body: withData.body };
  check('the PR Director can approve', approve.ok, JSON.stringify(approve.body));

  const { rows: history } = await db.query(
    'select count(*)::int n from request_status_history where request_id = $1',
    [requestId],
  );
  check(
    'history was recorded for the new type with no extra wiring',
    history[0].n >= 2,
    `${history[0].n} rows`,
  );

  // The type has no on_approval_hook, so approval must not touch the calendar.
  const { rows: entries } = await db.query(
    'select count(*)::int n from calendar_entries where source_request_id = $1',
    [requestId],
  );
  check('a type without a hook creates no calendar entry', entries[0].n === 0);
}

// -----------------------------------------------------------------------------
// Claim 2 — a permission change is one UPDATE
// -----------------------------------------------------------------------------

async function provePermissionChange(people) {
  const { asker } = people;

  await db.query(
    `insert into attendance_records (member_id, activity_name, occurred_at, status)
     values ($1, $2, now(), 'present')`,
    [asker.id, `${PREFIX}activity`],
  );

  const before = await rest(asker.token, 'attendance_records?select=id');
  check(
    'before: a Member cannot see their own attendance',
    !allowed(before),
    JSON.stringify(before.body),
  );

  // The one-line change the 0009 migration documents in its comments.
  await db.query(
    `update role_permissions set scope = 'own'
     where permission_key = 'attendance.view'
       and role_id = (select id from roles where key = 'member')`,
  );

  const after = await rest(asker.token, 'attendance_records?select=id,member_id');
  check(
    'after one UPDATE: the same account, same token, now sees its own attendance',
    allowed(after) && after.body.every((row) => row.member_id === asker.id),
    JSON.stringify(after.body),
  );

  await db.query(
    `update role_permissions set scope = 'none'
     where permission_key = 'attendance.view'
       and role_id = (select id from roles where key = 'member')`,
  );

  const reverted = await rest(asker.token, 'attendance_records?select=id');
  check('reverting the row restores the original access', !allowed(reverted));
}

// -----------------------------------------------------------------------------

await db.connect();

try {
  await cleanUp();
  const people = await seed();
  const typeId = await addSponsorshipType();
  await proveNewWorkflow(people, typeId);
  await provePermissionChange(people);
} finally {
  await cleanUp();
  await db.end();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log('\nFailed:');
  for (const failure of failed) console.log(`  - ${failure.name}`);
  process.exit(1);
}
