/**
 * Verification of push notifications (0049).
 *
 *   npm run db:notify
 *
 * Nothing here talks to Apple. What is proved is the half the database owns:
 * that the right rows land in `notification_outbox` for the right people —
 * and, just as much, that the wrong people get nothing. The recipient rules
 * are the permission map run backwards, so the checks are phrased the way a
 * person would say them: "the target team's Director is told, the requester
 * is not told about their own request, the President is not told about a
 * team-level request".
 *
 * Writes go through the REST API as a signed-in person, exactly as the app
 * does, so the triggers run with `app.current_member_id()` set. Setup and
 * assertions read the outbox with the service role — nobody else can.
 *
 * Seeds its own people (`pushtest-`) with fake device subscriptions, then
 * removes everything.
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

const PASSWORD = 'push-tests-4f9a!';
const PREFIX = 'pushtest-';
const ENTRY_TAG = 'pushtest entry';
const TASK_TAG = 'pushtest task';
const PROJECT_TAG = 'pushtest project';

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
  return { ok: response.ok, body: await response.json().catch(() => null) };
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
  return { status: response.status, ok: response.ok, body: await response.json().catch(() => null) };
}

const rpc = (token, name, args) =>
  rest(token, `rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

const allowed = (r) => r.ok && Array.isArray(r.body) && r.body.length > 0;

const PEOPLE = {
  // Two Directors of the target team: both must be told, whichever acts.
  media1: { role: 'team_director', team: 'MEDIA', student: '493000001', national: '1930000001' },
  media2: { role: 'team_director', team: 'MEDIA', student: '493000002', national: '1930000002' },
  design: { role: 'team_director', team: 'DESIGN', student: '493000003', national: '1930000003' },
  member: { role: 'member', team: 'DESIGN', student: '493000004', national: '1930000004' },
  // Holds `all` on requests.approve — and must NOT be told about a team-level
  // request, because the team's own Directors are the nearer authority.
  pres: { role: 'president', team: 'CLUB_MGMT', student: '493000005', national: '1930000005' },
  // Holds `all` too — but sits IN the target team, so is told (0053).
  admin: { role: 'super_admin', team: 'MEDIA', student: '493000007', national: '1930000007' },
  // Runs the project below. Only a PM's scope (own_projects) can post a
  // project task — a Director's own_team cannot.
  pm: { role: 'project_manager', team: 'DESIGN', student: '493000006', national: '1930000006' },
};

async function cleanUp() {
  // Reminder rows for test entries, before the entries go — a real person's
  // row would otherwise survive the cascade and be sent for a deleted entry.
  await db.query(
    `delete from notification_outbox
      where dedupe_key like 'reminder:%'
        and split_part(dedupe_key, ':', 2)::uuid in
            (select id from calendar_entries where title like $1)`,
    [`${ENTRY_TAG}%`],
  );
  await db.query(
    `delete from calendar_entries
      where title like $1
         or source_request_id in (select id from requests where submitted_by in
              (select id from members where email like $2))`,
    [`${ENTRY_TAG}%`, `${PREFIX}%`],
  );
  await db.query(
    `delete from requests where submitted_by in (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(`delete from tasks where title like $1`, [`${TASK_TAG}%`]);
  // Splits, memberships and any remaining tasks cascade from the project.
  await db.query(`delete from projects where name_en like $1`, [`${PROJECT_TAG}%`]);
  await db.query(
    `delete from member_sensitive where member_id in (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  // Subscriptions and outbox rows cascade from the member.
  await db.query(`delete from members where email like $1`, [`${PREFIX}%`]);

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
    if (!created.ok) throw new Error(`Could not create ${email}`);

    const { rows } = await db.query(
      `insert into members (auth_user_id, email, name_en, name_ar, student_id, team_id, role_id)
       values ($1, $2, $3, $3, $4,
               (select id from teams where key = $5),
               (select id from roles where key = $6))
       returning id`,
      [created.body.id, email, name, spec.student, spec.team, spec.role],
    );
    await db.query(`insert into member_sensitive (member_id, national_id) values ($1,$2)`, [
      rows[0].id,
      spec.national,
    ]);

    // A device each. The endpoint is never contacted by this suite.
    await db.query(
      `insert into push_subscriptions (member_id, endpoint, p256dh, auth, locale)
       values ($1, $2, 'p256dh', 'auth', 'en')`,
      [rows[0].id, `https://push.example.test/${PREFIX}${name}`],
    );

    people[name] = { id: rows[0].id, email, token: await signIn(email) };
  }

  const { rows: t } = await db.query(`select key, id from teams where key in ('DESIGN','MEDIA')`);
  people.teams = Object.fromEntries(t.map((r) => [r.key, r.id]));

  const { rows: type } = await db.query(`select id from request_types where key = 'meeting_request'`);
  people.typeId = type[0].id;

  // A project run by the PM, with two members — one of whom is also in a
  // split, so "split only" has somebody to leave out.
  const { rows: project } = await db.query(
    `insert into projects (name_en, name_ar, owning_team_id, created_by)
     values ($1, $1, $2, $3) returning id`,
    [PROJECT_TAG, people.teams.DESIGN, people.pm.id],
  );
  people.projectId = project[0].id;
  await db.query(`insert into project_managers (project_id, member_id) values ($1, $2)`, [
    people.projectId,
    people.pm.id,
  ]);
  await db.query(
    `insert into project_members (project_id, member_id) values ($1, $2), ($1, $3)`,
    [people.projectId, people.member.id, people.media1.id],
  );
  const { rows: split } = await db.query(
    `insert into project_splits (project_id, name, created_by) values ($1, $2, $3) returning id`,
    [people.projectId, `${PROJECT_TAG} split`, people.pm.id],
  );
  people.splitId = split[0].id;
  await db.query(`insert into project_split_members (split_id, member_id) values ($1, $2)`, [
    people.splitId,
    people.member.id,
  ]);

  return people;
}

/** Outbox rows for one person, newest first — service role, nobody else. */
async function outboxFor(memberId) {
  const { rows } = await db.query(
    `select kind, title_en, body_en, url, dedupe_key, sent_at, attempts
       from notification_outbox where member_id = $1 order by created_at desc`,
    [memberId],
  );
  return rows;
}

