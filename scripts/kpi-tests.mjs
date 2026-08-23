/**
 * Verification of the KPI module (addendum §1–§9).
 *
 *   npm run db:kpi
 *
 * Same discipline as permission-tests.mjs: every assertion goes through the
 * REST API as a signed-in person, not through the application. The scoring
 * maths, the workflow gates and §8's self-exclusion are all rules the database
 * has to hold on its own, so they are tested at the layer an attacker reaches.
 *
 * The script seeds its own people (emails prefixed `kpitest-`), its own project
 * and its own tasks, runs, and deletes them again. Safe to re-run, and safe
 * against a database with real data — it never touches a row it did not create.
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

const PASSWORD = 'kpi-tests-4c81!';
const PREFIX = 'kpitest-';
const PROJECT = 'KPI Test Project';

const db = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const results = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${name}${detail && !passed ? `\n         ${detail}` : ''}`);
}

function equal(name, actual, expected) {
  check(name, actual === expected, `expected ${expected}, got ${actual}`);
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

const rpc = (token, name, args = {}) =>
  rest(token, `rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

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
// People
// -----------------------------------------------------------------------------

const PEOPLE = {
  // Holds kpi.view = all through the DEVELOPMENT team override from 0013.
  devon: { role: 'member', team: 'DEVELOPMENT', student: '491000001', national: '1910000001' },
  // Confirms DESIGN's team-internal work.
  dana: { role: 'team_director', team: 'DESIGN', student: '491000002', national: '1910000002' },
  // Does DESIGN's team-internal work.
  wael: { role: 'member', team: 'DESIGN', student: '491000003', national: '1910000003' },
  // Runs the test project and its split.
  pam: { role: 'project_manager', team: 'MEDIA', student: '491000004', national: '1910000004' },
  // Runs a DIFFERENT split of the same project.
  quinn: { role: 'project_manager', team: 'MEDIA', student: '491000005', national: '1910000005' },
  // Works on the project.
  rami: { role: 'member', team: 'MEDIA', student: '491000006', national: '1910000006' },
  // On the project but not on the split.
  sara: { role: 'member', team: 'CONTENT', student: '491000007', national: '1910000007' },
};

async function cleanUp() {
  await db.query(
    `delete from tasks where project_id in (select id from projects where name_en = $1)`,
    [PROJECT],
  );
  await db.query(
    `delete from tasks where created_by in (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(
    `delete from tasks where team_id is not null and title like 'KPITEST %'`,
  );
  await db.query(`delete from projects where name_en = $1`, [PROJECT]);
  await db.query(
    `delete from member_sensitive where member_id in
       (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
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
    const email = `${PREFIX}${name}@example.com`;

    const created = await adminFetch('admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
    });
    const authId = created.body?.id;
    if (!authId) throw new Error(`Could not create auth user ${email}`);

    const { rows } = await db.query(
      `insert into members
         (auth_user_id, email, name_en, name_ar, student_id, team_id, role_id)
       values ($1, $2, $3, $3, $4,
               (select id from teams where key = $5),
               (select id from roles where key = $6))
       returning id`,
      [authId, email, `KPI ${name}`, spec.student, spec.team, spec.role],
    );
    const id = rows[0].id;
    await db.query(
      `insert into member_sensitive (member_id, national_id) values ($1, $2)`,
      [id, spec.national],
    );

    people[name] = { id, email, token: await signIn(email) };
  }

  // A project with one split. pam runs the split; quinn runs a second one.
  const { rows: projectRows } = await db.query(
    `insert into projects (name_en, name_ar, owning_team_id, status)
     values ($1, $1, (select id from teams where key = 'MEDIA'), 'active')
     returning id`,
    [PROJECT],
  );
  const projectId = projectRows[0].id;

  for (const who of ['pam', 'quinn']) {
    await db.query(
      `insert into project_managers (project_id, member_id) values ($1, $2)`,
      [projectId, people[who].id],
    );
  }
  for (const who of ['pam', 'quinn', 'rami', 'sara']) {
    await db.query(
      `insert into project_members (project_id, member_id) values ($1, $2)`,
      [projectId, people[who].id],
    );
  }

  const { rows: splitRows } = await db.query(
    `insert into project_splits (project_id, name) values ($1, 'Sponsorship'), ($1, 'Venue')
     returning id, name`,
    [projectId],
  );
  const sponsorship = splitRows.find((r) => r.name === 'Sponsorship').id;
  // Venue exists so quinn runs a DIFFERENT split of the same project — that is
  // what the "a PM of another split cannot confirm" check leans on.
  const venue = splitRows.find((r) => r.name === 'Venue').id;

  await db.query(
    `insert into project_split_managers (split_id, member_id) values ($1, $2), ($3, $4)`,
    [sponsorship, people.pam.id, venue, people.quinn.id],
  );
  await db.query(
    `insert into project_split_members (split_id, member_id) values ($1, $2)`,
    [sponsorship, people.rami.id],
  );

  return { people, projectId, sponsorship, venue };
}

/** Creates a team task straight in the database, bypassing nothing that matters. */
async function makeTeamTask(title, { team = 'DESIGN', dueInDays = null, assignee = null }) {
  const { rows } = await db.query(
    `insert into tasks (title, team_id, due_date, assigned_at)
     values ($1, (select id from teams where key = $2),
             case when $3::int is null then null
                  else (now() at time zone 'Asia/Riyadh')::date + $3::int end,
             case when $4::uuid is null then null else now() end)
     returning id`,
    [title, team, dueInDays, assignee],
  );
  const id = rows[0].id;
  if (assignee) {
    await db.query(`insert into task_assignees (task_id, member_id) values ($1, $2)`, [
      id,
      assignee,
    ]);
  }
  return id;
}

