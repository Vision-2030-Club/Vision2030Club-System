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
  // Somebody on Design to actually do the work. Section 8 bars a Director from
  // confirming work they did themselves, so the two cannot be one person.
  dmember: { role: 'member', team: 'DESIGN', student: '493000006', national: '1930000006' },
  media: { role: 'team_director', team: 'MEDIA', student: '493000002', national: '1930000002' },
  mmember: { role: 'member', team: 'MEDIA', student: '493000007', national: '1930000007' },
  pm: { role: 'project_manager', team: 'CONTENT', student: '493000003', national: '1930000003' },
  member: { role: 'member', team: 'MEDIA', student: '493000004', national: '1930000004' },
  guest: { role: 'guest', team: 'CLUB_MGMT', student: '493000005', national: '1930000005' },
};

async function cleanUp() {
  await db.query(
    `delete from tasks where created_by in (select id from members where email like $1)
        or source_request_id in
          (select id from requests where submitted_by in
             (select id from members where email like $1))`,
    [`${PREFIX}%`],
  );
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

  const { rows: mediaType } = await db.query(
    `select id from request_types where key = 'media_request'`,
  );
  people.mediaTypeId = mediaType[0].id;

  const { rows: mediaTeam } = await db.query(`select id from teams where key = 'MEDIA'`);
  people.mediaTeamId = mediaTeam[0].id;

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

  // --- §1: accepting turns the request into ONE real task -------------------

  const acceptNoDates = await rpc(p.designer.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'in_progress',
  });
  check(
    'accepting without dates is refused',
    !acceptNoDates.ok && JSON.stringify(acceptNoDates.body).includes('starting_date'),
    JSON.stringify(acceptNoDates.body)?.slice(0, 90),
  );

  const accept = await rpc(p.designer.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'in_progress',
    p_patch: {
      starting_date: dateOnly(1),
      delivery_date: dateOnly(10),
      assignee_id: p.dmember.id,
    },
  });
  check('the Director accepts and sets the dates', accept.ok,
    JSON.stringify(accept.body)?.slice(0, 90));

  // Postgres hands a `date` back as a JS Date at local midnight, so reading it
  // through toISOString() lands on the previous day west of Riyadh. Format it
  // on the club's clock instead, the same way the app does.
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day10 = (v) => (v ? dayFmt.format(new Date(v)) : null);

  const { rows: made } = await db.query(
    `select t.id, t.team_id, t.project_id, t.due_date,
            (t.assigned_at at time zone 'Asia/Riyadh')::date as start_date,
            ta.member_id as assignee
       from tasks t left join task_assignees ta on ta.task_id = t.id
      where t.source_request_id = $1`,
    [requestId],
  );
  check('exactly one real task appears', made.length === 1, `${made.length} tasks`);
  const taskId = made[0]?.id;

  check(
    'Assigned Date is the Starting Date and Due Date is the Delivery Date (§1)',
    day10(made[0]?.start_date) === dateOnly(1) && day10(made[0]?.due_date) === dateOnly(10),
    JSON.stringify(made[0]),
  );
  check(
    'the task belongs to the team that does the work, not to the project',
    made[0]?.team_id === p.designTeamId && made[0]?.project_id === null,
    JSON.stringify(made[0]),
  );
  check('and it is assigned to whoever the Director picked', made[0]?.assignee === p.dmember.id);

  // --- §1: from here it is an ordinary task ---------------------------------

  const submitNoLink = await rpc(p.dmember.token, 'submit_task_for_review', { p_task: taskId });
  check(
    'submitting without a link is refused — these are delivered as links (§1)',
    !submitNoLink.ok && JSON.stringify(submitNoLink.body).includes('link'),
    JSON.stringify(submitNoLink.body)?.slice(0, 90),
  );

  const outsiderSubmit = await rpc(p.designer.token, 'submit_task_for_review', {
    p_task: taskId,
    p_url: 'https://example.test/not-mine',
  });
  check('only the assignee can submit it', !outsiderSubmit.ok);

  const submit1 = await rpc(p.dmember.token, 'submit_task_for_review', {
    p_task: taskId,
    p_url: 'https://example.test/poster-v1',
  });
  check('the assignee submits with a link', submit1.ok, JSON.stringify(submit1.body)?.slice(0, 90));

  const { rows: afterSubmit } = await db.query(
    `select status from requests where id = $1`,
    [requestId],
  );
  check(
    'submitting the task moves the REQUEST to review — no separate submit step',
    afterSubmit[0]?.status === 'in_review',
    `request is ${afterSubmit[0]?.status}`,
  );

  // --- §2 checkpoint 2: either side can ask to talk first --------------------

  const talkFirst = await rpc(p.media.token, 'transition_request', {
    p_request: requestId,
    p_to_status: 'awaiting_meeting',
    p_patch: {
      meeting_title: 'About the delivered poster',
      meeting_type: 'online',
      proposed_start: at(15),
    },
  });
  check(
    'the SUBMITTER can require a meeting about the delivered work (§2)',
    talkFirst.ok,
    JSON.stringify(talkFirst.body)?.slice(0, 90),
  );

  const { rows: secondMeeting } = await db.query(
    `select request_id from meeting_details where origin_request_id = $1
      order by created_at desc limit 1`,
    [requestId],
  );
  await rest(p.designer.token, `requests?id=eq.${secondMeeting[0]?.request_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved' }),
  });
  const { rows: resumedTwo } = await db.query(`select status from requests where id = $1`, [
    requestId,
  ]);
  check(
    'and confirming it returns the request to the review it left',
    resumedTwo[0]?.status === 'in_review',
    `request is ${resumedTwo[0]?.status}`,
  );

  // --- §1: rejecting sends it back with NEW dates ---------------------------

  const rejectNoDates = await rpc(p.designer.token, 'reject_task', {
    p_task: taskId,
    p_note: 'Logo too small',
  });
  check(
    'rejecting without new dates is refused (§1)',
    !rejectNoDates.ok && JSON.stringify(rejectNoDates.body).includes('date'),
    JSON.stringify(rejectNoDates.body)?.slice(0, 90),
  );

  const reject = await rpc(p.designer.token, 'reject_task', {
    p_task: taskId,
    p_note: 'Logo too small',
    p_start: dateOnly(12),
    p_due: dateOnly(20),
  });
  check('rejecting with new dates works', reject.ok, JSON.stringify(reject.body)?.slice(0, 90));

  const { rows: afterReject } = await db.query(
    `select t.due_date, (t.assigned_at at time zone 'Asia/Riyadh')::date as start_date,
            r.status as request_status
       from tasks t join requests r on r.id = t.source_request_id
      where t.id = $1`,
    [taskId],
  );
  check(
    'the old dates do not carry over — both are replaced',
    day10(afterReject[0]?.due_date) === dateOnly(20) &&
      day10(afterReject[0]?.start_date) === dateOnly(12),
    JSON.stringify(afterReject[0]),
  );
  check(
    'and the request follows the task back to In Progress',
    afterReject[0]?.request_status === 'in_progress',
    `request is ${afterReject[0]?.request_status}`,
  );

  // --- §1: confirming the task IS approving the request ---------------------

  await rpc(p.dmember.token, 'submit_task_for_review', {
    p_task: taskId,
    p_url: 'https://example.test/poster-v2',
  });

  const selfConfirm = await rpc(p.dmember.token, 'confirm_task', {
    p_task: taskId,
    p_quality: 'excellent',
  });
  check('the person who did the work cannot confirm it (§8)', !selfConfirm.ok);

  const confirm = await rpc(p.designer.token, 'confirm_task', {
    p_task: taskId,
    p_quality: 'excellent',
  });
  check('the Director confirms', confirm.ok, JSON.stringify(confirm.body)?.slice(0, 90));

  const { rows: done } = await db.query(
    `select r.status, r.data ->> 'required_date' as required, t.due_date,
            k.counts_toward_kpi, k.completion_score
       from requests r
       join tasks t on t.source_request_id = r.id
       join public.task_kpi k on k.id = t.id
      where r.id = $1`,
    [requestId],
  );
  check(
    'confirming the task approves the request — no second review step (§1)',
    done[0]?.status === 'approved',
    `request is ${done[0]?.status}`,
  );
  check(
    'the work counts toward KPI like any other task (§1)',
    done[0]?.counts_toward_kpi === true && done[0]?.completion_score !== null,
    JSON.stringify(done[0]),
  );
  check(
    'Required Date and the task Due Date stayed two different things (§3)',
    done[0]?.required === dateOnly(21) && day10(done[0]?.due_date) === dateOnly(20),
    JSON.stringify(done[0]),
  );

  // --- §1: leaving it unclaimed for the team --------------------------------

  const second = await submit(p.pm.token, p.pm.id);
  const secondId = second.body?.[0]?.id;
  await rpc(p.designer.token, 'transition_request', {
    p_request: secondId,
    p_to_status: 'in_progress',
    p_patch: { starting_date: dateOnly(1), delivery_date: dateOnly(9) },
  });
  const { rows: unclaimed } = await db.query(
    `select id from tasks where source_request_id = $1`,
    [secondId],
  );

  const claimByOutsider = await rpc(p.mmember.token, 'claim_task', {
    p_task: unclaimed[0]?.id,
  });
  check('somebody outside the team cannot claim it', !claimByOutsider.ok);

  const claim = await rpc(p.dmember.token, 'claim_task', { p_task: unclaimed[0]?.id });
  check(
    'a member of the team can claim work the Director left unassigned (§1)',
    claim.ok,
    JSON.stringify(claim.body)?.slice(0, 90),
  );

  const { rows: claimed } = await db.query(
    `select (assigned_at at time zone 'Asia/Riyadh')::date as start_date
       from tasks where id = $1`,
    [unclaimed[0]?.id],
  );
  check(
    'claiming does not overwrite the Starting Date the Director set',
    day10(claimed[0]?.start_date) === dateOnly(1),
    JSON.stringify(claimed[0]),
  );

  // --- §4: Media, both flavours ---------------------------------------------

  const media = (extra) =>
    rest(p.pm.token, 'requests', {
      method: 'POST',
      body: JSON.stringify({
        request_type_id: p.mediaTypeId,
        submitted_by: p.pm.id,
        status: 'pending_review',
        target_kind: 'team',
        target_team_id: p.mediaTeamId,
        data: {
          title: 'Career Fair coverage',
          priority: 'high',
          required_date: dateOnly(30),
          details: 'Photos and a highlight reel.',
          ...extra,
        },
      }),
    });

  const memberMedia = await rest(p.member.token, 'requests', {
    method: 'POST',
    body: JSON.stringify({
      request_type_id: p.mediaTypeId,
      submitted_by: p.member.id,
      status: 'pending_review',
      target_kind: 'team',
      target_team_id: p.mediaTeamId,
      data: { title: 'x', priority: 'low', required_date: dateOnly(30), details: 'x' },
    }),
  });
  check('a plain Member cannot submit a Media Request either', !allowed(memberMedia));

  const coverage = await media({ event_date: dateOnly(14) });
  check('event coverage can be submitted', allowed(coverage),
    JSON.stringify(coverage.body)?.slice(0, 90));
  const coverageId = coverage.body?.[0]?.id;

  const beforeEvent = await rpc(p.media.token, 'transition_request', {
    p_request: coverageId,
    p_to_status: 'in_progress',
    p_patch: { starting_date: dateOnly(10), delivery_date: dateOnly(12) },
  });
  check(
    'coverage cannot be due BEFORE the event it covers (§4)',
    !beforeEvent.ok,
    JSON.stringify(beforeEvent.body)?.slice(0, 100),
  );

  const afterEvent = await rpc(p.media.token, 'transition_request', {
    p_request: coverageId,
    p_to_status: 'in_progress',
    p_patch: {
      starting_date: dateOnly(10),
      delivery_date: dateOnly(21),
      assignee_id: p.mmember.id,
    },
  });
  check('…but may be delivered after it, with editing time (§4)', afterEvent.ok,
    JSON.stringify(afterEvent.body)?.slice(0, 100));

  const { rows: coverTask } = await db.query(
    `select due_date, team_id from tasks where source_request_id = $1`,
    [coverageId],
  );
  check(
    'the coverage task is due on the agreed delivery date, not the event date',
    day10(coverTask[0]?.due_date) === dateOnly(21),
    JSON.stringify(coverTask[0]),
  );
  check('and belongs to Media', coverTask[0]?.team_id === p.mediaTeamId);

  const standalone = await media({ title: 'Instagram reel' });
  const standaloneId = standalone.body?.[0]?.id;
  const standaloneAccept = await rpc(p.media.token, 'transition_request', {
    p_request: standaloneId,
    p_to_status: 'in_progress',
    p_patch: { starting_date: dateOnly(1), delivery_date: dateOnly(5) },
  });
  check(
    'standalone content has a freely chosen timeline (§4)',
    standaloneAccept.ok,
    JSON.stringify(standaloneAccept.body)?.slice(0, 90),
  );

  // --- the capability is opt-in: nothing else changed -----------------------

  const { rows: others } = await db.query(
    `select array_agg(key order by key) as keys from request_types where not creates_task`,
  );
  check(
    'every other request type is untouched by all this',
    (others[0].keys ?? []).sort().join(',') ===
      ['asset_request', 'it_ticket', 'meeting_request', 'money_request'].join(','),
    JSON.stringify(others[0].keys),
  );

  const { rows: noTask } = await db.query(
    `select count(*)::int n from tasks t
       join requests r on r.id = t.source_request_id
       join request_types rt on rt.id = r.request_type_id
      where not rt.creates_task`,
  );
  check('and none of them ever produced a task', noTask[0].n === 0);
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
