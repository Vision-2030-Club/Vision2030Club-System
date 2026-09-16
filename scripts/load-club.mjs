/**
 * Replaces whatever is in the live database with the real club.
 *
 *   npm run db:load-club -- --yes [--from backups/reset-<time>.json] [--keep you@example.com]
 *   npm run db:load-club -- --dry            validate and print the plan, write nothing
 *
 * DESTRUCTIVE. Every person, request, task, project, booking, calendar entry
 * and login account goes — except one account (`--keep`, defaulting to whoever
 * holds `super_admin` today), which is updated in place so nobody is locked
 * out. Configuration stays: teams, roles, permissions, request types, rooms,
 * booking settings, the Google connection, assets.
 *
 * What comes back, in order:
 *
 *   1. A backup of everything to backups/load-club-<time>.json (gitignored).
 *   2. The five real projects and the `kind = 'club'` semester timeline, taken
 *      from the backup file named by `--from` (default: the newest
 *      backups/reset-*.json — the one `db:reset-for-testing` wrote before it
 *      replaced the club with testers). Their ids are kept.
 *   3. The members in members-import.csv — run
 *      `node scripts/build-member-csv.mjs` first so it reflects
 *      `Database club.xlsx`. Where the backup knows a student ID, that
 *      person's old id is reused, so nothing that pointed at them dangles.
 *      Project links follow the file: named against a project = member of it;
 *      a Project Manager named against a project = one of its managers.
 *   4. The role changes the club made inside the app after its first import
 *      (`role_change_log` in the backup) are replayed on top of the file, so a
 *      role the spreadsheet never caught up with is not silently undone. Each
 *      is printed. Somebody whose final role is not Project Manager is left as
 *      a plain member of their projects.
 *
 * Nobody but the kept account can sign in afterwards until they set a
 * password on first login — that is the designed flow (login/actions.ts), the
 * same as after the first import.
 *
 * This talks to PostgREST and the Auth admin API with the service-role key,
 * not to Postgres directly, because some networks block 5432/6543 and the REST
 * endpoint is always reachable. The price is that there is no transaction
 * around the whole thing: everything is validated before the first write, and
 * the backup is taken first, but a failure part-way leaves a half-loaded club
 * that needs this run again.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, 'members-import.csv');
const ZERO = '00000000-0000-0000-0000-000000000000';

const { NEXT_PUBLIC_SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } = process.env;
for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })) {
  if (!value) {
    console.error(`${name} is not set in .env.local.`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
if (!DRY && !args.includes('--yes')) {
  console.error(
    'This deletes every person and all activity in the live database.\n' +
      'Run again with --yes to confirm, or --dry to see the plan first.',
  );
  process.exit(1);
}
const option = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
};

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(method, path, { body, prefer } = {}) {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    method,
    headers: { ...HEADERS, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text}`);
  return { json: text ? JSON.parse(text) : null, range: response.headers.get('content-range') };
}

const select = async (path) => (await rest('GET', path)).json;
const insert = (table, rows) => rest('POST', table, { body: rows, prefer: 'return=minimal' });
const update = (path, patch) => rest('PATCH', path, { body: patch, prefer: 'return=minimal' });

/** PostgREST wants a filter on DELETE; `pk <> zero` matches every row. */
const deleteAll = (table, pk = 'id', extra = '') => rest('DELETE', `${table}?${pk}=neq.${ZERO}${extra}`);

async function auth(path, options = {}) {
  const response = await fetch(`${API_URL}/auth/v1/${path}`, { ...options, headers: HEADERS });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
}

async function allAuthUsers() {
  const users = [];
  for (let page = 1; page < 50; page += 1) {
    const { body } = await auth(`admin/users?page=${page}&per_page=200`);
    const batch = body?.users ?? [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

// ---------------------------------------------------------------------------
// Inputs — the CSV, the backup, and what the live database says
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const columns = parseLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(parseLine(line).map((v, i) => [columns[i], v.trim()])));
}

async function newestResetBackup() {
  const dir = join(ROOT, 'backups');
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^reset-.*\.json$/.test(f)).sort();
  if (!files.length) throw new Error('No backups/reset-*.json to take the projects and timeline from; pass --from.');
  return join(dir, files[files.length - 1]);
}

const csvRows = parseCsv(await readFile(CSV, 'utf8'));
const fromPath = option('--from') ?? (await newestResetBackup());
const backup = JSON.parse(await readFile(fromPath, 'utf8'));