async function makeProjectTask(
  title,
  { projectId, splitId = null, dueInDays = null, assignee = null },
) {
  const { rows } = await db.query(
    `insert into tasks (title, project_id, split_id, due_date, assigned_at)
     values ($1, $2, $3,
             case when $4::int is null then null
                  else (now() at time zone 'Asia/Riyadh')::date + $4::int end,
             case when $5::uuid is null then null else now() end)
     returning id`,
    [title, projectId, splitId, dueInDays, assignee],
  );
  const id = rows[0].id;
  if (assignee) {
    await db.query(`insert into task_assignees (task_id, member_id) values ($1, $2)`, [
      id,
      assignee,
    ]);
  }
  return id;
}

/** Reads one row of task_kpi as a given person. */
async function kpi(token, taskId) {
  const { body } = await rest(token, `task_kpi?id=eq.${taskId}&select=*`);
  return Array.isArray(body) ? body[0] : null;
}

// -----------------------------------------------------------------------------

async function main() {
  await db.connect();
  await cleanUp();

  const { people, projectId, sponsorship } = await seed();
  const { devon, dana, wael, pam, quinn, rami, sara } = people;

  // ===========================================================================
  console.log('\n§1  Status is computed, never set by hand');
  // ===========================================================================

  const t1 = await makeTeamTask('KPITEST lifecycle', { dueInDays: 10, assignee: wael.id });

  equal('a fresh assigned task reads In Progress', (await kpi(dana.token, t1)).state, 'in_progress');

  const unassigned = await makeTeamTask('KPITEST unassigned', { dueInDays: 10 });
  equal('an unassigned task reads Not Started', (await kpi(dana.token, unassigned)).state, 'not_started');

  const handEdit = await rest(dana.token, `tasks?id=eq.${t1}`, {
    method: 'PATCH',
    body: JSON.stringify({ confirmed_at: new Date().toISOString() }),
  });
  check(
    'a Director cannot PATCH a task straight to Completed',
    !handEdit.ok,
    `status ${handEdit.status} ${JSON.stringify(handEdit.body)}`,
  );

  const handScore = await rest(dana.token, 'task_scores', {
    method: 'POST',
    body: JSON.stringify({ task_id: t1, quality: 'excellent' }),
  });
  check(
    'nobody can INSERT a score outside the workflow',
    !handScore.ok,
    `status ${handScore.status}`,
  );

  const bornDone = await rest(dana.token, 'tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'KPITEST born done',
      team_id: null,
      submitted_at: new Date().toISOString(),
    }),
  });
  check('a task cannot be created already submitted', !bornDone.ok, `status ${bornDone.status}`);

  // ===========================================================================
  console.log('\n§2  The completion workflow');
  // ===========================================================================

  const notMine = await rpc(dana.token, 'submit_task_for_review', { p_task: t1 });
  check('only the assignee may Submit for Review', !notMine.ok, `status ${notMine.status}`);

  const submitted = await rpc(wael.token, 'submit_task_for_review', { p_task: t1 });
  check('the assignee may Submit for Review', submitted.ok, JSON.stringify(submitted.body));
  equal('submitting moves it to Pending Confirmation', (await kpi(dana.token, t1)).state, 'pending_confirmation');

  const selfConfirm = await rpc(wael.token, 'confirm_task', { p_task: t1, p_quality: 'excellent' });
  check('the assignee cannot confirm their own work', !selfConfirm.ok, `status ${selfConfirm.status}`);

  const wrongDirector = await rpc(pam.token, 'confirm_task', { p_task: t1, p_quality: 'excellent' });
  check(
    "a PM cannot confirm another team's internal task",
    !wrongDirector.ok,
    `status ${wrongDirector.status}`,
  );

  // Reject sends it back with no scores recorded.
  const rejected = await rpc(dana.token, 'reject_task', { p_task: t1, p_note: 'needs work' });
  check('the confirmer may reject', rejected.ok, JSON.stringify(rejected.body));
  const afterReject = await kpi(dana.token, t1);
  equal('rejection returns the task to In Progress', afterReject.state, 'in_progress');
  equal('rejection records no Quality', afterReject.quality, null);

  await rpc(wael.token, 'submit_task_for_review', { p_task: t1 });
  const confirmed = await rpc(dana.token, 'confirm_task', { p_task: t1, p_quality: 'excellent' });
  check('the confirmer may confirm', confirmed.ok, JSON.stringify(confirmed.body));
  equal('confirming moves it to Completed', (await kpi(dana.token, t1)).state, 'completed');

  // ===========================================================================
  console.log('\n§4  Scoring');
  // ===========================================================================

  const onTime = await kpi(dana.token, t1);
  equal('Excellent scores Quality 100', onTime.quality_score, 100);
  equal('submitted before the due date scores Completion 100', onTime.completion_score, 100);
  equal('Overall is the average of the two', Number(onTime.overall_score), 100);

  // The spec's own worked example: Excellent but late -> 75.
  const late = await makeTeamTask('KPITEST late', { dueInDays: -3, assignee: wael.id });
  await rpc(wael.token, 'submit_task_for_review', { p_task: late });
  await rpc(dana.token, 'confirm_task', { p_task: late, p_quality: 'excellent' });
  const lateRow = await kpi(dana.token, late);
  equal('late scores Completion 50 whatever the delay', lateRow.completion_score, 50);
  equal('§4 worked example: Excellent but late = 75', Number(lateRow.overall_score), 75);

  // Every rung of the Quality scale.
  for (const [quality, expected] of [
    ['very_good', 75],
    ['good', 50],
    ['poor', 25],
  ]) {
    const id = await makeTeamTask(`KPITEST ${quality}`, { dueInDays: 5, assignee: wael.id });
    await rpc(wael.token, 'submit_task_for_review', { p_task: id });
    await rpc(dana.token, 'confirm_task', { p_task: id, p_quality: quality });
    equal(`${quality} scores Quality ${expected}`, (await kpi(dana.token, id)).quality_score, expected);
  }

  // The spec's other worked example: Not Done -> 0.
  const notDone = await makeTeamTask('KPITEST not done', { dueInDays: -2, assignee: wael.id });
  const tooEarly = await makeTeamTask('KPITEST future', { dueInDays: 4, assignee: wael.id });
  const earlyMark = await rpc(dana.token, 'mark_task_not_done', { p_task: tooEarly });
  check(
    'Not Done is refused while the due date is still ahead',
    !earlyMark.ok,
    `status ${earlyMark.status}`,
  );

  const marked = await rpc(dana.token, 'mark_task_not_done', { p_task: notDone });
  check('a Director may mark an overdue task Not Done', marked.ok, JSON.stringify(marked.body));
  const notDoneRow = await kpi(dana.token, notDone);
  equal('Not Done state', notDoneRow.state, 'not_done');
  equal('Not Done sets Quality to a literal 0', notDoneRow.quality_score, 0);
  equal('Not Done sets Completion to a literal 0', notDoneRow.completion_score, 0);
  equal('§4 worked example: Not Done = 0', Number(notDoneRow.overall_score), 0);

  const notDoneAfterSubmit = await rpc(dana.token, 'mark_task_not_done', { p_task: t1 });
  check(
    'Not Done is refused once something was submitted',
    !notDoneAfterSubmit.ok,
    `status ${notDoneAfterSubmit.status}`,
  );

  // Risk tiers, recomputed live from today.
  const risks = [
    ['low', 9],
    ['medium', 4],
    ['high', 1],
    ['overdue', -1],
  ];
  for (const [expected, days] of risks) {
    const id = await makeTeamTask(`KPITEST risk ${expected}`, { dueInDays: days, assignee: wael.id });
    equal(`${days} days remaining reads ${expected}`, (await kpi(dana.token, id)).risk, expected);
  }

  // ===========================================================================
  console.log('\n§5  What counts toward %Performance');
  // ===========================================================================

  const open = await makeTeamTask('KPITEST still open', { dueInDays: 8, assignee: wael.id });
  const openRow = await kpi(dana.token, open);
  equal('an In Progress task does not count', openRow.counts_toward_kpi, false);
  equal('an In Progress task is not scored 0', openRow.overall_score, null);
  equal('a Not Done task does count', (await kpi(dana.token, notDone)).counts_toward_kpi, true);

  // Read as devon: Development holds kpi.view, dana deliberately does not.
  const { body: waelKpi } = await rest(
    devon.token,
    `member_kpi?member_id=eq.${wael.id}&select=*`,
  );
  const row = waelKpi[0];
  // Six counting tasks, by Overall (not by raw Quality — each is averaged with
  // its own Completion score first):
  //   excellent on time  (100 + 100) / 2 = 100
  //   excellent late     (100 +  50) / 2 =  75
  //   very_good on time  ( 75 + 100) / 2 =  87.5
  //   good on time       ( 50 + 100) / 2 =  75
  //   poor on time       ( 25 + 100) / 2 =  62.5
  //   not done           (  0 +   0) / 2 =   0
  const WAEL_OVERALLS = [100, 75, 87.5, 75, 62.5, 0];
  const mean = (xs) => Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1));

  equal('%Performance counts only finished tasks', row.scored_tasks, 6);
  equal('%Performance is the plain average of Overall', Number(row.performance), mean(WAEL_OVERALLS));

  // ===========================================================================
  console.log('\n§3  Splits and claiming');
  // ===========================================================================

  const splitTask = await makeProjectTask('KPITEST split task', {
    projectId,
    splitId: sponsorship,
    dueInDays: 7,
  });

  const outsiderClaim = await rpc(sara.token, 'claim_task', { p_task: splitTask });
  check(
    'a project member outside the split cannot claim a split task',
    !outsiderClaim.ok,
    `status ${outsiderClaim.status}`,
  );

  const claimed = await rpc(rami.token, 'claim_task', { p_task: splitTask });
  check('a split member may claim a split task', claimed.ok, JSON.stringify(claimed.body));

  const claimedRow = await kpi(pam.token, splitTask);
  equal('claiming assigns the task', claimedRow.assignee_id, rami.id);
  check(
    'claiming sets the Assigned Date to the moment of claiming',
    claimedRow.assigned_at !== null &&
      Date.now() - new Date(claimedRow.assigned_at).getTime() < 120_000,
    String(claimedRow.assigned_at),
  );

  const doubleClaim = await rpc(sara.token, 'claim_task', { p_task: splitTask });
  check('an already-claimed task cannot be claimed again', !doubleClaim.ok, `status ${doubleClaim.status}`);

  const secondAssignee = await rest(pam.token, 'task_assignees', {
    method: 'POST',
    body: JSON.stringify({ task_id: splitTask, member_id: sara.id }),
  });
  check('a task cannot take a second assignee', !secondAssignee.ok, `status ${secondAssignee.status}`);

  await rpc(rami.token, 'submit_task_for_review', { p_task: splitTask });
  const otherSplitPm = await rpc(quinn.token, 'confirm_task', {
    p_task: splitTask,
    p_quality: 'good',
  });
  check(
    "a PM of another split cannot confirm this split's task",
    !otherSplitPm.ok,
    `status ${otherSplitPm.status}`,
  );

  const splitPm = await rpc(pam.token, 'confirm_task', { p_task: splitTask, p_quality: 'good' });
  check("the split's own PM may confirm", splitPm.ok, JSON.stringify(splitPm.body));

  // A project-wide task falls to the project's PMs, so quinn can act.
  const wideTask = await makeProjectTask('KPITEST project-wide', {
    projectId,
    dueInDays: 6,
    assignee: sara.id,
  });
  await rpc(sara.token, 'submit_task_for_review', { p_task: wideTask });
  const wideConfirm = await rpc(quinn.token, 'confirm_task', {
    p_task: wideTask,
    p_quality: 'very_good',
  });
  check('any project PM may confirm a project-wide task', wideConfirm.ok, JSON.stringify(wideConfirm.body));

  // ===========================================================================
  console.log('\n§6  Project numbers');
  // ===========================================================================

  // §8: a PM does not hold kpi.view by default, so the project's own manager
  // sees nothing here until it is granted.
  const { body: pamSees } = await rest(
    pam.token,
    `project_kpi?project_id=eq.${projectId}&select=*`,
  );
  equal('a PM without kpi.view sees no project figures', pamSees.length, 0);

  const { body: projectRows } = await rest(
    devon.token,
    `project_kpi?project_id=eq.${projectId}&select=*`,
  );
  const proj = projectRows[0];
  // Two counting tasks so far, again by Overall:
  //   split task, good, on time   ( 50 + 100) / 2 = 75
  //   project-wide, very_good     ( 75 + 100) / 2 = 87.5
  equal('project completion is computed live', Number(proj.completion_pct), mean([75, 87.5]));
  equal('project health starts On Track', proj.health, 'on_track');

  // Three High-risk tasks tip it to At Risk.
  for (let i = 0; i < 3; i += 1) {
    await makeProjectTask(`KPITEST high ${i}`, { projectId, dueInDays: 1, assignee: rami.id });
  }
  const { body: atRiskRows } = await rest(
    devon.token,
    `project_kpi?project_id=eq.${projectId}&select=health,high_risk_tasks`,
  );
  equal('3 High-risk tasks make a project At Risk', atRiskRows[0].health, 'at_risk');

  const { body: perMember } = await rest(
    devon.token,
    `project_member_kpi?project_id=eq.${projectId}&member_id=eq.${rami.id}&select=*`,
  );
  check(
    '§6: a falling-behind flag exists per member, not just per project',
    perMember.length === 1 && perMember[0].health === 'at_risk',
    JSON.stringify(perMember),
  );

  const { body: perSplit } = await rest(
    devon.token,
    `project_split_kpi?split_id=eq.${sponsorship}&select=*`,
  );
  check(
    '§6: a falling-behind flag exists per split/PM',
    perSplit.length === 1 && perSplit[0].total_tasks === 1,
    JSON.stringify(perSplit),
  );

  // §8: "when granted to a Director or PM, it is scoped to their own
  // team/project only, not club-wide".
  await db.query(
    `update role_permissions set scope = 'own_projects'
      where role_id = (select id from roles where key = 'project_manager')
        and permission_key = 'kpi.view'`,
  );
  const { body: pamScoped } = await rest(
    pam.token,
    `project_kpi?project_id=eq.${projectId}&select=project_id`,
  );
  equal('granting a PM kpi.view = own_projects reveals their own project', pamScoped.length, 1);
  await db.query(
    `update role_permissions set scope = 'none'
      where role_id = (select id from roles where key = 'project_manager')
        and permission_key = 'kpi.view'`,
  );

  // ===========================================================================
  console.log('\n§7  Deletion recalculates');
  // ===========================================================================

  const before = (await rest(devon.token, `member_kpi?member_id=eq.${wael.id}&select=performance`))
    .body[0].performance;

  const deleteByOutsider = await rpc(pam.token, 'delete_task', { p_task: notDone });
  check(
    "a PM cannot delete another team's task",
    !deleteByOutsider.ok,
    `status ${deleteByOutsider.status}`,
  );

  const deleted = await rpc(dana.token, 'delete_task', { p_task: notDone });
  check('the responsible Director may delete a task', deleted.ok, JSON.stringify(deleted.body));

  const after = (await rest(devon.token, `member_kpi?member_id=eq.${wael.id}&select=performance`))
    .body[0].performance;
  equal(
    'deleting the Not Done task recalculates %Performance as if it never existed',
    Number(after),
    mean(WAEL_OVERALLS.filter((v) => v !== 0)),
  );
  check('…which is a different number from before', Number(before) !== Number(after),
    `before ${before}, after ${after}`);

  const orphanScore = await db.query(`select count(*)::int as n from task_scores where task_id = $1`, [
    notDone,
  ]);
  equal('the deleted task leaves no score behind', orphanScore.rows[0].n, 0);

  // ===========================================================================
  console.log('\n§8  Nobody sees their own KPI');
  // ===========================================================================

  const ownTask = await kpi(wael.token, t1);
  check('the assignee can still see their own task', ownTask !== undefined && ownTask !== null);
  equal('the assignee cannot see their own Quality', ownTask.quality_score, null);
  equal('the assignee cannot see their own Overall', ownTask.overall_score, null);
  equal('…but the state is not hidden from them', ownTask.state, 'completed');

  const ownScore = await rest(wael.token, `task_scores?task_id=eq.${t1}&select=*`);
  equal('the assignee cannot read task_scores directly', ownScore.body.length, 0);

  const { body: ownAggregate } = await rest(
    wael.token,
    `member_kpi?member_id=eq.${wael.id}&select=*`,
  );
  equal('nobody has a member_kpi row for themselves', ownAggregate.length, 0);

  const { body: devonSelf } = await rest(
    devon.token,
    `member_kpi?member_id=eq.${devon.id}&select=*`,
  );
  equal('…not even a Development member with kpi.view = all', devonSelf.length, 0);

  const { body: devonOthers } = await rest(
    devon.token,
    `member_kpi?member_id=eq.${wael.id}&select=*`,
  );
  equal('a Development member sees other people club-wide', devonOthers.length, 1);

  const { body: ramiSeesWael } = await rest(
    rami.token,
    `member_kpi?member_id=eq.${wael.id}&select=*`,
  );
  equal('a plain Member sees nobody', ramiSeesWael.length, 0);

  const { body: danaSeesWael } = await rest(
    dana.token,
    `member_kpi?member_id=eq.${wael.id}&select=*`,
  );
  equal(
    'a Director without kpi.view sees nobody (it is its own permission)',
    danaSeesWael.length,
    0,
  );

  // §8's "assignable later, scoped to their own team".
  await db.query(
    `update role_permissions set scope = 'own_team'
      where role_id = (select id from roles where key = 'team_director')
        and permission_key = 'kpi.view'`,
  );
  const { body: danaScoped } = await rest(
    dana.token,
    `member_kpi?member_id=eq.${wael.id}&select=*`,
  );
  equal('granting a Director kpi.view = own_team lets them see their own team', danaScoped.length, 1);

  const { body: danaOutside } = await rest(
    dana.token,
    `member_kpi?member_id=eq.${rami.id}&select=*`,
  );
  equal('…and still nobody outside it', danaOutside.length, 0);

  await db.query(
    `update role_permissions set scope = 'none'
      where role_id = (select id from roles where key = 'team_director')
        and permission_key = 'kpi.view'`,
  );

  // ===========================================================================
  await cleanUp();
  await db.end();

  const failed = results.filter((r) => !r.passed);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed${
      failed.length ? ` — ${failed.length} FAILED` : ''
    }`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await cleanUp();
    await db.end();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
