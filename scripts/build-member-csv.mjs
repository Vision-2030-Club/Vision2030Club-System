/**
 * Turns the club's membership spreadsheet into a CSV the admin import screen
 * accepts.
 *
 *   node scripts/build-member-csv.mjs ["path/to/sheet.xlsx"]
 *
 * Defaults to `Database club.xlsx` in the repo root (gitignored, like every
 * .xlsx). Written for the first-semester 1448H sheet: name in Arabic and
 * English, phone, email, team, role, project(s). Columns are found by their
 * Arabic header, not their letter, so a reordered sheet still reads.
 *
 * Student ID and national ID are deliberately NOT written, even if a sheet has
 * them — the club no longer collects them this way. `import_members` (0070)
 * matches people on phone, then email, and keeps any IDs already stored.
 *
 * Writes `members-import.csv` and prints a pre-flight report. Read it before
 * importing: `import_members` is ALL OR NOTHING, so one bad row rejects the
 * whole file, and it is much cheaper to see the problems listed here.
 *
 * Fix problems in the SPREADSHEET and re-run, not in the CSV — the CSV is
 * generated and will be overwritten. `--skip-invalid` writes the CSV anyway,
 * leaving out the rows that cannot be imported and naming each one.
 */
import { writeFileSync } from 'node:fs';
import { openWorkbook } from './lib/xlsx.mjs';

const XLSX = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'Database club.xlsx';
const OUT = 'members-import.csv';
const SKIP_INVALID = process.argv.includes('--skip-invalid');

/*
 * The club's spreadsheet names and the system's names are not the same, and
 * `import_members` matches Arabic byte-exactly — so we emit the English key,
 * which the importer matches case-insensitively, and spelling variants in the
 * sheet (a missing hamza, ي for ى) cannot bite.
 */
const TEAMS = {
  'إدارة النادي': 'CLUB_MGMT',
  'ادارة النادي': 'CLUB_MGMT',
  'فريق الموارد البشرية': 'HR',
  'فريق العلاقات العامة': 'PR',
  'فريق التطوير': 'DEVELOPMENT',
  'فريق الادارة المالية': 'FINANCE',
  'فريق الإدارة المالية': 'FINANCE',
  'فريق المحتوى': 'CONTENT',
  'فريق التصميم': 'DESIGN',
  // No Photography team exists; coverage work sits with Media.
  'فريق التصوير': 'MEDIA',
  // The Technical team was deleted deliberately; these people belong to IT.
  'الفريق التقني': 'IT',
};

const ROLES = {
  'عضو': 'member',
  'قائد فريق': 'team_director',
  'مدير مشروع': 'project_manager',
  'نائب الرئيس': 'vice_president',
  'نائب رئيس': 'vice_president',
  'الرئيس': 'president',
  // The club confirmed (Oct 2026) these are ordinary members in the system.
  'مدير فريق': 'member',
  'مدير الفريق': 'member',
};

/** Sheet project names differ from the system's; match on the English name. */
const PROJECTS = {
  'ارشاد': 'Career Fair',
  'إرشاد': 'Career Fair',
  'افترض': 'Mockup Interviews',
  'سين': 'Seen',
  'خطى المملكة': 'Kingdom Steps',
  'خطي المملكة': 'Kingdom Steps',
  'قروش': 'Shark Tank',
};

/** Header text → field. Anything not listed (#, IDs, notes) is ignored. */
const HEADERS = [
  [/العربي/, 'name_ar'],
  [/الانجليزي|الإنجليزي/, 'name_en'],
  [/الجوال|الهاتف/, 'phone'],
  [/البريد/, 'email'],
  [/الفريق/, 'team'],
  [/دورك|الدور/, 'role'],
  [/المشروع/, 'projects'],
];

/** Same rules as `app.normalize_phone` (0022), so this report agrees with the database. */
function normalizePhone(raw) {
  const v = String(raw ?? '').replace(/[^0-9+]/g, '');
  if (v === '') return '';
  if (/^\+9665[0-9]{8}$/.test(v)) return v;
  if (/^009665[0-9]{8}$/.test(v)) return `+${v.slice(2)}`;
  if (/^9665[0-9]{8}$/.test(v)) return `+${v}`;
  if (/^05[0-9]{8}$/.test(v)) return `+966${v.slice(1)}`;
  if (/^5[0-9]{8}$/.test(v)) return `+966${v}`;
  return v;
}

// ---------------------------------------------------------------------------
// Read the members out
// ---------------------------------------------------------------------------

const workbook = openWorkbook(XLSX);
const sheet = workbook.sheetNames[0];
const rows = workbook.rows(sheet);

const headerRow = rows.find((r) => Object.values(r.cells).some((v) => /البريد/.test(v)));
if (!headerRow) {
  console.error(`No header row with an email column (البريد) in "${sheet}" of ${XLSX}.`);
  process.exit(1);
}

const columns = {};
for (const [col, text] of Object.entries(headerRow.cells)) {
  const match = HEADERS.find(([re]) => re.test(text));
  if (match && !columns[match[1]]) columns[match[1]] = col;
}
for (const field of ['name_ar', 'name_en', 'phone', 'email', 'team', 'role']) {
  if (!columns[field]) {
    console.error(`No column for ${field} in the header row of ${XLSX}.`);
    process.exit(1);
  }
}

const members = [];

