/**
 * Turns the Development team's KPI workbooks into the one file the seed reads.
 *
 *   npm run kpi:build                          read the folder, write the file
 *   npm run kpi:build -- --dry                 report only, write nothing
 *   npm run kpi:build -- --dir "some/folder"   a folder other than the default
 *
 * Input:  "Development VC2030/" — thirteen .xlsx files, gitignored because
 *         they name real people and carry their grades.
 * Output: simulation-data/kpi-simulation.json, also gitignored, in the shape
 *         scripts/simulate-kpi.mjs expects.
 *
 * Two shapes live in that folder:
 *
 *   A TEAM tracker (Finance, Content, Design, Development, HR, Media, PR,
 *   Tech) has one sheet of tasks — Task, Member, Project, Assigned, Due,
 *   Completed, Status, Quality — and a small Task/Hours table off to the
 *   right in columns Z and AA that gives the hours for a task by name.
 *
 *   A PROJECT tracker (Shark Tank, Seen, افترض, خطى المملكة, Career Guidance
 *   Exhibition) has a "Raw Data" sheet holding several five-column blocks
 *   side by side — Source, Member, Target, Status, Type — one block per kind
 *   of target. Blocks are found by looking for "Source" along row 1 rather
 *   than by fixed positions, because the number of blocks differs per file.
 *
 * Six of the eight team trackers (Finance, Content, Design, Media, PR, Tech)
 * hold the same filled-in template: identical dates, identical
 * Excellent/Good/Poor ladder, only the task and member names swapped. They
 * are loaded anyway — the club asked for the whole set — and flagged in the
 * report so nobody mistakes them for logged work.
 */
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkbook } from './lib/xlsx.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const dirArg = args.indexOf('--dir');
const SRC = join(ROOT, dirArg === -1 ? 'Development VC2030' : args[dirArg + 1]);
const OUT = join(ROOT, 'simulation-data', 'kpi-simulation.json');

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** "AA" → 27. Column letters are base-26 with no zero. */
const colNum = (ref) => [...ref].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
/** 27 → "AA". */
function colRef(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - r) / 26);
  }
  return s;
}

/**
 * Excel keeps a date as days since 1899-12-30 (its leap-year bug included).
 * Anything that is not a bare number is returned as the text it already is.
 */
function asDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const serial = Number(value);
  if (serial < 20000 || serial > 80000) return null; // not a plausible date
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
}

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// The vocabularies the sheets use
// ---------------------------------------------------------------------------

/** Nine words, two of them misspellings, for seven states (0066). */
const STATUS = {
  '': 'new',
  contacted: 'waiting',
  'waiting for response': 'waiting',
  'in progress': 'in_progress',
  'in process': 'in_progress',
  'schedual a meeting': 'meeting',
  'scheduled a meeting': 'meeting',
  'schedule a meeting': 'meeting',
  'on hold': 'on_hold',
  confirmed: 'confirmed',
  rejected: 'rejected',
};

const QUALITY = { excellent: 'Excellent', 'very good': 'Very good', good: 'Good', poor: 'Poor' };

/** A type's column value → a stable key, and its two names. */
const TYPES = {
  company: ['company', 'Company', 'شركة'],
  companies: ['company', 'Company', 'شركة'],
  sponsor: ['sponsor', 'Sponsor', 'راعٍ'],
  sponsors: ['sponsor', 'Sponsor', 'راعٍ'],
  shark: ['shark', 'Shark', 'مستثمر'],
  talk: ['talk', 'Talk', 'محاضرة'],
  speaker: ['speaker', 'Speaker', 'متحدث'],
  venue: ['venue', 'Venue', 'مكان'],
  venues: ['venue', 'Venue', 'مكان'],
  workshop: ['workshop', 'Workshop', 'ورشة عمل'],
  workshops: ['workshop', 'Workshop', 'ورشة عمل'],
  planning: ['planning', 'Planning', 'تنظيم'],
  'event planner': ['planning', 'Planning', 'تنظيم'],
  partnership: ['partnership', 'Partnership', 'شراكة'],
  visit: ['visit', 'Visit', 'زيارة'],
  'career guidance': ['career_guidance', 'Career guidance', 'إرشاد مهني'],
};

/** Workbook → the club's own name for that project, as the seed matches it. */
const PROJECT_OF = {
  'Shark Tank KPI_': 'قروش',
  'Seen KPI_': 'سين',
  'افترض KPI_': 'افترض',
  'خطى المملكة KPI_': 'خطى المملكة',
  'Career Guidance Exhibition KPI': 'الإرشاد المهني',
};

/** Workbook → the club's team. "Tech" is the club's IT team. */
const TEAM_OF = {
  ' Finance KPI': 'Finance',
  'Finance KPI': 'Finance',
  'Content KPI': 'Content',
  'Design KPI': 'Design',
  'Development KPI': 'Development',
  'HR KPI': 'HR',
  'Media KPI': 'Media',
  'PR KPI': 'PR',
  'Tech KPI': 'IT',
};

/** The six workbooks whose rows are the same worked example. */
const TEMPLATES = new Set(['Finance', 'Content', 'Design', 'Media', 'PR', 'IT']);

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

function cellsOf(wb, sheet) {
  const map = new Map();
  for (const { row, cells } of wb.rows(sheet)) map.set(row, cells);
  return map;
}