const kinds = (rows) => rows.map((r) => r.kind);

async function run(p) {
  const day = new Date();
  day.setDate(day.getDate() + 2);
  const dayText = day.toISOString().slice(0, 10);
  const at = (hour) => `${dayText}T${String(hour).padStart(2, '0')}:00:00+03:00`;

  // --- A request is submitted to a team --------------------------------------

  const proposed = await rest(p.pm.token, 'requests', {
    method: 'POST',
    body: JSON.stringify({
      request_type_id: p.typeId,
      submitted_by: p.pm.id,
      status: 'pending',
      target_kind: 'team',
      target_team_id: p.teams.MEDIA,
      data: { title: 'Push sync', meeting_type: 'online', proposed_start: at(13), duration_minutes: '60' },
    }),
  });
  check('a PM can propose a meeting to a team', allowed(proposed), JSON.stringify(proposed.body));
  const requestId = proposed.body?.[0]?.id;

  const media1 = await outboxFor(p.media1.id);
  const media2 = await outboxFor(p.media2.id);
  check(
    'both Directors of the target team are told it was submitted',
    kinds(media1).includes('request_submitted') && kinds(media2).includes('request_submitted'),
    `${JSON.stringify(kinds(media1))} / ${JSON.stringify(kinds(media2))}`,
  );
  check(
    'the notification opens the request',
    media1[0]?.url === `/requests/${requestId}`,
    media1[0]?.url,
  );
  check(
    'the title reads once, not "Meeting Request request"',
    media1[0]?.title_en === 'New request: Meeting Request',
    media1[0]?.title_en,
  );
  check(
    'a Super Admin who sits in the target team is told as well',
    kinds(await outboxFor(p.admin.id)).includes('request_submitted'),
    JSON.stringify(kinds(await outboxFor(p.admin.id))),
  );
  check(
    'the requester is not told about their own request',
    (await outboxFor(p.pm.id)).length === 0,
  );
  check(
    'the President, whose scope is "all", is not told about a team-level request',
    (await outboxFor(p.pres.id)).length === 0,
    JSON.stringify(kinds(await outboxFor(p.pres.id))),
  );
  check(
    'a Director of another team is not told',
    (await outboxFor(p.design.id)).length === 0,
  );

  // --- The target moves it -----------------------------------------------------

  const reviewed = await rest(p.media1.token, `requests?id=eq.${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'under_review' }),
  });
  check('a target Director can start review', allowed(reviewed), JSON.stringify(reviewed.body));

  const memberAfterReview = await outboxFor(p.pm.id);
  check(
    'the requester is told the request moved',
    kinds(memberAfterReview).includes('request_moved'),
    JSON.stringify(kinds(memberAfterReview)),
  );
  check(
    'the body names the new status',
    memberAfterReview[0]?.body_en.includes('Under review'),
    memberAfterReview[0]?.body_en,
  );
  check(
    'the Director who acted is not told about their own action',
    kinds(await outboxFor(p.media1.id)).filter((k) => k !== 'request_submitted').length === 0,
    JSON.stringify(kinds(await outboxFor(p.media1.id))),
  );
  check(
    'the other Director is told the request is still with them',
    kinds(await outboxFor(p.media2.id)).includes('request_awaiting'),
    JSON.stringify(kinds(await outboxFor(p.media2.id))),
  );

  // --- The meeting is confirmed ------------------------------------------------

  const approved = await rest(p.media1.token, `requests?id=eq.${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved' }),
  });
  check('a target Director can approve', allowed(approved), JSON.stringify(approved.body));

  const memberAfterApprove = await outboxFor(p.pm.id);
  check(
    'the requester is told the meeting is confirmed, not merely "moved"',
    memberAfterApprove[0]?.kind === 'meeting_confirmed',
    JSON.stringify(kinds(memberAfterApprove)),
  );
  check(
    'the confirmation carries the title and the time',
    /Push sync — \d\d\/\d\d 13:00/.test(memberAfterApprove[0]?.body_en ?? ''),
    memberAfterApprove[0]?.body_en,
  );
  check(
    'the other Director is told the meeting is confirmed too',
    kinds(await outboxFor(p.media2.id)).includes('meeting_confirmed'),
    JSON.stringify(kinds(await outboxFor(p.media2.id))),
  );
  check(
    'nobody is told to act on a request that is finished',
    !kinds(await outboxFor(p.media2.id)).slice(0, 1).includes('request_awaiting'),
  );

  // --- Tasks -------------------------------------------------------------------

  const task = await rest(p.design.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: `${TASK_TAG} assigned`,
      team_id: p.teams.DESIGN,
      created_by: p.design.id,
      assigned_at: new Date().toISOString(),
    }),
  });
  check('a Director can create a team task', allowed(task), JSON.stringify(task.body));
  const taskId = task.body?.[0]?.id;

  const assigned = await rest(p.design.token, 'task_assignees', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, member_id: p.member.id }),
  });
  check('…and assign it', allowed(assigned), JSON.stringify(assigned.body));

  const memberTasks = await outboxFor(p.member.id);
  check(
    'the assignee is told about a task given to them',
    memberTasks[0]?.kind === 'task_assigned' && memberTasks[0]?.body_en === `${TASK_TAG} assigned`,
    JSON.stringify(memberTasks[0]),
  );

  const own = await rest(p.design.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: `${TASK_TAG} own`,
      team_id: p.teams.DESIGN,
      created_by: p.design.id,
      assigned_at: new Date().toISOString(),
    }),
  });
  const before = (await outboxFor(p.design.id)).length;
  const selfAssigned = await rest(p.design.token, 'task_assignees', {
    method: 'POST',
    body: JSON.stringify({ task_id: own.body?.[0]?.id, member_id: p.design.id }),
  });
  check('a Director can take a task themselves', allowed(selfAssigned), JSON.stringify(selfAssigned.body));
  check(
    'taking a task you posted yourself is not news',
    (await outboxFor(p.design.id)).length === before,
  );

  // --- Posted for claiming -----------------------------------------------------

  const posted = await rest(p.pm.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: `${TASK_TAG} open`,
      project_id: p.projectId,
      created_by: p.pm.id,
    }),
  });
  check('a PM can post a project task with no assignee', allowed(posted), JSON.stringify(posted.body));
  const openId = posted.body?.[0]?.id;

  check(
    'every project member is told a task is open to claim',
    (await outboxFor(p.member.id))[0]?.kind === 'task_open' &&
      (await outboxFor(p.media1.id))[0]?.kind === 'task_open',
    `${JSON.stringify(kinds(await outboxFor(p.member.id)))} / ${JSON.stringify(kinds(await outboxFor(p.media1.id)))}`,
  );
  check(
    'the PM who posted it is not',
    (await outboxFor(p.pm.id))[0]?.kind !== 'task_open',
    JSON.stringify(kinds(await outboxFor(p.pm.id))),
  );
  check('the President is not', (await outboxFor(p.pres.id)).length === 0);

  const claimedOpen = await rpc(p.member.token, 'claim_task', { p_task: openId });
  check('a project member can claim it', claimedOpen.ok, JSON.stringify(claimedOpen.body));

  const posterAfterClaim = await outboxFor(p.pm.id);
  check(
    'the poster is told who took it',
    posterAfterClaim[0]?.kind === 'task_claimed' &&
      posterAfterClaim[0]?.body_en === `member took "${TASK_TAG} open".`,
    JSON.stringify(posterAfterClaim[0]),
  );
  check(
    'the claimer is not told about their own claim',
    (await outboxFor(p.member.id))[0]?.kind === 'task_open',
    JSON.stringify(kinds(await outboxFor(p.member.id))),
  );

  const mediaBeforeSplit = (await outboxFor(p.media1.id)).length;
  const splitTask = await rest(p.pm.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: `${TASK_TAG} split`,
      project_id: p.projectId,
      split_id: p.splitId,
      created_by: p.pm.id,
    }),
  });
  check('a task can be posted to one split', allowed(splitTask), JSON.stringify(splitTask.body));
  check(
    "only the split's members are told about a split task",
    (await outboxFor(p.member.id))[0]?.kind === 'task_open' &&
      (await outboxFor(p.member.id))[0]?.body_en === `${TASK_TAG} split` &&
      (await outboxFor(p.media1.id)).length === mediaBeforeSplit,
    JSON.stringify(kinds(await outboxFor(p.media1.id))),
  );

  const mediaBeforeAssigned = (await outboxFor(p.media1.id)).length;
  const projectAssigned = await rest(p.pm.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: `${TASK_TAG} project assigned`,
      project_id: p.projectId,
      created_by: p.pm.id,
      assigned_at: new Date().toISOString(),
    }),
  });
  await rest(p.pm.token, 'task_assignees', {
    method: 'POST',
    body: JSON.stringify({ task_id: projectAssigned.body?.[0]?.id, member_id: p.member.id }),
  });
  check(
    'a project task created WITH an assignee is not announced as open',
    (await outboxFor(p.media1.id)).length === mediaBeforeAssigned &&
      (await outboxFor(p.member.id))[0]?.kind === 'task_assigned',
    JSON.stringify(kinds(await outboxFor(p.member.id)).slice(0, 2)),
  );

  const submitted = await rpc(p.member.token, 'submit_task_for_review', { p_task: taskId });
  check('the assignee can submit it', submitted.ok, JSON.stringify(submitted.body));
  check(
    'the team Director is told a task is ready for review',
    (await outboxFor(p.design.id))[0]?.kind === 'task_submitted',
    JSON.stringify(kinds(await outboxFor(p.design.id))),
  );
  check(
    'the President is not told about a team task',
    (await outboxFor(p.pres.id)).length === 0,
    JSON.stringify(kinds(await outboxFor(p.pres.id))),
  );

  const confirmed = await rpc(p.design.token, 'confirm_task', { p_task: taskId, p_quality: 'good' });
  check('the Director can confirm it', confirmed.ok, JSON.stringify(confirmed.body));
  check(
    'the assignee is told it was confirmed',
    (await outboxFor(p.member.id))[0]?.kind === 'task_confirmed',
    JSON.stringify(kinds(await outboxFor(p.member.id))),
  );

  // --- Reminders ---------------------------------------------------------------

  // A MEETING with an individual audience of the test people — never a club
  // entry. This runs against the live database, and a club entry would remind
  // every real person with a phone about "pushtest entry soon". It did, once.
  const ours = [p.media1.id, p.media2.id, p.design.id, p.member.id, p.pres.id];
  async function testEntry(title, startsAt, endsAt) {
    const { rows } = await db.query(
      `insert into calendar_entries
         (kind, title, starts_at, ends_at, created_by, meeting_scope_kind)
       values ('meeting', $1, $2, $3, $4, 'presidency') returning id`,
      [title, startsAt, endsAt, p.pres.id],
    );
    for (const memberId of ours) {
      await db.query(
        `insert into calendar_entry_audiences (entry_id, audience_kind, member_id)
         values ($1, 'individual', $2)`,
        [rows[0].id, memberId],
      );
    }
    return rows[0].id;
  }

  const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const later = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  const entryId = await testEntry(`${ENTRY_TAG} soon`, soon, later);

  const { rows: swept } = await db.query(`select public.push_enqueue_reminders(60) as n`);
  const { rows: reminded } = await db.query(
    `select member_id from notification_outbox where dedupe_key like $1`,
    [`reminder:${entryId}:%`],
  );
  check(
    'an entry starting within the hour reminds everyone in its audience',
    swept[0].n >= ours.length && ours.every((id) => reminded.some((r) => r.member_id === id)),
    `swept ${swept[0].n}, reminded ${reminded.length}`,
  );
  check(
    'and nobody outside it',
    reminded.every((r) => ours.includes(r.member_id)),
    `${reminded.length} reminded`,
  );

  const { rows: sweptAgain } = await db.query(`select public.push_enqueue_reminders(60) as n`);
  const { rows: remindedAgain } = await db.query(
    `select count(*)::int as n from notification_outbox where dedupe_key like $1`,
    [`reminder:${entryId}:%`],
  );
  check(
    'a second sweep over the same window writes nothing',
    sweptAgain[0].n === 0 && remindedAgain[0].n === reminded.length,
    `swept ${sweptAgain[0].n}, rows ${remindedAgain[0].n}`,
  );

  const farId = await testEntry(
    `${ENTRY_TAG} far`,
    new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  );
  await db.query(`select public.push_enqueue_reminders(60)`);
  const { rows: farRows } = await db.query(
    `select count(*)::int as n from notification_outbox where dedupe_key like $1`,
    [`reminder:${farId}:%`],
  );
  check('an entry outside the window is not reminded yet', farRows[0].n === 0);

  // --- Leasing -----------------------------------------------------------------

  const { rows: claimedRows } = await db.query(
    `select id, attempts, claimed_at from public.push_claim_outbox(1000, $1)`,
    [p.member.id],
  );
  check(
    'claiming leases every pending row and counts the attempt',
    claimedRows.length > 0 && claimedRows.every((r) => r.attempts === 1 && r.claimed_at),
    JSON.stringify(claimedRows.slice(0, 2)),
  );
  const { rows: reclaimed } = await db.query(
    `select id from public.push_claim_outbox(1000) where member_id = $1`,
    [p.member.id],
  );
  check('a leased row is not handed out again inside the lease', reclaimed.length === 0);

  // --- Who can see what --------------------------------------------------------

  const mine = await rest(p.member.token, 'push_subscriptions?select=member_id');
  check(
    'a person sees only their own devices',
    mine.ok && mine.body.length === 1 && mine.body[0].member_id === p.member.id,
    JSON.stringify(mine.body),
  );

  const forged = await rest(p.member.token, 'push_subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      member_id: p.design.id,
      endpoint: 'https://push.example.test/forged',
      p256dh: 'x',
      auth: 'y',
    }),
  });
  check('a device cannot be registered under somebody else', !forged.ok, JSON.stringify(forged.body));

  const outbox = await rest(p.pres.token, 'notification_outbox?select=id');
  check(
    'nobody can read the outbox through the API, not even the President',
    !outbox.ok || (Array.isArray(outbox.body) && outbox.body.length === 0),
    JSON.stringify(outbox.body),
  );

  const sweepByUser = await rpc(p.pres.token, 'push_enqueue_reminders', { p_minutes: 60 });
  check('the reminder sweep is not callable by a signed-in person', !sweepByUser.ok);

  const claimByUser = await rpc(p.pres.token, 'push_claim_outbox', { p_limit: 10 });
  check('the outbox claim is not callable by a signed-in person', !claimByUser.ok);

  // --- A PM can request a meeting (0051) ---------------------------------------
  // Not a push rule, but this suite is the one with a PM who runs exactly one
  // project, which is the branch 0037 broke.

  const byPm = await rest(p.pm.token, 'requests', {
    method: 'POST',
    body: JSON.stringify({
      request_type_id: p.typeId,
      submitted_by: p.pm.id,
      status: 'pending',
      target_kind: 'team',
      target_team_id: p.teams.MEDIA,
      data: { title: 'PM sync', meeting_type: 'online', proposed_start: at(16) },
    }),
  });
  check('a Project Manager can propose a meeting', allowed(byPm), JSON.stringify(byPm.body));
  const { rows: pmParty } = await db.query(
    `select proposer_party from meeting_details where request_id = $1`,
    [byPm.body?.[0]?.id],
  );
  check(
    'and is booked as their one project',
    pmParty[0]?.proposer_party === `project:${p.projectId}`,
    JSON.stringify(pmParty),
  );

  // --- Nothing is queued for a person with no device --------------------------

  await db.query(`delete from push_subscriptions where member_id = $1`, [p.media2.id]);
  const countBefore = (await outboxFor(p.media2.id)).length;
  await rest(p.pm.token, 'requests', {
    method: 'POST',
    body: JSON.stringify({
      request_type_id: p.typeId,
      submitted_by: p.pm.id,
      status: 'pending',
      target_kind: 'team',
      target_team_id: p.teams.MEDIA,
      data: { title: 'Second sync', meeting_type: 'online', proposed_start: at(15) },
    }),
  });
  check(
    'a person with no device gets no outbox rows',
    (await outboxFor(p.media2.id)).length === countBefore,
  );
  check(
    'while the one with a device still does',
    (await outboxFor(p.media1.id))[0]?.kind === 'request_submitted',
  );
}

await db.connect();
try {
  console.log('Cleaning up any previous run…');
  await cleanUp();
  console.log('Seeding…');
  const people = await seed();
  console.log('Running…');
  await run(people);
} finally {
  console.log('Cleaning up…');
  await cleanUp().catch((e) => console.error('cleanup failed', e));
  await db.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
