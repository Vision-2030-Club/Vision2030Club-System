/**
 * Schedules the Mock Interviews jobs inside Supabase.
 *
 *   npm run interviews:cron              install or update the jobs
 *   npm run interviews:cron -- --off     remove them
 *   npm run interviews:cron -- --status  just show them
 *
 * Same mechanism as the push sweep (scripts/push-cron-setup.mjs): pg_cron in
 * the CLUB's Supabase project calls the deployed site with the CRON_SECRET
 * bearer token, kept in Vault. Two jobs:
 *
 *   interviews-sweep   /api/interviews/cron    every five minutes
 *   interviews-sheets  /api/interviews/sheets  every minute: Status edits in
 *                      the Google Sheets come back into the app
 *
 * The interviews project itself needs no scheduler — the routes reach it
 * with the service role.
 *
 * Needs, from .env.local: SUPABASE_DB_URL (the club database), CRON_SECRET,
 * and optionally PUSH_APP_URL (defaults to the production deployment).
 */
import pg from 'pg';

const {
  SUPABASE_DB_URL,
  CRON_SECRET,
  PUSH_APP_URL = 'https://vision2030club-system.vercel.app',
} = process.env;

const JOBS = [
  { name: 'interviews-sweep', schedule: '*/5 * * * *', path: '/api/interviews/cron' },
  { name: 'interviews-sheets', schedule: '* * * * *', path: '/api/interviews/sheets' },
];
const SECRET_NAME = 'push_cron_secret';

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

const db = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

try {
  if (off) {
    for (const { name } of JOBS) {
      const { rows } = await db.query(`select jobid from cron.job where jobname = $1`, [name]);
      if (rows.length) {
        await db.query(`select cron.unschedule($1)`, [name]);
        console.log(`Removed the ${name} job.`);
      } else {
        console.log(`No ${name} job to remove.`);
      }
    }
  } else if (!statusOnly) {
    await db.query(`create extension if not exists pg_cron`);
    await db.query(`create extension if not exists pg_net`);

    // The same secret the push sweep uses: one CRON_SECRET for every route.
    const { rows: existing } = await db.query(`select id from vault.secrets where name = $1`, [
      SECRET_NAME,
    ]);
    if (existing.length) {
      await db.query(`select vault.update_secret($1, $2)`, [existing[0].id, CRON_SECRET]);
    } else {
      await db.query(`select vault.create_secret($1, $2, $3)`, [
        CRON_SECRET,
        SECRET_NAME,
        'Bearer token the cron routes check. Set the same value as CRON_SECRET in Vercel.',
      ]);
    }

    for (const { name, schedule, path } of JOBS) {
      const command = `
        select net.http_get(
          url := '${PUSH_APP_URL.replace(/'/g, "''")}${path}',
          headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${SECRET_NAME}')
          ),
          timeout_milliseconds := 60000
        )`;
      await db.query(`select cron.schedule($1, $2, $3)`, [name, schedule, command]);
      console.log(`Scheduled ${name}: ${schedule} → ${PUSH_APP_URL}${path}`);
    }
  }

  for (const { name } of JOBS) {
    const { rows: jobs } = await db.query(
      `select jobid, schedule, active from cron.job where jobname = $1`,
      [name],
    );
    if (!jobs.length) {
      console.log(`\n${name}: not scheduled.`);
      continue;
    }
    const job = jobs[0];
    console.log(`\n${name}: job ${job.jobid}, ${job.schedule}, ${job.active ? 'active' : 'INACTIVE'}`);
    const { rows: runs } = await db.query(
      `select status, return_message, start_time
         from cron.job_run_details where jobid = $1
        order by start_time desc limit 3`,
      [job.jobid],
    );
    if (!runs.length) console.log('  no runs yet — the first is at the next scheduled mark.');
    for (const run of runs) {
      console.log(`  ${run.start_time.toISOString()}  ${run.status}  ${run.return_message ?? ''}`);
    }
  }
} finally {
  await db.end();
}