function readTeam(file, team) {
  const wb = openWorkbook(file);
  const sheet = wb.sheetNames[0];
  const rows = cellsOf(wb, sheet);

  // Columns Z and AA: hours for a task, by the task's name.
  const hoursByTask = new Map();
  for (const [, c] of rows) {
    const name = clean(c.Z);
    const hours = Number(c.AA);
    if (name && name !== 'Task' && Number.isFinite(hours) && hours > 0) hoursByTask.set(name, hours);
  }

  const tasks = [];
  for (const [r, c] of rows) {
    if (r === 1) continue;
    const title = clean(c.A);
    if (!title) continue;
    const status = clean(c.G);
    tasks.push({
      team,
      title,
      member: clean(c.B) || null,
      project: clean(c.C) || null,
      assigned: asDate(c.D),
      due: asDate(c.E),
      completed: asDate(c.F),
      status: status || 'Not Started',
      quality: QUALITY[clean(c.H).toLowerCase()] ?? null,
      hours: hoursByTask.get(title) ?? null,
    });
  }
  return tasks;
}

function readProject(file, project) {
  const wb = openWorkbook(file);
  const rows = cellsOf(wb, 'Raw Data');
  const header = rows.get(1) ?? {};

  // Every column whose first row says "Source" starts a five-column block.
  const blocks = Object.entries(header)
    .filter(([, v]) => clean(v) === 'Source')
    .map(([ref]) => colNum(ref))
    .sort((a, b) => a - b);

  /*
   * The blank template these files were copied from leaves its own words
   * behind: an "Example" row at the top, and its column headings repeated
   * partway down the sheet. They look like targets and are not.
   */
  const PLACEHOLDER = new Set([
    'example', 'target', 'item', 'name', 'member', 'status', 'type', 'source',
    'venues', 'speaker name - date',
  ]);
  const isHeaderRow = (c, M, ST, TY) =>
    clean(c[M]) === 'Member' || clean(c[ST]) === 'Status' || clean(c[TY]) === 'Type';

  const targets = [];
  const types = new Map();
  const unknownStatus = new Map();
  for (const start of blocks) {
    const [S, M, T, ST, TY] = [0, 1, 2, 3, 4].map((i) => colRef(start + i));
    for (const [r, c] of rows) {
      if (r === 1) continue;

      // The kind of target is read from every row, the example included:
      // it is what the project chases, not something it has chased yet. A
      // project whose list is still empty still gets its types.
      const typeRaw = clean(c[TY]) || clean(c[S]);
      const type = TYPES[typeRaw.toLowerCase()];
      if (!type) continue;
      if (!types.has(type[0])) types.set(type[0], [type[1], type[2]]);

      const name = clean(c[T]);
      if (!name || PLACEHOLDER.has(name.toLowerCase())) continue;
      if (isHeaderRow(c, M, ST, TY)) continue;

      const raw = clean(c[ST]);
      const status = STATUS[raw.toLowerCase()];
      if (status === undefined) unknownStatus.set(raw, (unknownStatus.get(raw) ?? 0) + 1);

      targets.push({
        project,
        type: type[0],
        member: clean(c[M]) || null,
        target: name,
        // A status the sheet does not use — a stray name typed into the
        // column — means nobody recorded one, so the target starts at the top.
        status: status ?? 'new',
      });
    }
  }
  return { targets, types, unknownStatus };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const files = readdirSync(SRC).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$'));
const data = { note: '', projects: {}, tasks: [], outreach: [] };
const report = [];
const unknown = new Map();

for (const f of files.sort()) {
  const stem = basename(f, '.xlsx');
  const path = join(SRC, f);
  const project = PROJECT_OF[stem] ?? PROJECT_OF[stem.trim()];
  const team = TEAM_OF[stem] ?? TEAM_OF[stem.trim()];

  if (project) {
    const { targets, types, unknownStatus } = readProject(path, project);
    data.outreach.push(...targets);
    for (const [k, n] of unknownStatus) unknown.set(k, (unknown.get(k) ?? 0) + n);

    data.projects[project] = {
      types: [...types.entries()].map(([key, [en, ar]]) => [key, en, ar]),
    };
    report.push(`  ${stem.padEnd(34)} project ${project.padEnd(18)} ${String(targets.length).padStart(4)} targets · ${types.size} types`);
  } else if (team) {
    const tasks = readTeam(path, team);
    data.tasks.push(...tasks);
    const flag = TEMPLATES.has(team) ? '  ← the shared template' : '';
    report.push(`  ${stem.padEnd(34)} team    ${team.padEnd(18)} ${String(tasks.length).padStart(4)} tasks${flag}`);
  } else {
    report.push(`  ${stem.padEnd(34)} SKIPPED — not a tracker this script knows`);
  }
}

data.note = `Built from ${files.length} workbooks in "${basename(SRC)}" on ${new Date().toISOString().slice(0, 10)}. Local file, never committed.`;

console.log(report.join('\n'));
console.log(`\n${data.tasks.length} tasks, ${data.outreach.length} outreach targets, ${Object.keys(data.projects).length} projects.`);

const counts = (rows, key) =>
  [...rows.reduce((m, r) => m.set(r[key], (m.get(r[key]) ?? 0) + 1), new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(', ');
console.log(`  statuses: ${counts(data.outreach, 'status')}`);
console.log(`  task statuses: ${counts(data.tasks, 'status')}`);
if (unknown.size) {
  console.log(`  status words not in the sheets' vocabulary, read as "not contacted": ${[...unknown].map(([k, n]) => `"${k}" (${n})`).join(', ')}`);
}

if (DRY) {
  console.log('\nDry run. Nothing written.');
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\nWrote ${OUT}`);
}