for (const { row: rnum, cells } of rows) {
  if (rnum <= headerRow.row) continue;
  const get = (field) => (columns[field] ? cells[columns[field]] ?? '' : '').trim();
  if (!get('email').includes('@')) continue; // filler row (just a number in #)

  const rawProjects = get('projects')
    .split(/[,،]/)
    .map((p) => p.trim())
    .filter((p) => p && p !== '-');

  members.push({
    rows: [rnum],
    email: get('email'),
    name_en: get('name_en').replace(/\s+/g, ' '),
    name_ar: get('name_ar').replace(/\s+/g, ' '),
    phone: normalizePhone(get('phone')),
    team: TEAMS[get('team')],
    role: ROLES[get('role')],
    projects: [...new Set(rawProjects.map((p) => PROJECTS[p] ?? `?${p}`))],
    _rawPhone: get('phone'),
    _rawTeam: get('team'),
    _rawRole: get('role'),
  });
}

// ---------------------------------------------------------------------------
// The same person listed twice: merge when the rows agree, otherwise report.
// ---------------------------------------------------------------------------

const merged = [];
const mergeNotes = [];
const problems = [];

for (const m of members) {
  const twin = merged.find(
    (x) => x.email.toLowerCase() === m.email.toLowerCase() || (m.phone && x.phone === m.phone),
  );
  if (!twin) {
    merged.push(m);
    continue;
  }
  const same =
    twin.email.toLowerCase() === m.email.toLowerCase() &&
    twin.phone === m.phone &&
    twin.team === m.team &&
    twin.role === m.role;
  if (same) {
    twin.rows.push(...m.rows);
    twin.projects = [...new Set([...twin.projects, ...m.projects])];
    mergeNotes.push(`rows ${twin.rows.join(' & ')} are the same person — merged, projects combined`);
  } else {
    problems.push(
      `row ${m.rows[0]} shares an email or phone with row ${twin.rows[0]} but the team, role or contact details differ — keep one row`,
    );
    m._invalid = true;
    merged.push(m);
  }
}

// ---------------------------------------------------------------------------
// Pre-flight report — the importer is all-or-nothing, so look before you leap
// ---------------------------------------------------------------------------

for (const m of merged) {
  const at = `row ${m.rows[0]}`;
  const before = problems.length;
  if (!m.name_en) problems.push(`${at}: no English name`);
  if (!m.name_ar) problems.push(`${at}: no Arabic name`);
  if (/[؀-ۿ]/.test(m.name_en)) problems.push(`${at}: the English name has Arabic letters in it`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email)) problems.push(`${at}: email is not a valid address`);
  if (!/^\+9665[0-9]{8}$/.test(m.phone)) {
    problems.push(`${at}: phone "${m._rawPhone.replace(/\d/g, '9')}" is not a Saudi mobile (05XXXXXXXX) — phone is the match key`);
  }
  if (!m.team) problems.push(`${at}: team "${m._rawTeam}" has no mapping — add it to TEAMS in this script`);
  if (!m.role) problems.push(`${at}: role "${m._rawRole}" has no mapping — add it to ROLES in this script`);
  for (const p of m.projects.filter((x) => x.startsWith('?'))) {
    problems.push(`${at}: project "${p.slice(1)}" has no mapping — add it to PROJECTS or create the project`);
  }
  if (!m._invalid) m._invalid = problems.length > before;
}

const tally = (pick) => {
  const counts = new Map();
  for (const m of merged) {
    for (const k of [pick(m)].flat()) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`\nRead ${members.length} rows, ${merged.length} people, from "${sheet}" in ${XLSX}\n`);
console.log('Teams:');
for (const [k, n] of tally((m) => m.team ?? '(unmapped)')) console.log(`   ${String(n).padStart(4)}  ${k}`);
console.log('\nRoles:');
for (const [k, n] of tally((m) => m.role ?? '(unmapped)')) console.log(`   ${String(n).padStart(4)}  ${k}`);
console.log('\nProjects:');
for (const [k, n] of tally((m) => (m.projects.length ? m.projects : ['(no project)']))) {
  console.log(`   ${String(n).padStart(4)}  ${k}`);
}

if (mergeNotes.length > 0) {
  console.log('\nDuplicates:');
  for (const note of mergeNotes) console.log(`   ${note}`);
}

console.log(
  '\nNote: the import never changes the role of a current Super Admin (0070), so the\n' +
    "Super Admin's own row can say anything without demoting them.",
);

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s) — the importer rejects the WHOLE file if any remain:\n`);
  for (const p of problems) console.log(`   ${p}`);

  if (!SKIP_INVALID) {
    console.log(`\nFix these in ${XLSX} and re-run. ${OUT} was NOT written.`);
    console.log('Or run again with --skip-invalid to import everybody else now.');
    process.exit(1);
  }
}

const invalid = merged.filter((m) => m._invalid);
const usable = merged.filter((m) => !m._invalid);

if (invalid.length > 0) {
  console.log(`\nSkipping ${invalid.length} row(s); everybody else is written:`);
  for (const m of invalid) console.log(`   row ${m.rows[0]}`);
  console.log('\nThese people are NOT in the CSV. Fix the spreadsheet and re-run to add them,');
  console.log('or add them by hand on the members page.');
}

// ---------------------------------------------------------------------------
// Write it
// ---------------------------------------------------------------------------

const COLUMNS = ['email', 'name_en', 'name_ar', 'phone', 'team', 'role', 'projects'];

const cell = (v) => {
  const s = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csv = [
  COLUMNS.join(','),
  ...usable.map((m) => COLUMNS.map((k) => cell(m[k])).join(',')),
].join('\n');

// A BOM so Excel opens the Arabic correctly if anyone double-clicks it.
writeFileSync(OUT, '﻿' + csv + '\n', 'utf8');

console.log(`\nWrote ${OUT} — ${usable.length} member(s), ${COLUMNS.length} columns.`);
console.log('Import it at /ar/admin/import as Super Admin, after migration 0070 is applied.');
