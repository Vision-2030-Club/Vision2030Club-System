/**
 * Schedules the push sweep inside Supabase.
 *
 *   npm run push:cron            install or update the job
 *   npm run push:cron -- --off   remove it
 *   npm run push:cron -- --status  just show it
 *
 * Vercel's Hobby plan allows one cron a day, and a reminder for a meeting in
 * an hour cannot wait for tomorrow. Postgres has its own scheduler — pg_cron —
 * and pg_net lets it make an HTTP call, so the database that decides WHO is
 * told also decides WHEN the sweep runs. Every five minutes it calls
 * /api/push/cron on the deployed site with the same bearer token the route
 * checks (src/app/api/push/cron/route.ts).
 *
 * The token is kept in Supabase Vault, not in the job text, so `select * from
 * cron.job` does not show it. Needs, from .env.local:
 *
 *   SUPABASE_DB_URL   the same direct connection db:push uses
 *   CRON_SECRET       the value set in Vercel
 *   PUSH_APP_URL      optional; defaults to the production deployment
 */
import pg from 'pg';

const {
  SUPABASE_DB_URL,
  CRON_SECRET,
  PUSH_APP_URL = 'https://vision2030club-system.vercel.app',
} = process.env;

const JOB = 'push-sweep';
const SECRET_NAME = 'push_cron_secret';
const SCHEDULE = '*/5 * * * *';

const off = process.argv.includes('--off');
const statusOnly = process.argv.includes('--status');

if (!SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL is not set in .env.local.');
  process.exit(1);
}
if (!off && !statusOnly && !CRON_SECRET) {
  console.error('CRON_SECRET is not set in .env.local — it must match the value in Vercel.');
  process.exit(1);
}
if (!PUSH_APP_URL.startsWith('https://')) {
  console.error(`PUSH_APP_URL must be https://…, got ${PUSH_APP_URL}`);
  process.exit(1);
}

const db = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

try {
  if (off) {
    const { rows } = await db.query(`select jobid from cron.job where jobname = $1`, [JOB]);
    if (rows.length) {
      await db.query(`select cron.unschedule($1)`, [JOB]);
      console.log(`Removed the ${JOB} job.`);
    } else {
      console.log(`No ${JOB} job to remove.`);
    }
  } else if (!statusOnly) {
    // Both extensions ship with every Supabase project; this only turns them on.
    await db.query(`create extension if not exists pg_cron`);
    await db.query(`create extension if not exists pg_net`);

    const { rows: existing } = await db.query(
      `select id from vault.secrets where name = $1`,
      [SECRET_NAME],
    );
    if (existing.length) {
      await db.query(`select vault.update_secret($1, $2)`, [existing[0].id, CRON_SECRET]);
    } else {
      await db.query(`select vault.create_secret($1, $2, $3)`, [
        CRON_SECRET,
        SECRET_NAME,
        'Bearer token /api/push/cron checks. Set the same value as CRON_SECRET in Vercel.',
      ]);
    }

    // Runs as the role that scheduled it (postgres), which may read the vault.
    // http_get is asynchronous: the call is queued and the response lands in
    // net._http_response, which --status reads back.
    const command = `
      select net.http_get(
        url := '${PUSH_APP_URL.replace(/'/g, "''")}/api/push/cron',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${SECRET_NAME}')
        ),
        timeout_milliseconds := 60000
      )`;

    // cron.schedule with a name replaces an existing job of that name.
    await db.query(`select cron.schedule($1, $2, $3)`, [JOB, SCHEDULE, command]);
    console.log(`Scheduled ${JOB}: ${SCHEDULE} → ${PUSH_APP_URL}/api/push/cron`);
  }

  // --- status ---------------------------------------------------------------

  const { rows: jobs } = await db.query(
    `select jobid, schedule, active from cron.job where jobname = $1`,
    [JOB],
  );
  if (!jobs.length) {
    console.log(`\n${JOB}: not scheduled.`);
  } else {
    const job = jobs[0];
    console.log(`\n${JOB}: job ${job.jobid}, ${job.schedule}, ${job.active ? 'active' : 'INACTIVE'}`);

    const { rows: runs } = await db.query(
      `select status, return_message, start_time
         from cron.job_run_details where jobid = $1
        order by start_time desc limit 3`,
      [job.jobid],
    );
    if (!runs.length) {
      console.log('  no runs yet — the first is at the next five-minute mark.');
    }
    for (const run of runs) {
      console.log(`  ${run.start_time.toISOString()}  ${run.status}  ${run.return_message ?? ''}`);
    }

    const { rows: responses } = await db.query(
      `select status_code, created, left(content::text, 160) as body
         from net._http_response
        order by created desc limit 3`,
    );
    for (const r of responses) {
      console.log(`  → ${r.created.toISOString()}  HTTP ${r.status_code ?? '—'}  ${r.body ?? ''}`);
    }
  }
} finally {
  await db.end();
}
