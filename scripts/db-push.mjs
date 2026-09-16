/**
 * Applies a migrations folder to a database.
 *
 *   npm run db:push                          the club database (supabase/migrations)
 *   npm run db:push -- --target interviews   the Mock Interviews database
 *                                            (supabase/interviews/migrations)
 *
 * Each file runs inside its own transaction and is recorded in the
 * `schema_migrations` table of THAT database, so re-running only applies what
 * is new. Pass --redo <name> to re-run one file (useful for the seed files,
 * which are written to be safe to repeat).
 *
 * The two targets are two Supabase projects with two connection strings —
 * SUPABASE_DB_URL and INTERVIEWS_SUPABASE_DB_URL — and nothing here can apply
 * one folder to the other project's database: the folder and the variable are
 * chosen together from TARGETS below.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = {
  club: {
    dir: join(ROOT, 'supabase', 'migrations'),
    env: 'SUPABASE_DB_URL',
    hint: 'Supabase dashboard → Connect → Session pooler URI.',
  },
  interviews: {
    dir: join(ROOT, 'supabase', 'interviews', 'migrations'),
    env: 'INTERVIEWS_SUPABASE_DB_URL',
    hint: 'the Mock Interviews project → Connect → Session pooler URI.',
  },
};

const args = process.argv.slice(2);
const targetIndex = args.indexOf('--target');
const targetName = targetIndex === -1 ? 'club' : args[targetIndex + 1];
const target = TARGETS[targetName];
if (!target) {
  console.error(`Unknown target "${targetName}". Use one of: ${Object.keys(TARGETS).join(', ')}.`);
  process.exit(1);
}

const connectionString = process.env[target.env];
if (!connectionString) {
  console.error(`${target.env} is not set.\nAdd it to .env.local — ${target.hint}`);
  process.exit(1);
}

const redoIndex = args.indexOf('--redo');
const redo = redoIndex === -1 ? null : args[redoIndex + 1];

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

await client.query(`
  create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`);

const { rows } = await client.query('select name from schema_migrations');
const applied = new Set(rows.map((r) => r.name));

const files = (await readdir(target.dir)).filter((f) => f.endsWith('.sql')).sort();

let count = 0;
for (const file of files) {
  if (applied.has(file) && file !== redo) continue;

  const sql = await readFile(join(target.dir, file), 'utf8');
  process.stdout.write(`→ ${file} `);

  try {
    await client.query('begin');
    await client.query(sql);
    await client.query(
      'insert into schema_migrations (name) values ($1) on conflict (name) do update set applied_at = now()',
      [file],
    );
    await client.query('commit');
    console.log('ok');
    count++;
  } catch (error) {
    await client.query('rollback');
    console.log('FAILED');
    console.error(`\n${error.message}`);
    if (error.hint) console.error(`hint: ${error.hint}`);
    if (error.position) {
      const upto = sql.slice(0, Number(error.position));
      console.error(`at line ${upto.split('\n').length}`);
    }
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(
  count === 0
    ? `${targetName}: already up to date.`
    : `${targetName}: applied ${count} migration(s).`,
);
