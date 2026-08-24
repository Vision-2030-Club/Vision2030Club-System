/**
 * Puts the semester timeline into the club calendar.
 *
 *   node --env-file=.env.local scripts/import-timeline.mjs [--sheet 1] [--dry]
 *
 * Reads `First Semester Timeline- 26_48 (1).xlsx`. That workbook has ten
 * sheets — one per team — laid out as alternating rows: a row of dates, then a
 * row of labels for those dates. Sheet 1 is the club-wide one.
 *
 * Idempotent: an entry with the same title on the same day is left alone, so
 * running it twice does not double the calendar.
 *
 * Cells holding a bare number rather than text are skipped and listed. They
 * are not event names — they look like references to something outside this
 * file, and guessing at them would put nonsense in 99 people's calendars.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import pg from 'pg';

const FILE = 'First Semester Timeline- 26_48 (1).xlsx';
const sheetArg = process.argv.indexOf('--sheet');
const SHEET = sheetArg === -1 ? 1 : Number(process.argv[sheetArg + 1]);
const DRY = process.argv.includes('--dry');

// Events are all-day; these bound them on the club's clock.
const ZONE = 'Asia/Riyadh';

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

const parts = readZip(FILE);

const shared = [];
for (const si of (parts['xl/sharedStrings.xml'] ?? '').match(/<si>[\s\S]*?<\/si>/g) ?? []) {
  shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
}

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const sheetXml = parts[`xl/worksheets/sheet${SHEET}.xml`];
if (!sheetXml) {
  console.error(`No sheet ${SHEET} in ${FILE}.`);
  process.exit(1);
}

const rows = new Map();
for (const [, rnum, body] of sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const cells = {};
  for (const [, ref, attrs, inner] of body.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    const isShared = attrs.includes('t="s"');
    let value = '';
    if (isShared && v) value = shared[Number(v[1])] ?? '';
    else if (t) value = t[1];
    else if (v) value = v[1];
    cells[ref] = { text: decode(value).trim(), isText: isShared || Boolean(t) };
  }
  rows.set(Number(rnum), cells);
}

/** Excel serial → ISO date. Day 0 is 1899-12-30 in Excel's calendar. */
function serialToDate(serial) {
  const ms = Date.UTC(1899, 11, 30) + Number(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const COLS = 'ABCDEFGH'.split('');
const events = [];
const skipped = [];

for (const rnum of [...rows.keys()].sort((a, b) => a - b)) {
  const labels = rows.get(rnum);
  if (!labels.A?.text?.toUpperCase().startsWith('WEEK')) continue;

  // The row above holds this week's dates, in the same columns.
  const dates = rows.get(rnum - 1) ?? {};
  const week = labels.A.text;

  for (const col of COLS) {
    if (col === 'A') continue; // holds "WEEK n", not an event
    const cell = labels[col];
    if (!cell?.text) continue;

    if (!cell.isText) {
      skipped.push(`${week} column ${col}: ${cell.text}`);
      continue;
    }

    // Column B has no date of its own — it is the week's headline item, so it
    // is anchored to the week's first day.
    const serial = dates[col]?.text || (col === 'B' ? dates.A?.text : '');
    if (!serial) continue;

    events.push({ date: serialToDate(serial), week, title: cell.text });
  }
}

events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

console.log(`\nSheet ${SHEET}: ${events.length} dated events\n`);
for (const e of events) console.log(`  ${e.date}  ${e.week.padEnd(8)} ${e.title}`);

if (skipped.length > 0) {
  console.log(`\n${skipped.length} cell(s) skipped — a bare number, not an event name:`);
  for (const s of skipped) console.log(`  ${s}`);
  console.log('If any of these are real events, put the name in the cell and re-run.');
}

if (DRY) {
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

// ---------------------------------------------------------------------------

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const { rows: admin } = await db.query(
  `select m.id from members m join roles r on r.id = m.role_id
    where r.key in ('super_admin','president') order by r.sort_order limit 1`,
);
if (!admin[0]) {
  console.error('\nNo Super Admin or President to own these entries.');
  process.exit(1);
}

let created = 0;
let existing = 0;

for (const e of events) {
  /*
   * `kind = 'club'` is the whole point: 0007's select policy lets any signed-in
   * person read a club entry, so the semester plan is visible to all 98
   * members without an audience row each. A meeting-kind entry would need one.
   */
  const { rows: dupe } = await db.query(
    `select id from calendar_entries
      where kind = 'club' and title = $1
        and (starts_at at time zone $2)::date = $3::date`,
    [e.title, ZONE, e.date],
  );

  if (dupe.length > 0) { existing += 1; continue; }

  await db.query(
    `insert into calendar_entries
       (kind, title, starts_at, ends_at, all_day, category, color, created_by)
     values ('club', $1,
             ($2 || ' 00:00:00 ' || $4)::timestamptz,
             ($3 || ' 00:00:00 ' || $4)::timestamptz,
             true, 'semester', '#0b4f5f', $5)`,
    [e.title, e.date, nextDay(e.date), ZONE, admin[0].id],
  );
  created += 1;
}

function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

console.log(`\nAdded ${created} entr${created === 1 ? 'y' : 'ies'}; ${existing} already there.`);
await db.end();
