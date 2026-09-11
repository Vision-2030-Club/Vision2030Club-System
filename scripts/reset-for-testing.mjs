/**
 * Wipes the club's data and seeds a fake club for the IT team to test with.
 *
 *   npm run db:reset-for-testing -- --yes [--keep you@example.com]
 *
 * DESTRUCTIVE. Every person, request, task, project, booking, calendar entry
 * and login account goes. Configuration stays: teams, roles, permissions,
 * request types, rooms, booking settings, the Google connection, assets.
 *
 * Before deleting anything it writes every table to backups/reset-<time>.json
 * (gitignored — it holds national IDs). The real members come back later via
 * Admin → Import from members-import.csv; that is the supported path, not the
 * backup, which is there so nothing is unrecoverable.
 *
 * `--keep` leaves one real account untouched (yours), so you are not locked
 * out. Everything else is replaced by ~40 people covering every role in every
 * team, two projects with splits and open tasks, and one shared password.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const {
  SUPABASE_DB_URL,
  NEXT_PUBLIC_SUPABASE_URL: API_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
} = process.env;

for (const [name, value] of Object.entries({
  SUPABASE_DB_URL,
  NEXT_PUBLIC_SUPABASE_URL: API_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
})) {
  if (!value) {
    console.error(`${name} is not set in .env.local.`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (!args.includes('--yes')) {
  console.error(
    'This deletes every person and all activity in the live database.\n' +
      'Run again with --yes to confirm. Add --keep <email> to leave one account in place.',
  );
  process.exit(1);
}
const keepIndex = args.indexOf('--keep');
const KEEP_EMAIL = keepIndex === -1 ? null : (args[keepIndex + 1] ?? '').toLowerCase();

const PASSWORD = 'Vision2030!test';
const DOMAIN = 'vision2030.test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const db = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

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
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
}

// ---------------------------------------------------------------------------
// 1. Backup
// ---------------------------------------------------------------------------

async function backup() {
  const { rows: tables } = await db.query(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' order by 1`,
  );
  const dump = { taken_at: new Date().toISOString(), tables: {} };
  for (const { tablename } of tables) {
    const { rows } = await db.query(`select * from "${tablename}"`);
    dump.tables[tablename] = rows;
  }
  const { rows: users } = await db.query(
    `select id, email, created_at, last_sign_in_at from auth.users order by created_at`,
  );
  dump.auth_users = users;

  const dir = join(ROOT, 'backups');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `reset-${dump.taken_at.replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(dump, null, 2));
  const total = Object.values(dump.tables).reduce((n, r) => n + r.length, 0);
  console.log(`Backed up ${total} rows from ${tables.length} tables + ${users.length} accounts → ${file}`);
}

// ---------------------------------------------------------------------------
// 2. Wipe — explicit order, so nothing configuration-shaped is touched
// ---------------------------------------------------------------------------

async function wipe() {
  let keepId = null;
  if (KEEP_EMAIL) {
    const { rows } = await db.query(`select id, auth_user_id from members where email = $1`, [KEEP_EMAIL]);
    if (!rows.length) throw new Error(`--keep ${KEEP_EMAIL}: no such member`);
    keepId = rows[0];
  }

  const activity = [
    'notification_outbox',
    'attendance_records',
    'asset_checkouts',
    'task_scores',
    'task_assignees',
    'tasks',
    'project_split_members',
    'project_split_managers',
    'project_splits',
    'project_members',
    'project_managers',
    'calendar_entry_audiences',
    'calendar_entries',
    'meeting_details',
    'request_status_history',
    'requests',
    'room_bookings',
    'team_posts',
    'member_experience',
    'role_change_log',
    'projects',
  ];
  for (const table of activity) {
    await db.query(`delete from "${table}"`);
  }

  // Keep the kept person's own devices; everyone else's go with them.
  if (keepId) {
    await db.query(`delete from push_subscriptions where member_id <> $1`, [keepId.id]);
  } else {
    await db.query(`delete from push_subscriptions`);
  }

  // The Google connection stays; only who pressed Connect is forgotten if
  // that person is leaving.
  await db.query(
    `update google_credentials set connected_by = null
      where connected_by is not null
        and connected_by <> coalesce($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [keepId?.id ?? null],
  );

  const { rowCount } = keepId
    ? await db.query(`delete from members where id <> $1`, [keepId.id])
    : await db.query(`delete from members`);
  console.log(`Deleted ${rowCount} members${KEEP_EMAIL ? ` (kept ${KEEP_EMAIL})` : ''}.`);

  // Login accounts: everything the members table no longer points at.
  let removed = 0;
  for (let page = 1; page < 50; page += 1) {
    const { body } = await adminFetch(`admin/users?page=${page}&per_page=200`);
    const users = body?.users ?? [];
    if (!users.length) break;
    for (const user of users) {
      if (keepId && user.id === keepId.auth_user_id) continue;
      const del = await adminFetch(`admin/users/${user.id}`, { method: 'DELETE' });
      if (del.ok) removed += 1;
    }
    if (users.length < 200) break;
  }
  console.log(`Deleted ${removed} login accounts.`);
}

// ---------------------------------------------------------------------------
// 3. Seed
// ---------------------------------------------------------------------------

const FIRST_EN = ['Abdullah', 'Sara', 'Mohammed', 'Noura', 'Khalid', 'Reem', 'Faisal', 'Lama', 'Omar', 'Hind', 'Saud', 'Dana', 'Turki', 'Maha', 'Nasser', 'Rana', 'Fahad', 'Aseel', 'Bandar', 'Jood', 'Majed', 'Layan', 'Rayan', 'Deem', 'Ziyad', 'Shahad', 'Yazeed', 'Ghala', 'Sultan', 'Wajd', 'Hamad', 'Lina', 'Meshal', 'Raghad', 'Talal', 'Nada', 'Waleed', 'Haya', 'Anas', 'Malak'];
const FIRST_AR = ['عبدالله', 'سارة', 'محمد', 'نورة', 'خالد', 'ريم', 'فيصل', 'لمى', 'عمر', 'هند', 'سعود', 'دانة', 'تركي', 'مها', 'ناصر', 'رنا', 'فهد', 'أسيل', 'بندر', 'جود', 'ماجد', 'ليان', 'ريان', 'ديم', 'زياد', 'شهد', 'يزيد', 'غلا', 'سلطان', 'وجد', 'حمد', 'لينا', 'مشعل', 'رغد', 'طلال', 'ندى', 'وليد', 'هيا', 'أنس', 'ملاك'];
const LAST_EN = ['Alotaibi', 'Alqahtani', 'Alharbi', 'Alshehri', 'Aldossari', 'Alghamdi', 'Alzahrani', 'Almutairi', 'Alsubaie', 'Alshammari'];
const LAST_AR = ['العتيبي', 'القحطاني', 'الحربي', 'الشهري', 'الدوسري', 'الغامدي', 'الزهراني', 'المطيري', 'السبيعي', 'الشمري'];
const COLLEGES = ['Computer Science', 'Business', 'Engineering', 'Medicine', 'Law', 'Design'];
const LEVELS = ['Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8'];

async function seed() {
  const { rows: teamRows } = await db.query(`select id, key, name_en, name_ar from teams order by key`);
  const teams = Object.fromEntries(teamRows.map((t) => [t.key, t]));
  const { rows: roleRows } = await db.query(`select id, key, name_en from roles`);
  const roles = Object.fromEntries(roleRows.map((r) => [r.key, r]));

  const workTeams = teamRows.filter((t) => t.key !== 'CLUB_MGMT').map((t) => t.key);

  // slug → { role, team }
  const plan = [
    ['admin', 'super_admin', 'IT'],
    ['president', 'president', 'CLUB_MGMT'],
    ['vp', 'vice_president', 'CLUB_MGMT'],
    ...workTeams.map((key) => [`director.${key.toLowerCase()}`, 'team_director', key]),
    ['pm.1', 'project_manager', 'CLUB_MGMT'],
    ['pm.2', 'project_manager', 'CLUB_MGMT'],
    ...workTeams.flatMap((key) =>
      [1, 2, 3].map((n) => [`member.${key.toLowerCase()}.${n}`, 'member', key]),
    ),
    ['guest', 'guest', 'PR'],
  ];

  const people = {};
  let i = 0;
  for (const [slug, roleKey, teamKey] of plan) {
    const email = `test.${slug}@${DOMAIN}`;
    const first = i % FIRST_EN.length;
    const last = i % LAST_EN.length;
    const nameEn = `${FIRST_EN[first]} ${LAST_EN[last]}`;
    const nameAr = `${FIRST_AR[first]} ${LAST_AR[last]}`;

    const created = await adminFetch('admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
    });
    if (!created.ok) throw new Error(`Could not create ${email}: ${JSON.stringify(created.body)}`);

    const { rows } = await db.query(
      `insert into members
         (auth_user_id, email, name_en, name_ar, phone, student_id, team_id, role_id,
          college, academic_level, graduation_term, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
       returning id`,
      [
        created.body.id,
        email,
        nameEn,
        nameAr,
        `+96650000${String(1000 + i).padStart(4, '0')}`,
        `4${String(10000001 + i).padStart(8, '0')}`,
        teams[teamKey].id,
        roles[roleKey].id,
        COLLEGES[i % COLLEGES.length],
        LEVELS[i % LEVELS.length],
        i % 2 ? 'First Semester 1448H' : 'Second Semester 1448H',
      ],
    );
    await db.query(`insert into member_sensitive (member_id, national_id) values ($1, $2)`, [
      rows[0].id,
      `1${String(100000001 + i).padStart(9, '0')}`,
    ]);

    people[slug] = { id: rows[0].id, email, nameEn, role: roles[roleKey].name_en, team: teams[teamKey].name_en };
    i += 1;
  }
  console.log(`Created ${i} people.`);

  // --- Two projects, so claiming, splits and PM routing can all be tried ----

  async function project(nameEn, nameAr, ownerTeam, pmSlug, memberSlugs, splits) {
    const { rows } = await db.query(
      `insert into projects (name_en, name_ar, description, owning_team_id, created_by, starts_on, ends_on)
       values ($1, $2, $3, $4, $5, current_date, current_date + 60) returning id`,
      [nameEn, nameAr, 'Seeded for testing.', teams[ownerTeam].id, people[pmSlug].id],
    );
    const id = rows[0].id;
    await db.query(`insert into project_managers (project_id, member_id) values ($1, $2)`, [id, people[pmSlug].id]);
    for (const slug of memberSlugs) {
      await db.query(`insert into project_members (project_id, member_id) values ($1, $2)`, [id, people[slug].id]);
    }
    for (const [splitName, splitMembers] of splits) {
      const { rows: s } = await db.query(
        `insert into project_splits (project_id, name, created_by) values ($1, $2, $3) returning id`,
        [id, splitName, people[pmSlug].id],
      );
      await db.query(`insert into project_split_managers (split_id, member_id) values ($1, $2)`, [s[0].id, people[pmSlug].id]);
      for (const slug of splitMembers) {
        await db.query(`insert into project_split_members (split_id, member_id) values ($1, $2)`, [s[0].id, people[slug].id]);
      }
      // One open task per split, waiting to be claimed.
      await db.query(
        `insert into tasks (title, description, project_id, split_id, created_by, due_date)
         values ($1, 'Open task — claim it from the Tasks page.', $2, $3, $4, current_date + 7)`,
        [`${splitName}: first draft`, id, s[0].id, people[pmSlug].id],
      );
    }
    // And one open project-wide task.
    await db.query(
      `insert into tasks (title, description, project_id, created_by, due_date)
       values ($1, 'Open task — any project member can claim it.', $2, $3, current_date + 14)`,
      [`${nameEn}: kickoff checklist`, id, people[pmSlug].id],
    );
    return id;
  }

  await project(
    'Launch Event', 'حفل الإطلاق', 'DESIGN', 'pm.1',
    ['member.design.1', 'member.design.2', 'member.media.1', 'member.media.2', 'member.pr.1'],
    [
      ['Stage & visuals', ['member.design.1', 'member.design.2']],
      ['Coverage', ['member.media.1', 'member.media.2']],
    ],
  );
  await project(
    'Members App', 'تطبيق الأعضاء', 'DEVELOPMENT', 'pm.2',
    ['member.development.1', 'member.development.2', 'member.development.3', 'member.content.1'],
    [['Backend', ['member.development.1', 'member.development.2']]],
  );

  // One assigned team task per team, so every Director has something to review.
  for (const key of workTeams) {
    const dir = people[`director.${key.toLowerCase()}`];
    const mem = people[`member.${key.toLowerCase()}.1`];
    const { rows } = await db.query(
      `insert into tasks (title, description, team_id, created_by, due_date, assigned_at)
       values ($1, 'Assigned task — submit it for review when done.', $2, $3, current_date + 5, now())
       returning id`,
      [`${teams[key].name_en}: weekly update`, teams[key].id, dir.id],
    );
    await db.query(`insert into task_assignees (task_id, member_id) values ($1, $2)`, [rows[0].id, mem.id]);
  }
  console.log('Created 2 projects, 3 splits, 5 open tasks, 8 assigned tasks.');

  return people;
}

// ---------------------------------------------------------------------------
// 4. Handout
// ---------------------------------------------------------------------------

async function handout(people) {
  const lines = [
    '# Test accounts — Vision Club 2030',
    '',
    `Password for every account: \`${PASSWORD}\``,
    '',
    'Site: https://vision2030club-system.vercel.app — on iPhone, open in Safari, Share → Add to Home Screen, then sign in from the icon.',
    '',
    '| Email | Name | Role | Team |',
    '|---|---|---|---|',
    ...Object.values(people).map((p) => `| ${p.email} | ${p.nameEn} | ${p.role} | ${p.team} |`),
    '',
    'Projects: **Launch Event** (PM: test.pm.1, splits Stage & visuals / Coverage) and **Members App** (PM: test.pm.2, split Backend). Each has open tasks to claim.',
    'Every team has one task already assigned to its first member, ready to submit for review.',
    '',
  ];
  const file = join(ROOT, 'backups', 'test-accounts.md');
  await writeFile(file, lines.join('\n'));
  console.log(`Handout → ${file}`);
  console.log('\n' + lines.slice(0, 8).join('\n'));
  console.log(...Object.values(people).map((p) => `\n| ${p.email} | ${p.nameEn} | ${p.role} | ${p.team} |`));
}

await db.connect();
try {
  await backup();
  await wipe();
  const people = await seed();
  await handout(people);
} finally {
  await db.end();
}
