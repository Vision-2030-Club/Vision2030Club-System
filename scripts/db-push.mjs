/**
 * Applies supabase/migrations/*.sql to the database in SUPABASE_DB_URL.
 *
 *   npm run db:push
 *
 * Each file runs inside its own transaction and is recorded in the
 * `schema_migrations` table, so re-running only applies what is new.
 * Pass --redo <name> to re-run one file (useful for the seed files, which are
 * written to be safe to repeat).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error(
    'SUPABASE_DB_URL is not set.\n' +
      'Add it to .env.local — Supabase dashboard → Connect → Session pooler URI.',
  );
  process.exit(1);
}

const redoIndex = process.argv.indexOf('--redo');
const redo = redoIndex === -1 ? null : process.argv[redoIndex + 1];

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

const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

let count = 0;
for (const file of files) {
  if (applied.has(file) && file !== redo) continue;

  const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
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
console.log(count === 0 ? 'Already up to date.' : `Applied ${count} migration(s).`);
