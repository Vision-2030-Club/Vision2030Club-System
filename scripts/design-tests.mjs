/**
 * Verification of the Design Request workflow (§7).
 *
 *   npm run db:design
 *
 * The two things worth proving here are not "the statuses exist":
 *
 *   1. Only Club Management can submit one, refused at the DATABASE, so
 *      calling the API directly gets a real permission error rather than a
 *      hidden button (§7 asks for both layers).
 *
 *   2. "Require Meeting" goes through the SHARED Meetings component and comes
 *      back. The design request parks, a real meeting appears with a real room
 *      hold, and confirming that meeting returns the design request to exactly
 *      where it left — with nothing in the Meetings component knowing what a
 *      design request is.
 *
 * Seeds its own people (`designtest-`) and room, then removes both.
 */
import pg from 'pg';

const {
  SUPABASE_DB_URL,
  NEXT_PUBLIC_SUPABASE_URL: API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
} = process.env;

for (const [name, value] of Object.entries({
  SUPABASE_DB_URL,
  NEXT_PUBLIC_SUPABASE_URL: API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
})) {
  if (!value) {
    console.error(`${name} is not set in .env.local.`);
    process.exit(1);
  }
}

const PASSWORD = 'design-tests-3a9f!';
const PREFIX = 'designtest-';
const ROOM_TAG = 'designtest room';

const db = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

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
  return { ok: response.ok, body: await response.json().catch(() => null) };
}

async function signIn(email) {
  const { body } = await adminFetch('token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return body?.access_token ?? null;
}

async function rest(token, path, options = {}) {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers ?? {}),
    },
  });
  return { status: response.status, ok: response.ok, body: await response.json().catch(() => null) };
}

