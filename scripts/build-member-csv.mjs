/**
 * Turns `Database club.xlsx` into a CSV the admin import screen accepts.
 *
 *   node scripts/build-member-csv.mjs
 *
 * Reads the spreadsheet directly — an .xlsx is a zip of XML, so this needs no
 * new dependency. Writes `members-import.csv` and prints a pre-flight report.
 *
 * Read the report before importing. `import_members` is ALL OR NOTHING: one
 * bad row rejects the whole file, so it is much cheaper to see the problems
 * listed here than to paste 100 rows and be told "row 63".
 *
 * Fix problems in the SPREADSHEET and re-run, not in the CSV — the CSV is
 * generated and will be overwritten.
 *
 * `--skip-invalid` writes the CSV anyway, leaving out the rows that cannot be
 * imported and naming each one. Use it to get everybody else in today; the
 * skipped people still need adding once their data is fixed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const XLSX = 'Database club.xlsx';
const OUT = 'members-import.csv';
const SKIP_INVALID = process.argv.includes('--skip-invalid');

/*
 * The club's spreadsheet names and the system's names are not the same, and
 * `import_members` matches Arabic byte-exactly — `مدير مشروع` in the sheet is
 * `مدير المشروع` in the system, and one row spells `ادارة النادي` without its
 * hamza. So we emit the English key instead, which the importer matches
 * case-insensitively, and none of that can bite.
 */
const TEAMS = {
  'إدارة النادي': 'CLUB_MGMT',
  'ادارة النادي': 'CLUB_MGMT',
  'فريق الموارد البشرية': 'HR',
  'فريق العلاقات العامة': 'PR',
  'فريق التطوير': 'DEVELOPMENT',
  'فريق الادارة المالية': 'FINANCE',
  'فريق المحتوى': 'CONTENT',
  'فريق التصميم': 'DESIGN',
  // No Photography team exists; coverage work sits with Media.
  'فريق التصوير': 'MEDIA',
  // The Technical team was deleted deliberately; these five belong to IT.
  'الفريق التقني': 'IT',
};

const ROLES = {
  'عضو': 'member',
  'قائد فريق': 'team_director',
  'مدير مشروع': 'project_manager',
  'نائب الرئيس': 'vice_president',
  'الرئيس': 'president',
};

/** Sheet project names differ from the system's; match on the English name. */
const PROJECTS = {
  'ارشاد': 'Career Fair',
  'إرشاد': 'Career Fair',
  'افترض': 'Mockup Interviews',
  'سين': 'Seen',
  'خطى المملكة': 'Kingdom Steps',
  'قروش': 'Shark Tank',
};

/*
 * The live Super Admin is IN this spreadsheet, as row 131, listed as
 * `قائد فريق` of the Technical team. `import_members` matches on student ID
 * and overwrites the role — so importing that row as written would demote the
 * club's only Super Admin, and nobody could restore it from inside the app.
 *
 * Keyed by student ID so it survives the row moving.
 */
const KEEP_ROLE = {
  '445106843': { role: 'super_admin', team: 'IT' },
};

// ---------------------------------------------------------------------------
// Minimal .xlsx reader: a zip of XML parts, no external library.
// ---------------------------------------------------------------------------