const teams = await select('teams?select=id,key,name_en,name_ar');
const roles = await select('roles?select=id,key,name_en,name_ar');
const roleById = Object.fromEntries(roles.map((r) => [r.id, r]));
const findTeam = (v) =>
  teams.find((t) => t.key === v.toUpperCase() || t.name_en.toLowerCase() === v.toLowerCase() || t.name_ar === v);
const findRole = (v) =>
  roles.find((r) => r.key === v.toLowerCase().replace(/ /g, '_') || r.name_en.toLowerCase() === v.toLowerCase() || r.name_ar === v);

const liveMembers = await select('members?select=id,email,student_id,auth_user_id,role_id');
const csvStudents = new Set(csvRows.map((r) => r.student_id));
// Default: the Super Admin who is in the club's own list. A tester round can
// leave a fake admin behind as well; that one goes with the other testers.
const keepEmail = (
  option('--keep') ??
  liveMembers.find((m) => roleById[m.role_id]?.key === 'super_admin' && csvStudents.has(m.student_id))?.email ??
  ''
).toLowerCase();
const keep = liveMembers.find((m) => m.email.toLowerCase() === keepEmail);
if (!keep) throw new Error(`--keep: no live member with email "${keepEmail || '(no super_admin found in the CSV)'}"`);

// ---------------------------------------------------------------------------
// Plan — every id resolved and every rule checked before a single write
// ---------------------------------------------------------------------------

const problems = [];

const projects = backup.tables.projects ?? [];
const projectByName = new Map(projects.flatMap((p) => [[p.name_en.toLowerCase(), p], [p.name_ar, p]]));
for (const p of projects) {
  if (!teams.find((t) => t.id === p.owning_team_id)) problems.push(`project ${p.name_en}: owning team ${p.owning_team_id} no longer exists`);
}

const backupMembers = backup.tables.members ?? [];
const backupIdByStudent = new Map(backupMembers.map((m) => [m.student_id, m.id]));
const backupById = new Map(backupMembers.map((m) => [m.id, m]));