async function rpc(token, name, args) {
  return rest(token, `rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}

const allowed = (r) => r.ok && Array.isArray(r.body) && r.body.length > 0;

const PEOPLE = {
  designer: { role: 'team_director', team: 'DESIGN', student: '493000001', national: '1930000001' },
  media: { role: 'team_director', team: 'MEDIA', student: '493000002', national: '1930000002' },
  pm: { role: 'project_manager', team: 'CONTENT', student: '493000003', national: '1930000003' },
  member: { role: 'member', team: 'MEDIA', student: '493000004', national: '1930000004' },
  guest: { role: 'guest', team: 'CLUB_MGMT', student: '493000005', national: '1930000005' },
};

async function cleanUp() {
  await db.query(
    `delete from calendar_entries where source_request_id in
       (select id from requests where submitted_by in
          (select id from members where email like $1))`,
    [`${PREFIX}%`],
  );
  await db.query(
    `delete from room_bookings where booked_by in (select id from members where email like $1)
        or room_id in (select id from rooms where name_en like $2)`,
    [`${PREFIX}%`, `${ROOM_TAG}%`],
  );
  // Meetings first: a design request is the origin of one.
  await db.query(
    `delete from requests where id in
       (select request_id from meeting_details where origin_request_id in
          (select id from requests where submitted_by in
             (select id from members where email like $1)))`,
    [`${PREFIX}%`],
  );
  await db.query(
    `delete from requests where submitted_by in (select id from members where email like $1)
        or target_member_id in (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(`delete from rooms where name_en like $1`, [`${ROOM_TAG}%`]);
  await db.query(
    `delete from member_sensitive where member_id in (select id from members where email like $1)`,
    [`${PREFIX}%`],
  );
  await db.query(`delete from members where email like $1`, [`${PREFIX}%`]);

  const { body } = await adminFetch('admin/users?per_page=200');
  for (const user of body?.users ?? []) {
    if (user.email?.startsWith(PREFIX)) {
      await adminFetch(`admin/users/${user.id}`, { method: 'DELETE' });
    }
  }
}

async function seed() {
  const people = {};
  for (const [name, spec] of Object.entries(PEOPLE)) {
    const email = `${PREFIX}${name}@example.test`;
    const created = await adminFetch('admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
    });
    if (!created.ok) throw new Error(`Could not create ${email}`);

    const { rows } = await db.query(
      `insert into members (auth_user_id, email, name_en, name_ar, student_id, team_id, role_id)
       values ($1, $2, $3, $3, $4,
               (select id from teams where key = $5),
               (select id from roles where key = $6))
       returning id`,
      [created.body.id, email, name, spec.student, spec.team, spec.role],
    );
    await db.query(`insert into member_sensitive (member_id, national_id) values ($1,$2)`, [
      rows[0].id,
      spec.national,
    ]);
    people[name] = { id: rows[0].id, email, token: await signIn(email) };
  }

  const { rows: room } = await db.query(
    `insert into rooms (name_en, name_ar) values ($1,$1) returning id`,
    [ROOM_TAG],
  );
  people.roomId = room[0].id;

  const { rows: type } = await db.query(
    `select id from request_types where key = 'design_request'`,
  );
  people.typeId = type[0].id;

  const { rows: designTeam } = await db.query(`select id from teams where key = 'DESIGN'`);
  people.designTeamId = designTeam[0].id;

  return people;
}

async function run(p) {
  const day = new Date();
  day.setDate(day.getDate() + 3);
  const dayText = day.toISOString().slice(0, 10);
  const at = (hour) => `${dayText}T${String(hour).padStart(2, '0')}:00:00+03:00`;
  const dateOnly = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const submit = (token, memberId, extra = {}) =>
    rest(token, 'requests', {
      method: 'POST',
      body: JSON.stringify({
        request_type_id: p.typeId,
        submitted_by: memberId,
        status: 'pending_review',
        target_kind: 'team',
        target_team_id: p.designTeamId,
        data: {
          priority: 'high',
          required_date: dateOnly(21),
          details: 'A poster for the opening event.',
          ...extra,
        },
      }),
    });

  // --- §7: only Club Management may submit ---------------------------------

  const byMember = await submit(p.member.token, p.member.id);
  check(
    'a plain Member cannot submit a Design Request, at the database',
    !allowed(byMember),
    JSON.stringify(byMember.body)?.slice(0, 90),
  );

  const byGuest = await submit(p.guest.token, p.guest.id);
  check('a Guest cannot submit one either', !allowed(byGuest));

  const byPm = await submit(p.pm.token, p.pm.id);
  check('a Project Manager can', allowed(byPm), JSON.stringify(byPm.body)?.slice(0, 90));

  const byDirector = await submit(p.media.token, p.media.id);
  check('a Team Director can', allowed(byDirector));
  const requestId = byDirector.body?.[0]?.id;

  // The gate is configuration, not a role test in code.
  const { rows: gate } = await db.query(
    `select submit_permission from request_types where key = 'design_request'`,
  );
  check(
    'the gate is a permission named on the type, not a role in code',
    gate[0]?.submit_permission === 'design_requests.submit',
    JSON.stringify(gate),
  );

  // --- §7: no In Progress without both dates -------------------------------

  const noDates = await rpc(p.designer.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'in_progress',
  });
  check(
    'accepting without dates is refused, naming what is missing',
    !noDates.ok &&
      JSON.stringify(noDates.body).includes('starting_date') &&
      JSON.stringify(noDates.body).includes('delivery_date'),
    JSON.stringify(noDates.body)?.slice(0, 100),
  );

  const submitterAccepts = await rpc(p.media.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'in_progress',
    p_patch: { starting_date: dateOnly(1), delivery_date: dateOnly(10) },
  });
  check(
    'the person who ASKED cannot accept their own request',
    !submitterAccepts.ok,
    JSON.stringify(submitterAccepts.body)?.slice(0, 90),
  );

  // --- §7: Require Meeting, through the shared component -------------------

  const requireMeeting = await rpc(p.designer.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'awaiting_meeting',
    p_patch: {
      meeting_title: 'About the poster',
      meeting_type: 'in_person',
      room_id: p.roomId,
      proposer_identity: `team:${p.designTeamId}`,
      proposed_start: at(14),
      proposed_end: at(15),
    },
  });
  check('the Design Director can require a meeting', requireMeeting.ok,
    JSON.stringify(requireMeeting.body)?.slice(0, 100));

  const { rows: parked } = await db.query(
    `select status, data ->> 'resume_status' as resume from requests where id = $1`,
    [requestId],
  );
  check(
    'the design request parks, remembering where to come back to',
    parked[0]?.status === 'awaiting_meeting' && parked[0]?.resume === 'pending_review',
    JSON.stringify(parked),
  );

  const { rows: spawned } = await db.query(
    `select d.request_id, r.target_kind, r.target_member_id, r.status, b.status as hold
       from meeting_details d
       join requests r on r.id = d.request_id
       left join room_bookings b on b.id = d.booking_id
      where d.origin_request_id = $1`,
    [requestId],
  );
  check(
    'a REAL meeting was created — aimed at the person who asked',
    spawned.length === 1 &&
      spawned[0].target_kind === 'individual' &&
      spawned[0].target_member_id === p.media.id,
    JSON.stringify(spawned),
  );
  check(
    '…and it holds the room, exactly like any other in-person meeting',
    spawned[0]?.hold === 'held',
    JSON.stringify(spawned),
  );

  const meetingId = spawned[0]?.request_id;

  // The Meetings component knows only "something spawned me".
  const { rows: coupling } = await db.query(
    `select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'app'
        and p.proname in ('hook_confirm_meeting', 'sync_meeting_hold', 'meeting_recipients')
        and pg_get_functiondef(p.oid) ilike '%design%'`,
  );
  check(
    'nothing in the Meetings component mentions design requests',
    coupling[0].n === 0,
    `${coupling[0].n} functions mention it`,
  );

  // --- confirming the meeting resumes the design request -------------------

  const confirmed = await rest(p.media.token, `requests?id=eq.${meetingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved' }),
  });
  check('the person it was aimed at can approve the meeting', allowed(confirmed),
    JSON.stringify(confirmed.body)?.slice(0, 90));

  const { rows: resumed } = await db.query(`select status from requests where id = $1`, [
    requestId,
  ]);
  check(
    'confirming the meeting sends the design request back where it left',
    resumed[0]?.status === 'pending_review',
    `status is ${resumed[0]?.status}`,
  );

  const { rows: booked } = await db.query(
    `select b.status from meeting_details d join room_bookings b on b.id = d.booking_id
      where d.request_id = $1`,
    [meetingId],
  );
  check(
    'and the room hold became a real booking, as for any meeting',
    booked[0]?.status === 'booked',
    JSON.stringify(booked),
  );

  // --- §7: the review / revision loop --------------------------------------

  await rpc(p.designer.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'in_progress',
    p_patch: { starting_date: dateOnly(1), delivery_date: dateOnly(10) },
  });

  const deliver = await rpc(p.designer.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'delivered',
    p_patch: { design_url: 'https://example.test/poster.pdf' },
  });
  check('Design can submit the deliverable', deliver.ok, JSON.stringify(deliver.body)?.slice(0, 90));

  const designerApproves = await rpc(p.designer.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'approved',
  });
  check(
    'Design cannot approve their own delivery — that is the submitter’s call',
    !designerApproves.ok,
    JSON.stringify(designerApproves.body)?.slice(0, 90),
  );

  const revision = await rpc(p.media.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'revision_required',
    p_patch: { revision_comments: 'The logo is too small.' },
  });
  check('the submitter can ask for changes', revision.ok, JSON.stringify(revision.body)?.slice(0, 90));

  // The commitment Design made is void the moment the work comes back (0036),
  // so the dates from the first acceptance must be GONE — otherwise
  // "still present" would satisfy the requirement without anyone re-committing.
  const { rows: cleared } = await db.query(
    `select data ? 'starting_date' as has_start, data ? 'delivery_date' as has_delivery
       from requests where id = $1`,
    [requestId],
  );
  check(
    'asking for changes voids the dates Design had committed to',
    cleared[0]?.has_start === false && cleared[0]?.has_delivery === false,
    JSON.stringify(cleared[0]),
  );

  const restartNoDates = await rpc(p.designer.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'in_progress',
  });
  check(
    'restarting after a revision needs NEW dates too, not just the first time',
    !restartNoDates.ok && JSON.stringify(restartNoDates.body).includes('delivery_date'),
    JSON.stringify(restartNoDates.body)?.slice(0, 90),
  );

  // Round the loop a second time, to show there is no cap (§7).
  for (let round = 0; round < 2; round += 1) {
    await rpc(p.designer.token, 'transition_request', {
      p_request: requestId,
      p_to_status: 'in_progress',
      p_patch: { starting_date: dateOnly(2), delivery_date: dateOnly(12) },
    });
    await rpc(p.designer.token, 'transition_request', {
      p_request: requestId,
      p_to_status: 'delivered',
      p_patch: { design_url: `https://example.test/poster-v${round + 2}.pdf` },
    });
    if (round === 0) {
      await rpc(p.media.token, 'transition_request', {
        p_request: requestId,
        p_to_status: 'revision_required',
        p_patch: { revision_comments: 'Once more.' },
      });
    }
  }

  const finalApprove = await rpc(p.media.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'approved',
  });
  check('the loop runs as many times as needed, then approves', finalApprove.ok,
    JSON.stringify(finalApprove.body)?.slice(0, 90));

  const { rows: final } = await db.query(
    `select r.status, r.data ->> 'required_date' as required, r.data ->> 'delivery_date' as delivery
       from requests r where r.id = $1`,
    [requestId],
  );
  check(
    'Required Date and Delivery Date are still two different things at the end',
    final[0]?.status === 'approved' &&
      final[0]?.required === dateOnly(21) &&
      final[0]?.delivery === dateOnly(12),
    JSON.stringify(final[0]),
  );

  const { rows: history } = await db.query(
    `select count(*)::int n from request_status_history where request_id = $1`,
    [requestId],
  );
  check(
    'every step was recorded, including the ones the system made',
    history[0].n >= 9,
    `${history[0].n} history rows`,
  );
}

await db.connect();
try {
  await cleanUp();
  await run(await seed());
} finally {
  await cleanUp();
  await db.end();
}

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
