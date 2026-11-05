/**
 * Verification of the Meetings component (§1–§5).
 *
 *   npm run db:meetings
 *
 * Same discipline as the other suites: assertions go through the REST API as a
 * signed-in person wherever the answer depends on who is asking, because the
 * UI can be bypassed and the rules have to hold at the layer an attacker
 * reaches. Setup uses the service role.
 *
 * What this is really proving is that the Meetings component has no logic of
 * its own about WHO or WHERE — the room hold follows the negotiation, and the
 * invite list and the calendar entry are the same function.
 *
 * Seeds its own people (`meettest-`) and room, then removes both.
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

const PASSWORD = 'meeting-tests-7c2e!';
const PREFIX = 'meettest-';
const ROOM_TAG = 'meettest room';
const ZONE = 'Asia/Riyadh';

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

const allowed = (r) => r.ok && Array.isArray(r.body) && r.body.length > 0;

/** The same REST surface, as the service role — what the server itself uses. */
async function serviceRest(path, options = {}) {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  return { status: response.status, ok: response.ok, body: await response.json().catch(() => null) };
}

const PEOPLE = {
  // Two Directors of the SAME team, so §5's "every Director, whichever one
  // negotiated" has something to prove.
  design1: { role: 'team_director', team: 'DESIGN', student: '492000001', national: '1920000001' },
  design2: { role: 'team_director', team: 'DESIGN', student: '492000002', national: '1920000002' },
  media: { role: 'team_director', team: 'MEDIA', student: '492000003', national: '1920000003' },
  pres: { role: 'president', team: 'CLUB_MGMT', student: '492000004', national: '1920000004' },
  vp: { role: 'vice_president', team: 'CLUB_MGMT', student: '492000005', national: '1920000005' },
  member: { role: 'member', team: 'DESIGN', student: '492000006', national: '1920000006' },
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

/*
 * The club can change its booking window whenever it likes — and has. A suite
 * that assumed noon-to-midnight started failing the day somebody set closing
 * to 21:00, which is a bug in the test, not in the system. So the window is
 * pinned for the run and put back afterwards, the same way db:prove flips a
 * permission row and reverts it.
 */
let savedWindow = null;

async function pinBookingWindow() {
  const { rows } = await db.query(
    `select opens_minute, closes_minute, days_ahead from booking_settings where id`,
  );
  savedWindow = rows[0];
  await db.query(
    `update booking_settings set opens_minute = 720, closes_minute = 1440, days_ahead = 14
      where id`,
  );
}

async function restoreBookingWindow() {
  if (!savedWindow) return;
  await db.query(
    `update booking_settings
        set opens_minute = $1, closes_minute = $2, days_ahead = $3
      where id`,
    [savedWindow.opens_minute, savedWindow.closes_minute, savedWindow.days_ahead],
  );
  savedWindow = null;
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

  const { rows: room2 } = await db.query(
    `insert into rooms (name_en, name_ar) values ($1,$1) returning id`,
    [`${ROOM_TAG} 2`],
  );
  people.roomId2 = room2[0].id;

  const { rows: t } = await db.query(
    `select key, id from teams where key in ('DESIGN','MEDIA')`,
  );
  people.teams = Object.fromEntries(t.map((r) => [r.key, r.id]));

  const { rows: type } = await db.query(
    `select id from request_types where key = 'meeting_request'`,
  );
  people.typeId = type[0].id;

  return people;
}

async function run(p) {
  const day = new Date();
  day.setDate(day.getDate() + 2);
  const dayText = day.toISOString().slice(0, 10);

  // Club wall-clock -> instant, the same way the app does it. Riyadh is +03.
  const at = (hour) => `${dayText}T${String(hour).padStart(2, '0')}:00:00+03:00`;

  const propose = (token, data, target) =>
    rest(token, 'requests', {
      method: 'POST',
      body: JSON.stringify({
        request_type_id: p.typeId,
        submitted_by: target.submitted_by,
        status: 'pending',
        data,
        ...target.route,
      }),
    });

  // --- §2: a meeting with one specific person -------------------------------

  const toPerson = await propose(
    p.design1.token,
    { title: 'One to one', meeting_type: 'online', proposed_start: at(13) },
    {
      submitted_by: p.design1.id,
      route: { target_kind: 'individual', target_member_id: p.media.id },
    },
  );
  check('a meeting can be aimed at one person', allowed(toPerson), JSON.stringify(toPerson.body));
  const personRequest = toPerson.body?.[0]?.id;

  const seenByTarget = await rest(p.media.token, `requests?id=eq.${personRequest}&select=id`);
  check(
    'the person it was aimed at can see it',
    (seenByTarget.body ?? []).length === 1,
    JSON.stringify(seenByTarget.body),
  );

  const seenByOther = await rest(p.member.token, `requests?id=eq.${personRequest}&select=id`);
  check(
    'somebody else cannot see it',
    (seenByOther.body ?? []).length === 0,
    JSON.stringify(seenByOther.body),
  );

  const actedByTarget = await rest(p.media.token, `requests?id=eq.${personRequest}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'under_review' }),
  });
  check(
    'the person it was aimed at may act on it',
    allowed(actedByTarget),
    JSON.stringify(actedByTarget.body),
  );

  // --- §4: the room is held from the moment it is submitted -----------------

  const inPerson = await propose(
    p.design1.token,
    {
      title: 'Design × Media sync',
      meeting_type: 'in_person',
      room_id: p.roomId,
      proposer_identity: `team:${p.teams.DESIGN}`,
      proposed_start: at(14),
      proposed_end: at(15),
    },
    {
      submitted_by: p.design1.id,
      route: { target_kind: 'team', target_team_id: p.teams.MEDIA },
    },
  );
  check('an in-person meeting can be proposed', allowed(inPerson), JSON.stringify(inPerson.body));
  const meetingId = inPerson.body?.[0]?.id;

  const { rows: held } = await db.query(
    `select b.status, b.starts_at, b.room_id
       from meeting_details d join room_bookings b on b.id = d.booking_id
      where d.request_id = $1`,
    [meetingId],
  );
  check(
    'submitting holds the room straight away',
    held[0]?.status === 'held' && held[0]?.room_id === p.roomId,
    JSON.stringify(held),
  );

  // Nobody else can take a held slot — the same constraint as any booking.
  const clash = await rest(p.pres.token, 'room_bookings', {
    method: 'POST',
    body: JSON.stringify({
      room_id: p.roomId,
      starts_at: at(14),
      ends_at: at(15),
      party_kind: 'presidency',
      booked_by: p.pres.id,
      title: 'Trying to take it',
    }),
  });
  check('nobody can book over a held slot', !allowed(clash), JSON.stringify(clash.body));

  // A second meeting proposing the same room and time must fail outright.
  const doubleProposal = await propose(
    p.pres.token,
    {
      title: 'Same slot',
      meeting_type: 'in_person',
      room_id: p.roomId,
      proposer_identity: 'presidency',
      proposed_start: at(14),
      proposed_end: at(15),
    },
    {
      submitted_by: p.pres.id,
      route: { target_kind: 'team', target_team_id: p.teams.DESIGN },
    },
  );
  check(
    'proposing a room somebody already holds fails the whole submission',
    !allowed(doubleProposal),
    JSON.stringify(doubleProposal.body),
  );

  // --- §2: the hold follows the negotiation --------------------------------

  const counter = await rest(p.media.token, `requests?id=eq.${meetingId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'under_review',
      data: {
        title: 'Design × Media sync',
        meeting_type: 'in_person',
        room_id: p.roomId,
        proposer_identity: `team:${p.teams.DESIGN}`,
        proposed_start: at(16),
        proposed_end: at(17),
      },
    }),
  });
  const { rows: moved } = await db.query(
    `select to_char(b.starts_at at time zone $2, 'HH24:MI') as t
       from meeting_details d join room_bookings b on b.id = d.booking_id
      where d.request_id = $1`,
    [meetingId, ZONE],
  );
  check(
    'countering to a new time moves the hold with it',
    counter.ok && moved[0]?.t === '16:00',
    `hold now at ${moved[0]?.t}`,
  );

  const { rows: freed } = await db.query(
    `select count(*)::int n from room_bookings
      where room_id = $1 and to_char(starts_at at time zone $2,'HH24:MI') = '14:00'`,
    [p.roomId, ZONE],
  );
  check('the old slot is released, not left held', freed[0].n === 0, `${freed[0].n} rows`);

  // --- §2 + 0033: a counter can change the ROOM, not only the time ----------
  //
  // This is what step 5 unlocked. Until `request_transitions.field_schema`
  // existed there was nowhere generic for a room input to live on a counter,
  // and hand-coding one into the shared request screen would have put meeting
  // logic in code every other type also runs through.

  const roomChange = await rest(p.media.token, `requests?id=eq.${meetingId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'countered_by_target',
      data: {
        title: 'Design × Media sync',
        meeting_type: 'in_person',
        room_id: p.roomId2,
        proposer_identity: `team:${p.teams.DESIGN}`,
        proposed_start: at(16),
        proposed_end: at(17),
      },
    }),
  });
  const { rows: movedRoom } = await db.query(
    `select b.room_id from meeting_details d join room_bookings b on b.id = d.booking_id
      where d.request_id = $1`,
    [meetingId],
  );
  check(
    'countering to a different room moves the hold to it',
    roomChange.ok && movedRoom[0]?.room_id === p.roomId2,
    JSON.stringify(roomChange.body)?.slice(0, 80),
  );

  const { rows: firstRoomFree } = await db.query(
    `select count(*)::int n from room_bookings where room_id = $1`,
    [p.roomId],
  );
  check(
    'and lets go of the first room entirely',
    firstRoomFree[0].n === 0,
    `${firstRoomFree[0].n} rows still on room 1`,
  );

  // Somebody takes room 2's next slot; countering into it must be refused.
  await rest(p.pres.token, 'room_bookings', {
    method: 'POST',
    body: JSON.stringify({
      room_id: p.roomId2,
      starts_at: at(19),
      ends_at: at(20),
      party_kind: 'presidency',
      booked_by: p.pres.id,
      title: 'Presidency has it',
    }),
  });
  const intoTakenRoom = await rest(p.design1.token, `requests?id=eq.${meetingId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'countered_by_requester',
      data: {
        title: 'Design × Media sync',
        meeting_type: 'in_person',
        room_id: p.roomId2,
        proposer_identity: `team:${p.teams.DESIGN}`,
        proposed_start: at(19),
        proposed_end: at(20),
      },
    }),
  });
  check(
    'countering into a slot somebody already has is refused',
    !allowed(intoTakenRoom),
    JSON.stringify(intoTakenRoom.body)?.slice(0, 90),
  );

  // Put it back where the rest of the suite expects it.
  await rest(p.design1.token, `requests?id=eq.${meetingId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'countered_by_requester',
      data: {
        title: 'Design × Media sync',
        meeting_type: 'in_person',
        room_id: p.roomId,
        proposer_identity: `team:${p.teams.DESIGN}`,
        proposed_start: at(16),
        proposed_end: at(17),
      },
    }),
  });

  // --- §5: who is party to it ----------------------------------------------

  const { rows: recipients } = await db.query(
    `select array_agg(name_en order by name_en) as names from app.meeting_recipients($1)`,
    [meetingId],
  );
  const names = recipients[0].names ?? [];
  check(
    'every Director of the target team is a recipient, not just the one who acted',
    names.includes('media'),
    names.join(', '),
  );
  check(
    "both of the proposer's own Directors are recipients (proposer side is symmetric)",
    names.includes('design1') && names.includes('design2'),
    names.join(', '),
  );
  check(
    'somebody with no part in it is not a recipient',
    !names.includes('member') && !names.includes('pres'),
    names.join(', '),
  );

  const { rows: presRecipients } = await db.query(
    `select array_agg(name_en order by name_en) as names
       from app.meeting_recipients($1)`,
    [personRequest],
  );
  check(
    'a meeting with one person reaches exactly the two of them',
    (presRecipients[0].names ?? []).sort().join(',') === 'design1,media',
    (presRecipients[0].names ?? []).join(', '),
  );

  // --- §2: confirmation -----------------------------------------------------

  const confirmed = await rest(p.media.token, `requests?id=eq.${meetingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved' }),
  });
  check('the target can approve', allowed(confirmed), JSON.stringify(confirmed.body));

  const { rows: booked } = await db.query(
    `select b.status, b.other_team_id, b.team_id
       from meeting_details d join room_bookings b on b.id = d.booking_id
      where d.request_id = $1`,
    [meetingId],
  );
  check(
    'approval turns the hold into a real booking',
    booked[0]?.status === 'booked',
    JSON.stringify(booked),
  );
  check(
    'the booking carries both sides, which is what makes "Design × Media"',
    booked[0]?.team_id === p.teams.DESIGN && booked[0]?.other_team_id === p.teams.MEDIA,
    JSON.stringify(booked),
  );

  const { rows: entry } = await db.query(
    `select id, title from calendar_entries where source_request_id = $1`,
    [meetingId],
  );
  check('approval writes exactly one calendar entry', entry.length === 1, `${entry.length}`);

  const { rows: audience } = await db.query(
    `select array_agg(m.name_en order by m.name_en) as names
       from calendar_entry_audiences a join members m on m.id = a.member_id
      where a.entry_id = $1`,
    [entry[0]?.id],
  );
  check(
    'the calendar entry is visible to exactly the meeting recipients (§2)',
    (audience[0]?.names ?? []).sort().join(',') === names.slice().sort().join(','),
    `entry: ${(audience[0]?.names ?? []).join(', ')} | recipients: ${names.join(', ')}`,
  );

  // §2/Flag 4: the entry is a projection of the meeting, not its own record.
  const editEntry = await rest(p.design1.token, `calendar_entries?id=eq.${entry[0]?.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ starts_at: at(20) }),
  });
  check(
    "a meeting's calendar entry cannot be dragged to another time",
    !allowed(editEntry),
    JSON.stringify(editEntry.body),
  );

  // --- §2: confirming when the room has gone --------------------------------
  //
  // The realistic version of this: the negotiation runs on, and by the time
  // the two sides agree, somebody else is in the room. §2 is explicit that
  // Confirm must FAIL rather than quietly confirming a meeting with nowhere
  // to be.

  const orphan = await propose(
    p.design1.token,
    {
      title: 'Room will vanish',
      meeting_type: 'in_person',
      room_id: p.roomId,
      proposer_identity: `team:${p.teams.DESIGN}`,
      proposed_start: at(18),
      proposed_end: at(19),
    },
    {
      submitted_by: p.design1.id,
      route: { target_kind: 'team', target_team_id: p.teams.MEDIA },
    },
  );
  const orphanId = orphan.body?.[0]?.id;

  await rest(p.media.token, `requests?id=eq.${orphanId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'under_review' }),
  });

  // The hold disappears and the Presidency takes the slot for real.
  await db.query(
    `delete from room_bookings where id =
       (select booking_id from meeting_details where request_id = $1)`,
    [orphanId],
  );
  const stolen = await rest(p.pres.token, 'room_bookings', {
    method: 'POST',
    body: JSON.stringify({
      room_id: p.roomId,
      starts_at: at(18),
      ends_at: at(19),
      party_kind: 'presidency',
      booked_by: p.pres.id,
      title: 'Got there first',
    }),
  });
  check('the freed slot can be taken by somebody else', allowed(stolen));

  const confirmWithoutRoom = await rest(p.media.token, `requests?id=eq.${orphanId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved' }),
  });
  check(
    'confirming when the room has gone fails, rather than confirming without it',
    !allowed(confirmWithoutRoom),
    JSON.stringify(confirmWithoutRoom.body)?.slice(0, 100),
  );

  const { rows: stillPending } = await db.query(
    `select status from requests where id = $1`,
    [orphanId],
  );
  check(
    'and the meeting is left un-approved, not half-confirmed',
    stillPending[0]?.status !== 'approved',
    `status is ${stillPending[0]?.status}`,
  );

  // --- §2/§3: switching to online releases the room and queues the link -----

  const online = await propose(
    p.design1.token,
    {
      title: 'Will go online',
      meeting_type: 'in_person',
      room_id: p.roomId,
      proposer_identity: `team:${p.teams.DESIGN}`,
      proposed_start: at(21),
      proposed_end: at(22),
    },
    {
      submitted_by: p.design1.id,
      route: { target_kind: 'team', target_team_id: p.teams.MEDIA },
    },
  );
  const onlineId = online.body?.[0]?.id;
  check('a meeting that will be moved online can be proposed', allowed(online),
    JSON.stringify(online.body)?.slice(0, 140));

  await rest(p.media.token, `requests?id=eq.${onlineId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'under_review',
      data: { title: 'Will go online', meeting_type: 'online', proposed_start: at(21) },
    }),
  });
  const { rows: released } = await db.query(
    `select booking_id from meeting_details where request_id = $1`,
    [onlineId],
  );
  check(
    'countering to online releases the room immediately',
    released[0]?.booking_id === null,
    JSON.stringify(released),
  );

  await rest(p.media.token, `requests?id=eq.${onlineId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved' }),
  });
  const { rows: meetState } = await db.query(
    `select meet_state from meeting_details where request_id = $1`,
    [onlineId],
  );
  check(
    'approving an online meeting queues the Meet link rather than calling Google in a trigger',
    meetState[0]?.meet_state === 'pending',
    JSON.stringify(meetState),
  );

  // --- §4: a Member cannot get a room by asking for a meeting ---------------

  const memberInPerson = await propose(
    p.member.token,
    {
      title: 'Member wants the room',
      meeting_type: 'in_person',
      room_id: p.roomId,
      proposer_identity: `team:${p.teams.DESIGN}`,
      proposed_start: at(12),
      proposed_end: at(13),
    },
    {
      submitted_by: p.member.id,
      route: { target_kind: 'team', target_team_id: p.teams.MEDIA },
    },
  );
  check(
    'a plain Member cannot hold a room by filing a meeting request',
    !allowed(memberInPerson),
    JSON.stringify(memberInPerson.body)?.slice(0, 90),
  );

  // --- §3: the Google connection is not reachable from the app --------------
  //
  // The refresh token is the club's Google account. `google_credentials` has
  // RLS enabled with no policies at all, which denies everyone; only the
  // service role can read it. These two checks are what stop that becoming
  // untrue by accident later.

  const credsAsAdmin = await rest(p.pres.token, 'google_credentials?select=refresh_token');
  check(
    'a signed-in President cannot read the Google refresh token',
    !credsAsAdmin.ok || (credsAsAdmin.body ?? []).length === 0,
    JSON.stringify(credsAsAdmin.body)?.slice(0, 80),
  );

  const payloadAsUser = await rest(p.design1.token, 'rpc/meeting_invite_payload', {
    method: 'POST',
    body: JSON.stringify({ p_request: meetingId }),
  });
  check(
    'a signed-in user cannot call meeting_invite_payload (it returns real emails)',
    !payloadAsUser.ok,
    `status ${payloadAsUser.status}`,
  );

  const payloadAsService = await serviceRest('rpc/meeting_invite_payload', {
    method: 'POST',
    body: JSON.stringify({ p_request: meetingId }),
  });
  const attendees = payloadAsService.body?.attendees ?? [];
  /*
   * Compare against the recipient list itself rather than against the
   * `meettest-` prefix. The prefix only worked while the club was empty. The
   * target team now has real elected Directors, and `app.meeting_recipients`
   * deliberately includes every Director of the target team — so a real
   * address appearing here is the rule working, not a leak.
   *
   * Set-equality is what this check always meant, and it keeps meaning it as
   * the club fills up.
   */
  const { rows: recipientRows } = await db.query(
    `select email from app.meeting_recipients($1)`,
    [meetingId],
  );
  const expectedEmails = [...new Set(recipientRows.map((r) => r.email))].sort();
  const gotEmails = [...new Set(attendees.map(String))].sort();
  check(
    'the server can build an invitation, and its attendees ARE the recipients',
    payloadAsService.ok &&
      gotEmails.length === expectedEmails.length &&
      gotEmails.every((email, i) => email === expectedEmails[i]),
    `attendees ${JSON.stringify(gotEmails)} vs recipients ${JSON.stringify(expectedEmails)}`,
  );

  const { rows: integrationScopes } = await db.query(
    `select r.key, rp.scope from role_permissions rp join roles r on r.id = rp.role_id
      where rp.permission_key = 'integrations.configure' and rp.scope <> 'none'`,
  );
  check(
    'only the Super Admin may connect the Google account',
    integrationScopes.length === 1 && integrationScopes[0].key === 'super_admin',
    JSON.stringify(integrationScopes),
  );

  // --- 0037: the booking group is worked out, not asked for -----------------

  const derived = await propose(
    p.design1.token,
    {
      title: 'No identity given',
      meeting_type: 'in_person',
      room_id: p.roomId2,
      // deliberately no proposer_identity
      proposed_start: at(12),
      proposed_end: at(13),
    },
    {
      submitted_by: p.design1.id,
      route: { target_kind: 'team', target_team_id: p.teams.MEDIA },
    },
  );
  const derivedId = derived.body?.[0]?.id;
  const { rows: derivedHold } = await db.query(
    `select d.proposer_party, b.team_id
       from meeting_details d left join room_bookings b on b.id = d.booking_id
      where d.request_id = $1`,
    [derivedId],
  );
  check(
    'a Director need not say which group books the room — it is derived',
    derived.ok &&
      derivedHold[0]?.proposer_party === `team:${p.teams.DESIGN}` &&
      derivedHold[0]?.team_id === p.teams.DESIGN,
    JSON.stringify(derivedHold[0]) ?? JSON.stringify(derived.body)?.slice(0, 90),
  );

  const { rows: formFields } = await db.query(
    `select field_schema @> '[{"key":"proposer_identity"}]'::jsonb as still_asks
       from request_types where key = 'meeting_request'`,
  );
  check(
    'and the form no longer asks',
    formFields[0]?.still_asks === false,
    JSON.stringify(formFields[0]),
  );

  // --- the identity picker offers only what the database would accept -------

  const designIdentities = await rest(p.design1.token, 'my_booking_identities?select=id');
  check(
    'a Director is offered only their own team to book as',
    (designIdentities.body ?? []).length === 1 &&
      designIdentities.body[0].id === `team:${p.teams.DESIGN}`,
    JSON.stringify(designIdentities.body),
  );

  const memberIdentities = await rest(p.member.token, 'my_booking_identities?select=id');
  check(
    'a plain Member is offered nothing to book as',
    (memberIdentities.body ?? []).length === 0,
    JSON.stringify(memberIdentities.body),
  );
}

await db.connect();
try {
  await pinBookingWindow();
  await cleanUp();
  await run(await seed());
} finally {
  await cleanUp();
  await restoreBookingWindow();
  await db.end();
}

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