const people = [];
const seenStudent = new Set();
for (const [i, r] of csvRows.entries()) {
  const at = `csv row ${i + 2} (${r.name_en || r.email})`;
  const team = findTeam(r.team ?? '');
  const role = findRole(r.role ?? '');
  if (!team) problems.push(`${at}: no team "${r.team}"`);
  if (!role) problems.push(`${at}: no role "${r.role}"`);
  if (!/^4[0-9]{8}$/.test(r.student_id)) problems.push(`${at}: bad student id "${r.student_id}"`);
  if (!/^[12][0-9]{9}$/.test(r.national_id)) problems.push(`${at}: bad national id`);
  if (seenStudent.has(r.student_id)) problems.push(`${at}: student id repeated`);
  seenStudent.add(r.student_id);

  const projectNames = (r.projects ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const linked = projectNames.map((name) => {
    const p = projectByName.get(name.toLowerCase()) ?? projectByName.get(name);
    if (!p) problems.push(`${at}: no project "${name}" in ${fromPath}`);
    return p;
  });

  const isKeep = keep.student_id === r.student_id;
  people.push({
    id: isKeep ? keep.id : (backupIdByStudent.get(r.student_id) ?? crypto.randomUUID()),
    isKeep,
    csv: r,
    team,
    role,
    projects: linked.filter(Boolean),
  });
}
if (!people.some((p) => p.isKeep)) problems.push(`the kept account ${keepEmail} (student id ${keep.student_id}) is not in the CSV — it would be deleted`);

// Replay the club's own role decisions, oldest first.
const replays = [];
for (const log of [...(backup.tables.role_change_log ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  const who = backupById.get(log.member_id);
  const person = who && people.find((p) => p.csv.student_id === who.student_id);
  const to = roleById[log.to_role_id];
  if (!person || !to) {
    problems.push(`role change for ${who?.name_en ?? log.member_id} → ${to?.key ?? log.to_role_id} cannot be replayed (person or role missing)`);
    continue;
  }
  if (person.isKeep) continue; // the kept account's role is pinned by build-member-csv
  replays.push({ person, from: person.role, to, changedBy: log.changed_by, at: log.created_at });
  person.role = to;
}

const managersOf = new Map(projects.map((p) => [p.id, []]));
for (const person of people) {
  if (person.role?.key !== 'project_manager') continue;
  for (const p of person.projects) managersOf.get(p.id).push(person);
}
for (const p of projects) {
  const n = managersOf.get(p.id).length;
  if (n > 4) problems.push(`project ${p.name_en} would have ${n} Project Managers; the limit is 4`);
}

const timeline = (backup.tables.calendar_entries ?? []).filter((e) => e.kind === 'club');
const superAdminIds = new Set(people.filter((p) => p.role?.key === 'super_admin').map((p) => p.id));

console.log(`\nSource: ${csvRows.length} members from members-import.csv, projects and timeline from ${fromPath}`);
console.log(`Keeping: ${keep.email} (updated in place, login account untouched)`);
console.log(`\nProjects (${projects.length}):`);
for (const p of projects) {
  const pms = managersOf.get(p.id).map((m) => m.csv.name_en).join(', ') || '(none)';
  const members = people.filter((x) => x.projects.includes(p)).length;
  console.log(`   ${p.name_en} / ${p.name_ar} — ${members} members, PMs: ${pms}`);
}
console.log(`\nTimeline: ${timeline.length} club calendar entries, ${timeline[0]?.starts_at.slice(0, 10)} → ${timeline.at(-1)?.starts_at.slice(0, 10)}`);
console.log('\nRoles:');
const tally = new Map();
for (const p of people) tally.set(p.role?.key ?? '?', (tally.get(p.role?.key ?? '?') ?? 0) + 1);
for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);
if (replays.length) {
  console.log('\nRole changes the club made in the app, replayed on top of the spreadsheet:');
  for (const r of replays) console.log(`   ${r.person.csv.name_en}: ${r.from?.key} → ${r.to.key}  (${r.at.slice(0, 10)})`);
}
if (superAdminIds.size !== 1) problems.push(`expected exactly one super_admin after loading, found ${superAdminIds.size}`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s); nothing was written:\n`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}
if (DRY) {
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Backup
// ---------------------------------------------------------------------------

const BASE_TABLES = [
  'asset_checkouts', 'assets', 'attendance_records', 'booking_settings', 'calendar_audience_roles',
  'calendar_entries', 'calendar_entry_audiences', 'google_credentials', 'meeting_details',
  'member_experience', 'member_sensitive', 'members', 'notification_outbox', 'permissions',
  'project_managers', 'project_members', 'project_split_managers', 'project_split_members',
  'project_splits', 'projects', 'push_subscriptions', 'request_hooks', 'request_status_history',
  'request_statuses', 'request_transitions', 'request_types', 'requests', 'role_change_log',
  'role_permission_team_overrides', 'role_permissions', 'roles', 'room_bookings', 'rooms',
  'task_assignees', 'task_scores', 'tasks', 'team_posts', 'teams',
];

{
  const dump = { taken_at: new Date().toISOString(), tables: {} };
  for (const table of BASE_TABLES) dump.tables[table] = await select(`${table}?select=*`);
  dump.auth_users = (await allAuthUsers()).map((u) => ({
    id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
  }));
  const dir = join(ROOT, 'backups');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `load-club-${dump.taken_at.replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(dump, null, 2));
  const total = Object.values(dump.tables).reduce((n, r) => n + r.length, 0);
  console.log(`\nBacked up ${total} rows from ${BASE_TABLES.length} tables + ${dump.auth_users.length} accounts → ${file}`);
}

// ---------------------------------------------------------------------------
// 2. Wipe — the same explicit order as reset-for-testing, configuration untouched
// ---------------------------------------------------------------------------

const ACTIVITY = [
  ['notification_outbox'], ['attendance_records'], ['asset_checkouts'], ['task_scores', 'task_id'],
  ['task_assignees', 'task_id'], ['tasks'], ['project_split_members', 'split_id'],
  ['project_split_managers', 'split_id'], ['project_splits'], ['project_members', 'project_id'],
  ['project_managers', 'project_id'], ['calendar_entry_audiences'], ['calendar_entries'],
  ['meeting_details', 'request_id'], ['request_status_history'], ['requests'], ['room_bookings'],
  ['team_posts'], ['role_change_log'], ['projects'],
];
for (const [table, pk] of ACTIVITY) await deleteAll(table, pk);

await deleteAll('member_experience', 'id', `&member_id=neq.${keep.id}`);
await deleteAll('push_subscriptions', 'id', `&member_id=neq.${keep.id}`);
await update(`google_credentials?connected_by=not.is.null&connected_by=neq.${keep.id}`, { connected_by: null });
await deleteAll('members', 'id', `&id=neq.${keep.id}`);
console.log(`Deleted ${liveMembers.length - 1} members (kept ${keep.email}).`);

let removed = 0;
for (const user of await allAuthUsers()) {
  if (user.id === keep.auth_user_id) continue;
  const del = await auth(`admin/users/${user.id}`, { method: 'DELETE' });
  if (del.ok) removed += 1;
  else console.warn(`   could not delete login ${user.email}: ${del.status}`);
}
console.log(`Deleted ${removed} login accounts.`);

// ---------------------------------------------------------------------------
// 3. Members first — projects, links and calendar entries all point at people
// ---------------------------------------------------------------------------

const rowFor = (person) => ({
  email: person.csv.email,
  name_en: person.csv.name_en,
  name_ar: person.csv.name_ar,
  phone: person.csv.phone || null,
  student_id: person.csv.student_id,
  team_id: person.team.id,
  role_id: person.role.id,
  college: person.csv.college || null,
  academic_level: person.csv.academic_level || null,
  graduation_term: person.csv.graduation_term || null,
  status: 'active',
});

const kept = people.find((p) => p.isKeep);
await update(`members?id=eq.${keep.id}`, rowFor(kept));
const newcomers = people.filter((p) => !p.isKeep);
await insert('members', newcomers.map((p) => ({ id: p.id, ...rowFor(p) })));
await rest('POST', 'member_sensitive?on_conflict=member_id', {
  body: people.map((p) => ({ member_id: p.id, national_id: p.csv.national_id })),
  prefer: 'return=minimal,resolution=merge-duplicates',
});
console.log(`Imported ${newcomers.length} members and updated ${keep.email}.`);

// ---------------------------------------------------------------------------
// 4. Projects, links, replayed role changes and the timeline — ids kept
// ---------------------------------------------------------------------------

// Anything that pointed at a person who is not coming back points at the kept
// account instead, rather than failing the insert.
const returning = new Set(people.map((p) => p.id));
const author = (id) => (id && returning.has(id) ? id : keep.id);

await insert('projects', projects.map((p) => ({ ...p, created_by: author(p.created_by) })));
console.log(`Restored ${projects.length} projects.`);

const memberLinks = people.flatMap((p) => p.projects.map((proj) => ({ project_id: proj.id, member_id: p.id })));
const managerLinks = people
  .filter((p) => p.role.key === 'project_manager')
  .flatMap((p) => p.projects.map((proj) => ({ project_id: proj.id, member_id: p.id })));
if (memberLinks.length) await insert('project_members', memberLinks);
if (managerLinks.length) await insert('project_managers', managerLinks);
console.log(`Linked ${memberLinks.length} project memberships, ${managerLinks.length} of them as Project Manager.`);

if (replays.length) {
  await insert('role_change_log', replays.map((r) => ({
    member_id: r.person.id,
    from_role_id: r.from?.id ?? null,
    to_role_id: r.to.id,
    changed_by: author(r.changedBy),
    created_at: r.at,
  })));
  console.log(`Recorded ${replays.length} replayed role change(s).`);
}

await insert('calendar_entries', timeline.map((e) => ({ ...e, created_by: author(e.created_by) })));
console.log(`Restored ${timeline.length} timeline entries.`);

// ---------------------------------------------------------------------------
// 5. Verify against the database, not against what we meant to write
// ---------------------------------------------------------------------------

const after = await select('members?select=email,student_id,auth_user_id,status,roles(key),teams(key)');
const admins = after.filter((m) => m.roles.key === 'super_admin');
const pmCounts = await select('project_managers?select=project_id');
const timelineCount = (await rest('GET', 'calendar_entries?select=id&kind=eq.club', { prefer: 'count=exact' })).range;
const authCount = (await allAuthUsers()).length;

console.log('\nAfter loading:');
console.log(`   members: ${after.length} (${after.filter((m) => m.status === 'active').length} active, ${after.filter((m) => m.auth_user_id).length} with a login)`);
console.log(`   super_admin: ${admins.map((m) => m.email).join(', ') || 'NOBODY — fix this now'}`);
console.log(`   project_managers rows: ${pmCounts.length}; club calendar entries: ${timelineCount}; login accounts: ${authCount}`);
if (admins.length !== 1 || !admins[0].auth_user_id) {
  console.error('\n!! The Super Admin is not intact. Restore from the backup above before doing anything else.');
  process.exit(2);
}
console.log('\nEveryone else sets a password on their first login at the site.');
