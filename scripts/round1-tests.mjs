/**
 * Verification of the first testing round's fixes (0057).
 *
 *   npm run db:round1
 *
 * Same discipline as the other suites: every "may / may not" goes through
 * the REST API as a signed-in person, because that is the layer a bypassed
 * UI reaches. Setup and the data-shape checks use the service role.
 *
 * Seeds its own people (`round1-`), one project and a few tasks, then
 * removes them all.
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

const PASSWORD = 'round1-tests-9b1d!';
const PREFIX = 'round1-';
const TAG = 'round1 ';

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

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
  design: { role: 'team_director', team: 'DESIGN', student: '494000001', national: '1940000001' },
  media: { role: 'team_director', team: 'MEDIA', student: '494000002', national: '1940000002' },
  member: { role: 'member', team: 'DESIGN', student: '494000003', national: '1940000003' },
  member2: { role: 'member', team: 'DESIGN', student: '494000004', national: '1940000004' },
  pm: { role: 'project_manager', team: 'CLUB_MGMT', student: '494000005', national: '1940000005' },
  pres: { role: 'president', team: 'CLUB_MGMT', student: '494000006', national: '1940000006' },
};

async function cleanUp() {
  await db.query(`delete from team_posts where title like $1`, [`${TAG}%`]);
  await db.query(`delete from calendar_entries where title like $1`, [`${TAG}%`]);
  await db.query(`delete from tasks where title like $1`, [`${TAG}%`]);
  await db.query(`delete from projects where name_en like $1`, [`${TAG}%`]);
  await db.query(
    `delete from requests where submitted_by in (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(
    `delete from member_sensitive where member_id in (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(`delete from members where email like $1`, [`${PREFIX}%`]);
  const { body } = await adminFetch('admin/users?per_page=200');
  for (const user of body?.users ?? []) {
    if (user.email?.startsWith(PREFIX)) await adminFetch(`admin/users/${user.id}`, { method: 'DELETE' });
  }
}

async function seed() {
  const p = {};
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
    // A device each, so the outbox has somebody to write for. Never contacted.
    await db.query(
      `insert into push_subscriptions (member_id, endpoint, p256dh, auth, locale)
       values ($1, $2, 'p256dh', 'auth', 'en')`,
      [rows[0].id, `https://push.example.test/${PREFIX}${name}`],
    );
    p[name] = { id: rows[0].id, email, token: await signIn(email) };
  }
  const { rows: t } = await db.query(`select key, id from teams where key in ('DESIGN','MEDIA')`);
  p.teams = Object.fromEntries(t.map((r) => [r.key, r.id]));
  p.meetingType = (await db.query(`select id from request_types where key = 'meeting_request'`)).rows[0].id;

  const { rows: project } = await db.query(
    `insert into projects (name_en, name_ar, owning_team_id, created_by)
     values ($1, $1, $2, $3) returning id`,
    [`${TAG}project`, p.teams.DESIGN, p.pres.id],
  );
  p.projectId = project[0].id;
  await db.query(`insert into project_managers (project_id, member_id) values ($1, $2)`, [p.projectId, p.pm.id]);
  await db.query(`insert into project_members (project_id, member_id) values ($1, $2), ($1, $3)`, [
    p.projectId,
    p.member.id,
    p.member2.id,
  ]);
  return p;
}

async function run(p) {
  const day = new Date();
  day.setDate(day.getDate() + 3);
  const at = (hour) => `${day.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00+03:00`;
  const meeting = (who, target, extra = {}) =>
    rest(who.token, 'requests', {
      method: 'POST',
      body: JSON.stringify({
        request_type_id: p.meetingType,
        submitted_by: who.id,
        status: 'pending',
        ...target,
        data: { title: `${TAG}sync`, meeting_type: 'online', proposed_start: at(14), duration_minutes: '30', ...extra },
      }),
    });

  // --- C. Who may ask for a meeting ------------------------------------------
  const byMember = await meeting(p.member, { target_kind: 'team', target_team_id: p.teams.MEDIA });
  check('a Member cannot submit a meeting request', !byMember.ok, JSON.stringify(byMember.body));
  const byDirector = await meeting(p.design, { target_kind: 'individual', target_member_id: p.media.id });
  check('a Director can', allowed(byDirector), JSON.stringify(byDirector.body));
  const toPerson = byDirector.body?.[0]?.id;

  // --- The person a meeting is aimed at can act on it -------------------------
  const acted = await rpc(p.media.token, 'transition_request', {
    p_request: toPerson, p_to_status: 'under_review', p_note: null, p_patch: {},
  });
  check('the person it is aimed at can act on it', acted.ok, JSON.stringify(acted.body));
  const other = await rpc(p.pm.token, 'transition_request', {
    p_request: toPerson, p_to_status: 'approved', p_note: null, p_patch: {},
  });
  check('nobody else can', !other.ok);

  // --- D. Start + duration -------------------------------------------------------
  const { rows: span } = await db.query(
    `select extract(epoch from (app.meeting_end(data) - app.meeting_start(data)))/60 as minutes,
            data ? 'proposed_end' as has_end
       from requests where id = $1`,
    [toPerson],
  );
  check('the meeting ends 30 minutes after it starts, with no end typed', Number(span[0].minutes) === 30 && !span[0].has_end, JSON.stringify(span));
  const { rows: fields } = await db.query(
    `select (field_schema @> '[{"key":"duration_minutes"}]') as has_duration,
            (field_schema @> '[{"key":"proposed_end"}]') as has_end,
            (field_schema @> '[{"key":"proposed_start","no_past":true}]') as no_past
       from request_types where key = 'meeting_request'`,
  );
  check('the form asks for a duration, not an end, and marks the start no-past',
    fields[0].has_duration && !fields[0].has_end && fields[0].no_past, JSON.stringify(fields[0]));
  const { rows: legacy } = await db.query(
    `select extract(epoch from (app.meeting_end($1::jsonb) - app.meeting_start($1::jsonb)))/60 as minutes`,
    [JSON.stringify({ proposed_start: at(10), proposed_end: at(12) })],
  );
  check('an in-flight request that still carries an end is honoured', Number(legacy[0].minutes) === 120);

  // --- B. Directors do not run projects -------------------------------------------
  const projByDirector = await rest(p.design.token, 'projects', {
    method: 'POST',
    body: JSON.stringify({ name_en: `${TAG}by director`, name_ar: 'x', owning_team_id: p.teams.DESIGN, created_by: p.design.id }),
  });
  check('a Director cannot create a project', !projByDirector.ok, JSON.stringify(projByDirector.body));
  const projByPres = await rest(p.pres.token, 'projects', {
    method: 'POST',
    body: JSON.stringify({ name_en: `${TAG}by president`, name_ar: 'x', owning_team_id: p.teams.DESIGN, created_by: p.pres.id }),
  });
  check('the President can', allowed(projByPres), JSON.stringify(projByPres.body));
  const splitByPm = await rest(p.pm.token, 'project_splits', {
    method: 'POST',
    body: JSON.stringify({ project_id: p.projectId, name: `${TAG}split`, created_by: p.pm.id }),
  });
  check('a Project Manager can add a split to their project', allowed(splitByPm), JSON.stringify(splitByPm.body));

  // --- A. Directors see their own team's tasks ------------------------------------
  const designTask = await rest(p.design.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `${TAG}design task`, team_id: p.teams.DESIGN, created_by: p.design.id }),
  });
  check('a Director can create a task for their team', allowed(designTask), JSON.stringify(designTask.body));
  const designTaskId = designTask.body?.[0]?.id;
  const mediaTask = await rest(p.media.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `${TAG}media task`, team_id: p.teams.MEDIA, created_by: p.media.id }),
  });
  const mediaSees = await rest(p.media.token, `task_kpi?select=id,title&title=like.${encodeURIComponent(TAG + '%')}`);
  check("a Director does not see another team's task",
    mediaSees.ok && !mediaSees.body.some((t) => t.id === designTaskId), JSON.stringify(mediaSees.body));
  check('but does see their own', mediaSees.body.some((t) => t.id === mediaTask.body?.[0]?.id));
  const otherTeam = await rest(p.design.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `${TAG}wrong team`, team_id: p.teams.MEDIA, created_by: p.design.id }),
  });
  check("a Director cannot create a task for another team", !otherTeam.ok);

  // 0060: a Project Manager sees their projects' tasks, not the club's.
  const pmSees = await rest(p.pm.token, `task_kpi?select=id&title=like.${encodeURIComponent(TAG + '%')}`);
  check("a Project Manager does not see a team's internal task",
    pmSees.ok && !pmSees.body.some((t) => t.id === designTaskId), JSON.stringify(pmSees.body));

  // --- F. A PM is offered their project's members --------------------------------
  const offered = await rest(p.pm.token, 'assignable_members?select=id');
  check('a Project Manager is offered the members of their project',
    offered.ok && offered.body.some((m) => m.id === p.member.id) && offered.body.some((m) => m.id === p.member2.id),
    JSON.stringify(offered.body));

  // --- E. Two people on one task ---------------------------------------------------
  const shared = await rest(p.pm.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `${TAG}shared`, project_id: p.projectId, created_by: p.pm.id, assigned_at: new Date().toISOString() }),
  });
  const sharedId = shared.body?.[0]?.id;
  const bothAssigned = await rest(p.pm.token, 'task_assignees', {
    method: 'POST',
    body: JSON.stringify([{ task_id: sharedId, member_id: p.member.id }, { task_id: sharedId, member_id: p.member2.id }]),
  });
  check('a task can be given to two people', bothAssigned.ok && bothAssigned.body?.length === 2, JSON.stringify(bothAssigned.body));
  const rows = await rest(p.pm.token, `task_kpi?select=id,assignee_id&id=eq.${sharedId}`);
  check('task_kpi carries one row per person on it', rows.ok && rows.body.length === 2, JSON.stringify(rows.body));
  const projectKpi = await rest(p.pres.token, `project_kpi?select=total_tasks&project_id=eq.${p.projectId}`);
  check('the project counts it once', projectKpi.ok && Number(projectKpi.body?.[0]?.total_tasks) === 1, JSON.stringify(projectKpi.body));
  const mine = await rest(p.member2.token, `task_kpi?select=id,assignee_id&id=eq.${sharedId}`);
  check('the second person sees it as theirs',
    mine.ok && mine.body.some((r) => r.assignee_id === p.member2.id), JSON.stringify(mine.body));

  // --- E. Self-exclusion covers every assignee ------------------------------------
  // A Director on their own team's task, listed SECOND — the 0012 check looked
  // only at the first assignee, so this Director could confirm their own work.
  const selfTask = await rest(p.design.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `${TAG}self`, team_id: p.teams.DESIGN, created_by: p.design.id, assigned_at: new Date().toISOString() }),
  });
  const selfId = selfTask.body?.[0]?.id;
  await rest(p.design.token, 'task_assignees', {
    method: 'POST',
    body: JSON.stringify([{ task_id: selfId, member_id: p.member.id }, { task_id: selfId, member_id: p.design.id }]),
  });
  const submitted = await rpc(p.member.token, 'submit_task_for_review', { p_task: selfId });
  check('an assignee can submit it', submitted.ok, JSON.stringify(submitted.body));
  const selfConfirm = await rpc(p.design.token, 'confirm_task', { p_task: selfId, p_quality: 'good' });
  check('a Director who is also on the task cannot confirm it', !selfConfirm.ok, JSON.stringify(selfConfirm.body));
  const presConfirm = await rpc(p.pres.token, 'confirm_task', { p_task: selfId, p_quality: 'good' });
  check('the President can', presConfirm.ok, JSON.stringify(presConfirm.body));

  // --- 0058 A. An announcement reaches the team -------------------------------------
  const post = await rest(p.design.token, 'team_posts', {
    method: 'POST',
    body: JSON.stringify({ team_id: p.teams.DESIGN, author_id: p.design.id, title: `${TAG}post`, body: 'Meeting moved to Sunday.' }),
  });
  check('a Director can announce to their team', allowed(post), JSON.stringify(post.body));
  const told = async (id) => (await db.query(
    `select count(*)::int n from notification_outbox where member_id = $1 and kind = 'team_post'`, [id])).rows[0].n;
  check('every member of the team is told', (await told(p.member.id)) === 1 && (await told(p.member2.id)) === 1);
  check('the author is not', (await told(p.design.id)) === 0);
  check('another team is not', (await told(p.media.id)) === 0);
  const elsewhere = await rest(p.design.token, 'team_posts', {
    method: 'POST',
    body: JSON.stringify({ team_id: p.teams.MEDIA, author_id: p.design.id, title: `${TAG}wrong`, body: 'x' }),
  });
  check("a Director cannot announce to another team", !elsewhere.ok);

  // --- 0058 B. A link and a comment either way ----------------------------------------
  const noted = await rest(p.pm.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `${TAG}noted`, project_id: p.projectId, created_by: p.pm.id, assigned_at: new Date().toISOString() }),
  });
  const notedId = noted.body?.[0]?.id;
  await rest(p.pm.token, 'task_assignees', { method: 'POST', body: JSON.stringify({ task_id: notedId, member_id: p.member.id }) });
  const submitNoted = await rpc(p.member.token, 'submit_task_for_review', {
    p_task: notedId, p_url: 'https://example.com/work', p_note: 'First draft, two variants.',
  });
  check('work is submitted with a link and a comment', submitNoted.ok, JSON.stringify(submitNoted.body));
  const confirmNoted = await rpc(p.pm.token, 'confirm_task', { p_task: notedId, p_quality: 'very_good', p_note: 'Variant B, please.' });
  check('and confirmed with a comment', confirmNoted.ok, JSON.stringify(confirmNoted.body));
  const { rows: notes } = await db.query(
    `select submission_url, submission_note, review_note from tasks where id = $1`, [notedId]);
  check('both comments are on the task',
    notes[0]?.submission_note === 'First draft, two variants.' && notes[0]?.review_note === 'Variant B, please.' && notes[0]?.submission_url === 'https://example.com/work',
    JSON.stringify(notes[0]));
  const sneaked = await rest(p.member.token, `tasks?id=eq.${notedId}`, {
    method: 'PATCH', body: JSON.stringify({ submission_note: 'edited after the fact' }),
  });
  check('a comment cannot be rewritten outside the workflow', !sneaked.ok || (Array.isArray(sneaked.body) && sneaked.body.length === 0), JSON.stringify(sneaked.body));

  // --- 0058 C. A calendar entry is the creator's to remove -------------------------------
  const { rows: entry } = await db.query(
    `insert into calendar_entries (kind, title, starts_at, ends_at, created_by, meeting_scope_kind, meeting_scope_team_id)
     values ('meeting', $1, now() + interval '1 day', now() + interval '1 day 1 hour', $2, 'team', $3) returning id`,
    [`${TAG}entry`, p.member.id, p.teams.DESIGN],
  );
  const delByDirector = await rest(p.design.token, `calendar_entries?id=eq.${entry[0].id}`, { method: 'DELETE' });
  check("a Director cannot delete another person's entry on their team's calendar",
    !delByDirector.ok || delByDirector.body?.length === 0, JSON.stringify(delByDirector.body));
  const delByCreator = await rest(p.member.token, `calendar_entries?id=eq.${entry[0].id}`, { method: 'DELETE' });
  check('the creator can', delByCreator.ok && delByCreator.body?.length === 1, JSON.stringify(delByCreator.body));

  // --- 0058 D. Names for Directors and Project Managers -----------------------------
  const { rows: dirScopes } = await db.query(
    `select r.key, rp.scope from role_permissions rp join roles r on r.id = rp.role_id
      where rp.permission_key = 'members.directory' and r.key in ('team_director','project_manager')`);
  check('Directors and PMs hold a names-only directory scope',
    dirScopes.find((r) => r.key === 'team_director')?.scope === 'own_team'
      && dirScopes.find((r) => r.key === 'project_manager')?.scope === 'own_projects',
    JSON.stringify(dirScopes));

  // --- G. Experience is in the past --------------------------------------------------
  const future = await db
    .query(
      `insert into member_experience (member_id, title, organization, started_on, ended_on)
       values ($1, $2, 'x', (now() at time zone 'Asia/Riyadh')::date + 1, null)`,
      [p.member.id, `${TAG}exp`],
    )
    .then(() => null)
    .catch((e) => e.message);
  check('experience cannot start tomorrow', String(future).includes('member_experience_not_future'), String(future));
  const today = await db
    .query(
      `insert into member_experience (member_id, title, organization, started_on, ended_on)
       values ($1, $2, 'x', (now() at time zone 'Asia/Riyadh')::date, (now() at time zone 'Asia/Riyadh')::date)`,
      [p.member.id, `${TAG}exp`],
    )
    .then(() => null)
    .catch((e) => e.message);
  check("today on the club's clock is fine", today === null, String(today));
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