function readZip(path) {
  const buf = readFileSync(path);
  const files = {};

  /*
   * Read the CENTRAL DIRECTORY rather than the local file headers. A zip entry
   * written in streaming mode carries zero sizes in its local header and puts
   * the real ones in a trailing data descriptor — the central directory always
   * has them, so this reads every part rather than silently skipping some.
   */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error(`${path} is not a readable zip`);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    // The local header repeats the name/extra with its own lengths.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressed);

    try {
      files[name] = method === 0 ? raw.toString('utf8') : inflateRawSync(raw).toString('utf8');
    } catch { /* binary part we do not need */ }

    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const parts = readZip(XLSX);

const shared = [];
for (const si of (parts['xl/sharedStrings.xml'] ?? '').match(/<si>[\s\S]*?<\/si>/g) ?? []) {
  shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
}

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const rows = new Map();
for (const [, rnum, body] of (parts['xl/worksheets/sheet1.xml'] ?? '').matchAll(
  /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g,
)) {
  const cells = {};
  for (const [, ref, attrs, inner] of body.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    let value = '';
    if (attrs.includes('t="s"') && v) value = shared[Number(v[1])] ?? '';
    else if (t) value = t[1];
    else if (v) value = v[1];
    cells[ref] = decode(value).trim();
  }
  rows.set(Number(rnum), cells);
}

// ---------------------------------------------------------------------------
// Read the members out
// ---------------------------------------------------------------------------

const STUDENT = /^4[0-9]{8}$/;
const NATIONAL = /^[12][0-9]{9}$/;

const members = [];

for (const [rnum, c] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
  if (rnum < 4) continue; // title + header
  if (!c.E || !c.E.includes('@')) continue; // filler row (just a number in A)

  /*
   * The sheet has TWO layouts. The club-management block carries a project in
   * H and the student ID in I; every other block has the student ID in H and
   * nothing in I. So the student ID column is whichever one looks like one.
   */
  const idInI = STUDENT.test(c.I ?? '');
  const studentId = idInI ? c.I : (c.H ?? '');
  const rawProject = idInI ? (c.H ?? '') : '';

  const team = TEAMS[c.F ?? ''];
  const role = ROLES[c.G ?? ''];
  const project = PROJECTS[rawProject] ?? '';

  const row = {
    row: rnum,
    email: c.E ?? '',
    name_en: c.C ?? '',
    name_ar: c.B ?? '',
    student_id: studentId,
    national_id: c.M ?? '',
    team,
    role,
    phone: c.D ?? '',
    college: c.J ?? '',
    academic_level: c.K ?? '',
    graduation_term: c.L ?? '',
    projects: project,
    _rawTeam: c.F ?? '',
    _rawRole: c.G ?? '',
    _rawProject: rawProject,
  };

  const override = KEEP_ROLE[studentId];
  if (override) {
    row.role = override.role;
    row.team = override.team;
    row._overridden = true;
  }

  members.push(row);
}

// ---------------------------------------------------------------------------
// Pre-flight report — the importer is all-or-nothing, so look before you leap
// ---------------------------------------------------------------------------

const problems = [];
const seenEmail = new Map();
const seenStudent = new Map();

for (const m of members) {
  const at = `row ${m.row} (${m.name_en || m.name_ar || m.email})`;
  const before = problems.length;
  if (!m.name_en) problems.push(`${at}: no English name`);
  if (!m.name_ar) problems.push(`${at}: no Arabic name`);
  if (!STUDENT.test(m.student_id)) problems.push(`${at}: student id "${m.student_id}" is not 9 digits starting with 4`);
  if (!NATIONAL.test(m.national_id)) problems.push(`${at}: national id "${m.national_id}" is not 10 digits starting with 1 or 2`);
  if (!m.team) problems.push(`${at}: team "${m._rawTeam}" has no mapping — add it to TEAMS in this script`);
  if (!m.role) problems.push(`${at}: role "${m._rawRole}" has no mapping — add it to ROLES in this script`);
  if (m._rawProject && m._rawProject !== '-' && !m.projects) {
    problems.push(`${at}: project "${m._rawProject}" has no mapping — add it to PROJECTS or create the project`);
  }

  const e = m.email.toLowerCase();
  if (seenEmail.has(e)) problems.push(`${at}: email ${m.email} already used on row ${seenEmail.get(e)}`);
  else seenEmail.set(e, m.row);

  if (seenStudent.has(m.student_id)) problems.push(`${at}: student id ${m.student_id} already used on row ${seenStudent.get(m.student_id)}`);
  else seenStudent.set(m.student_id, m.row);

  m._invalid = problems.length > before;
}

const tally = (key) => {
  const counts = new Map();
  for (const m of members) counts.set(m[key] || '(unmapped)', (counts.get(m[key] || '(unmapped)') ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`\nRead ${members.length} members from ${XLSX}\n`);
console.log('Teams:');
for (const [k, n] of tally('team')) console.log(`   ${String(n).padStart(4)}  ${k}`);
console.log('\nRoles:');
for (const [k, n] of tally('role')) console.log(`   ${String(n).padStart(4)}  ${k}`);
console.log('\nProjects:');
for (const [k, n] of tally('projects')) {
  console.log(`   ${String(n).padStart(4)}  ${k === '(unmapped)' ? '(no project)' : k}`);
}

for (const m of members.filter((x) => x._overridden)) {
  console.log(
    `\n! Row ${m.row} (${m.name_en}) is the live Super Admin.\n` +
      `  The sheet says ${m._rawRole} / ${m._rawTeam}; emitting role=${m.role} team=${m.team}\n` +
      `  so the import does not demote the only admin account.`,
  );
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s) — the importer rejects the WHOLE file if any remain:\n`);
  for (const p of problems) console.log(`   ${p}`);

  if (!SKIP_INVALID) {
    console.log(`\nFix these in ${XLSX} and re-run. ${OUT} was NOT written.`);
    console.log('Or run again with --skip-invalid to import everybody else now.');
    process.exit(1);
  }
}

const invalid = members.filter((m) => m._invalid);
const usable = members.filter((m) => !m._invalid);

if (invalid.length > 0) {
  console.log(`\nSkipping ${invalid.length} row(s); everybody else is written:`);
  for (const m of invalid) console.log(`   row ${m.row}  ${m.name_en || m.name_ar}  <${m.email}>`);
  console.log('\nThese people are NOT in the CSV. Fix the spreadsheet and re-run to add them,');
  console.log('or add them by hand on the members page.');
}

// ---------------------------------------------------------------------------
// Write it
// ---------------------------------------------------------------------------

const COLUMNS = [
  'email', 'name_en', 'name_ar', 'student_id', 'national_id',
  'team', 'role', 'phone', 'college', 'academic_level',
  'graduation_term', 'projects',
];

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csv = [
  COLUMNS.join(','),
  ...usable.map((m) => COLUMNS.map((k) => cell(m[k])).join(',')),
].join('\n');

// A BOM so Excel opens the Arabic correctly if anyone double-clicks it.
writeFileSync(OUT, '﻿' + csv + '\n', 'utf8');

console.log(`\nWrote ${OUT} — ${usable.length} member(s), ${COLUMNS.length} columns.`);
console.log('Import it at /ar/admin/import as Super Admin.');
