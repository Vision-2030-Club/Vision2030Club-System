/**
 * Verification of the project-component rules (migration 0062).
 *
 *   npm run db:components
 *
 * Talks to the CLUB database over the REST API as signed-in people, the way
 * the other suites do, and proves who may attach a component, who may add
 * organizers and HR people, and what `my_component_access()` answers for
 * each. Seeds its own people (`comptest-`) and its own project, and deletes
 * them again; nothing it touches is anyone else's.
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

const PASSWORD = 'component-tests-7d1c!';
const PREFIX = 'comptest-';

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

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

const rpc = (token, name, args = {}) =>
  rest(token, `rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
const refused = (r) => !r.ok || (Array.isArray(r.body) && r.body.length === 0);
const allowed = (r) => r.ok && Array.isArray(r.body) && r.body.length > 0;

async function signIn(email) {
  const response = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error(`Could not sign in as ${email}: ${JSON.stringify(body)}`);
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
  root: { role: 'super_admin', team: 'IT', student: '491000001', national: '1910000001' },
  pm: { role: 'project_manager', team: 'CLUB_MGMT', student: '491000002', national: '1910000002' },
  huda: { role: 'team_director', team: 'HR', student: '491000003', national: '1910000003' },
  dana: { role: 'team_director', team: 'DESIGN', student: '491000004', national: '1910000004' },
  alice: { role: 'member', team: 'IT', student: '491000005', national: '1910000005' },
  gina: { role: 'guest', team: 'PR', student: '491000006', national: '1910000006' },
};

async function cleanUp() {
  await db.query(`delete from projects where name_en like $1`, [`${PREFIX}%`]);
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
  const people = {};
  for (const [name, spec] of Object.entries(PEOPLE)) {
    const email = `${PREFIX}${name}@example.test`;
    const created = await adminFetch('admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
    });
    if (!created.ok) throw new Error(`Could not create ${email}: ${JSON.stringify(created.body)}`);
    const { rows } = await db.query(
      `insert into members (auth_user_id, email, name_en, name_ar, student_id, team_id, role_id)
       values ($1, $2, $3, $4, $5, (select id from teams where key = $6), (select id from roles where key = $7))
       returning id`,
      [created.body.id, email, name, name, spec.student, spec.team, spec.role],
    );
    await db.query(`insert into member_sensitive (member_id, national_id) values ($1, $2)`, [rows[0].id, spec.national]);
    people[name] = { id: rows[0].id, email, token: await signIn(email) };
  }

  const { rows } = await db.query(
    `insert into projects (name_en, name_ar, owning_team_id, created_by)
     values ($1, $2, (select id from teams where key = 'DESIGN'), $3) returning id`,
    [`${PREFIX}Mock Week`, `${PREFIX}أسبوع المقابلات`, people.root.id],
  );
  const projectId = rows[0].id;
  await db.query(`insert into project_managers (project_id, member_id) values ($1, $2)`, [projectId, people.pm.id]);
  await db.query(`insert into project_members (project_id, member_id) values ($1, $2)`, [projectId, people.pm.id]);
  return { people, projectId };
}

async function run({ people, projectId }) {
  const { root, pm, huda, dana, alice, gina } = people;
  const attach = (token) =>
    rest(token, 'project_components', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, component_key: 'mock_interviews', external_ref: 'edition-1' }),
    });

  check('a Member attaching a component is refused', refused(await attach(alice.token)));
  check('a Director of the owning team attaching is refused (projects.manage is none, 0057)', refused(await attach(dana.token)));
  check('the project’s PM attaches the component', allowed(await attach(pm.token)));

  const roleOf = async (token) => {
    const r = await rpc(token, 'my_component_access');
    const row = (Array.isArray(r.body) ? r.body : []).find((x) => x.project_id === projectId);
    return row?.role ?? null;
  };

  check('the PM is a manager', (await roleOf(pm.token)) === 'manager');
  check('the Super Admin is a manager', (await roleOf(root.token)) === 'manager');
  check('an HR Director is hr without being listed', (await roleOf(huda.token)) === 'hr');
  check('an unlisted Member sees nothing', (await roleOf(alice.token)) === null);
  check('a Guest sees nothing', (await roleOf(gina.token)) === null);
  check('a Director of another team sees nothing', (await roleOf(dana.token)) === null);

  const addPerson = (token, memberId, role) =>
    rest(token, 'project_component_people', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, member_id: memberId, role }),
    });

  check('a Member adding themself as organizer is refused', refused(await addPerson(alice.token, alice.id, 'organizer')));
  check('the PM adds an organizer', allowed(await addPerson(pm.token, alice.id, 'organizer')));
  check('the organizer now has organizer access', (await roleOf(alice.token)) === 'organizer');
  check('the PM adding an HR person is refused', refused(await addPerson(pm.token, gina.id, 'hr')));
  check('a Director of another team adding an HR person is refused', refused(await addPerson(dana.token, gina.id, 'hr')));
  check('an HR Director adds an HR person', allowed(await addPerson(huda.token, alice.id, 'hr')));
  check('hr outranks organizer for the same person', (await roleOf(alice.token)) === 'hr');
  check('the Presidency/Super Admin can add an HR person too', allowed(await addPerson(root.token, gina.id, 'hr')));

  const remove = (token, memberId, role) =>
    rest(token, `project_component_people?project_id=eq.${projectId}&member_id=eq.${memberId}&role=eq.${role}`, {
      method: 'DELETE',
    });
  check('the PM cannot remove an HR person', refused(await remove(pm.token, alice.id, 'hr')));
  check('an HR Director removes an HR person', allowed(await remove(huda.token, alice.id, 'hr')));
  check('back to organizer once the hr row is gone', (await roleOf(alice.token)) === 'organizer');
  check('an organizer cannot remove another organizer', refused(await remove(alice.token, alice.id, 'organizer')));

  const detach = (token) =>
    rest(token, `project_components?project_id=eq.${projectId}`, { method: 'DELETE' });
  check('an organizer cannot detach', refused(await detach(alice.token)));
  check('the PM detaches', allowed(await detach(pm.token)));
  check('nobody has access once detached', (await roleOf(alice.token)) === null && (await roleOf(pm.token)) === null);
}

await db.connect();
try {
  await cleanUp();
  const seeded = await seed();
  await run(seeded);
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
