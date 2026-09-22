/**
 * Loads the teams' KPI sheets into the live system, so the directors can
 * compare the KPI page and the Outreach page with the trackers they know.
 *
 *   npm run kpi:simulate                     validate and print the plan (dry run)
 *   npm run kpi:simulate -- --yes            write
 *   npm run kpi:simulate -- --undo           remove everything the last run created
 *   npm run kpi:simulate -- --yes --skip-unmatched
 *                                            write, leaving out rows whose member or
 *                                            project could not be matched
 *   npm run kpi:simulate -- --confirmer you@club.sa
 *                                            who confirms a task when its team has
 *                                            no Director and its project no manager
 *
 * Input: simulation-data/kpi-simulation.json — built from the five sheet PDFs,
 * gitignored because it names real people and their grades. Shape:
 *
 *   { "projects": { "<name>": { "types": [[key, name_en, name_ar], …] } },
 *     "tasks":    [{ team, title, member, project, assigned, due, completed,
 *                    status, quality, hours }],
 *     "outreach": [{ project, type, member, target, status }] }
 *
 * Every task it creates carries "[simulation kpi-sheets-2026-09]" at the top
 * of its description, every target the same text in its notes, and the ids of
 * everything written go to simulation-data/last-run.json — `--undo` reads that
 * file and deletes exactly those rows, nothing else.
 *
 * Dates come from the sheets. Where a sheet says "Completed Late" but has no
 * due date, the due date is set to the day before delivery, so the system
 * scores it late as the sheet did. "Delayed" with no due date gets one three
 * days after assignment, which is in the past today, so the task reads as
 * overdue. "Not Started" rows become open tasks nobody holds yet (the sheet's
 * member is named in the description), so they read as Not Started here too.
 *
 * Writes go through PostgREST with the service-role key: `import_task_history`
 * (0064) is service-role only and is what stamps the historical dates.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'simulation-data', 'kpi-simulation.json');
const LAST = join(ROOT, 'simulation-data', 'last-run.json');
const TAG = '[simulation kpi-sheets-2026-09]';
const ZONE_OFFSET = '+03:00'; // Asia/Riyadh, no daylight saving

const { NEXT_PUBLIC_SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } = process.env;
for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })) {
  if (!value) {
    console.error(`${name} is not set in .env.local.`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const WRITE = args.includes('--yes');
const UNDO = args.includes('--undo');
const SKIP_UNMATCHED = args.includes('--skip-unmatched');
const option = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
};

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(path, init = {}) {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...HEADERS, Prefer: 'return=representation', ...(init.headers ?? {}) },
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

const get = (path) => rest(path);
const post = (path, body, prefer) =>
  rest(path, { method: 'POST', body: JSON.stringify(body), headers: prefer ? { Prefer: prefer } : {} });
const rpc = (name, body) => rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
const del = (path) => rest(path, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Matching people and projects by the names the sheets use
// ---------------------------------------------------------------------------

const fold = (s) =>
  (s ?? '')
    .normalize('NFKC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[ھ]/g, 'ه')
    .replace(/[یى]/g, 'ي')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function findMember(members, name, teamKeyHint) {
  const wanted = fold(name);
  if (!wanted) return null;
  const parts = wanted.split(' ');
  const scored = members
    .map((m) => {
      const en = fold(m.name_en);
      const ar = fold(m.name_ar);
      let score = 0;
      if (en === wanted || ar === wanted) score = 100;
      else if (en.startsWith(wanted + ' ') || ar.startsWith(wanted + ' ')) score = 80;
      else if (parts.every((p) => en.includes(p))) score = 60;
      else if (parts[0] && en.split(' ')[0] === parts[0]) score = 30;
      if (score && teamKeyHint && m.team_key === teamKeyHint) score += 5;
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].score < 100) {
    return { ambiguous: scored.slice(0, 3).map((x) => x.m) };
  }
  return scored[0].m;
}

function findProject(projects, name) {
  const wanted = fold(name);
  if (!wanted) return null;
  const hit =
    projects.find((p) => fold(p.name_ar) === wanted || fold(p.name_en) === wanted) ??
    projects.find((p) => fold(p.name_ar).includes(wanted) || fold(p.name_en).includes(wanted)) ??
    projects.find((p) => wanted.includes(fold(p.name_en)) && fold(p.name_en).length > 3);
  return hit ?? null;
}

function findTeam(teams, name) {
  const wanted = fold(name);
  return (
    teams.find((t) => fold(t.key) === wanted || fold(t.name_en) === wanted) ??
    teams.find((t) => fold(t.name_en).includes(wanted) || wanted.includes(fold(t.key))) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Dates: the sheet's day, at a sensible hour on the club's clock
// ---------------------------------------------------------------------------

const at = (day, hour) => (day ? `${day}T${String(hour).padStart(2, '0')}:00:00${ZONE_OFFSET}` : null);
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const QUALITY = { excellent: 'excellent', 'very good': 'very_good', good: 'good', poor: 'poor' };

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

async function undo() {
  let last;
  try {
    last = JSON.parse(await readFile(LAST, 'utf8'));
  } catch {
    console.error(`Nothing to undo: ${LAST} not found.`);
    process.exit(1);
  }
  console.log(`Undoing the run of ${last.at}…`);
  for (const id of last.tasks ?? []) await del(`tasks?id=eq.${id}`);
  console.log(`  ${last.tasks?.length ?? 0} tasks deleted (assignees and scores go with them)`);
  for (const id of last.targets ?? []) await del(`outreach_targets?id=eq.${id}`);
  console.log(`  ${last.targets?.length ?? 0} outreach targets deleted`);
  for (const { project_id, key } of last.types ?? []) {
    try {
      await del(`outreach_types?project_id=eq.${project_id}&key=eq.${key}`);
    } catch {
      /* in use by targets the team added since — leave it */
    }
  }
  for (const project_id of last.components ?? []) {
    await del(`project_components?project_id=eq.${project_id}&component_key=eq.outreach`);
  }
  console.log(`  ${last.components?.length ?? 0} outreach components detached`);
  await writeFile(LAST, JSON.stringify({ ...last, undone_at: new Date().toISOString() }, null, 2));
  console.log('Done.');
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  if (UNDO) return undo();

  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const [members, projects, teams, managers, roles] = await Promise.all([
    get('members?select=id,name_en,name_ar,team_id,role_id,status&status=eq.active&limit=2000'),
    get('projects?select=id,name_en,name_ar,owning_team_id&limit=500'),
    get('teams?select=id,key,name_en,name_ar'),
    get('project_managers?select=project_id,member_id&limit=5000'),
    get('roles?select=id,key'),
  ]);
  const teamKey = new Map(teams.map((t) => [t.id, t.key]));
  const roleKey = new Map(roles.map((r) => [r.id, r.key]));
  for (const m of members) {
    m.team_key = teamKey.get(m.team_id);
    m.role_key = roleKey.get(m.role_id);
  }

  const fallbackEmail = option('--confirmer');
  let fallback = null;
  if (fallbackEmail) {
    const rows = await get(`members?select=id,name_en&email=eq.${encodeURIComponent(fallbackEmail)}`);
    fallback = rows[0] ?? null;
    if (!fallback) throw new Error(`No member with email ${fallbackEmail}`);
  }

  const directorOf = (teamId) =>
    members.find((m) => m.team_id === teamId && m.role_key === 'team_director') ?? null;
  const managerOf = (projectId) => {
    const row = managers.find((r) => r.project_id === projectId);
    return row ? (members.find((m) => m.id === row.member_id) ?? null) : null;
  };

  const problems = [];
  const notMembers = new Map();
  const plan = { tasks: [], targets: [], types: [], components: [] };

  // ---- tasks -------------------------------------------------------------
  for (const [i, row] of data.tasks.entries()) {
    const label = `${row.team} #${i + 1} "${row.title}"`;
    const team = findTeam(teams, row.team);
    if (!team) {
      problems.push(`${label}: no team called ${row.team}`);
      continue;
    }
    let member = null;
    if (row.member) {
      member = findMember(members, row.member, team.key);
      if (!member) {
        problems.push(`${label}: member "${row.member}" not found`);
        continue;
      }
      if (member.ambiguous) {
        problems.push(`${label}: "${row.member}" matches several: ${member.ambiguous.map((m) => m.name_en).join(', ')}`);
        continue;
      }
    }
    let project = null;
    if (row.project && fold(row.project) !== fold('النادي')) {
      project = findProject(projects, row.project);
      if (!project) {
        problems.push(`${label}: project "${row.project}" not found`);
        continue;
      }
    }
    const confirmer = (project && managerOf(project.id)) ?? directorOf(team.id) ?? fallback;
    const status = (row.status ?? 'Not Started').toLowerCase();
    const finished = status.startsWith('completed');
    if (finished && !confirmer) {
      problems.push(`${label}: nobody to confirm it — ${team.name_en} has no Director; pass --confirmer`);
      continue;
    }

    let due = row.due;
    if (!due && status === 'completed late' && row.completed) due = addDays(row.completed, -1);
    if (!due && status === 'delayed' && row.assigned) due = addDays(row.assigned, 3);

    plan.tasks.push({
      label,
      title: row.title,
      description: `${TAG} ${row.team} sheet${row.member ? ` · ${row.member}` : ''}`,
      project_id: project?.id ?? null,
      team_id: project ? null : team.id,
      due_date: due ?? null,
      created_by: confirmer?.id ?? member?.id ?? null,
      // "Not Started" is posted for claiming; anything else is held.
      assignee: status === 'not started' ? null : member?.id ?? null,
      history: finished
        ? {
            p_assigned_at: at(row.assigned, 10),
            p_submitted_at: at(row.completed ?? row.assigned, 14),
            p_confirmed_at: at(row.completed ?? row.assigned, 16),
            p_confirmed_by: confirmer.id,
            p_quality: QUALITY[(row.quality ?? 'good').toLowerCase()] ?? 'good',
            p_hours: row.hours ?? null,
            p_submission_note: `Imported from the ${row.team} KPI sheet`,
          }
        : row.assigned
          ? { p_assigned_at: at(row.assigned, 10), p_hours: row.hours ?? null }
          : null,
      sheet: row,
    });
  }

  // ---- outreach ----------------------------------------------------------
  const projectByName = new Map();
  for (const name of Object.keys(data.projects ?? {})) {
    const project = findProject(projects, name);
    if (!project) {
      problems.push(`outreach: project "${name}" not found`);
      continue;
    }
    projectByName.set(name, project);
    plan.components.push(project.id);
    for (const [key, name_en, name_ar] of data.projects[name].types) {
      plan.types.push({ project_id: project.id, key, name_en, name_ar });
    }
  }
  for (const row of data.outreach ?? []) {
    const project = projectByName.get(row.project);
    if (!project) continue;
    if (/example/i.test(row.target)) continue;
    // The sheets name people who are not club members (a graduate, a friend
    // of the project). That is not an error: the target is loaded with no
    // owner and the sheet's name kept in its notes, so nothing is lost and
    // a manager can hand it to a member later.
    let owner = null;
    let ownerNote = '';
    if (row.member) {
      owner = findMember(members, row.member, null);
      if (!owner || owner.ambiguous) {
        notMembers.set(row.member, (notMembers.get(row.member) ?? 0) + 1);
        owner = null;
        ownerNote = ` · sheet owner: ${row.member}`;
      }
    }
    plan.targets.push({
      project_id: project.id,
      type_key: row.type,
      name: row.target.normalize('NFKC'),
      owner_id: owner?.id ?? null,
      status: row.status ?? 'new',
      notes: `${TAG}${ownerNote}`,
      created_by: owner?.id ?? managerOf(project.id)?.id ?? fallback?.id ?? null,
    });
  }

  // ---- report ------------------------------------------------------------
  console.log(`Plan: ${plan.tasks.length} tasks, ${plan.targets.length} outreach targets, ${plan.types.length} types on ${plan.components.length} projects.`);
  for (const t of plan.tasks) {
    console.log(
      `  task  ${t.label.padEnd(50)} → ${t.project_id ? 'project' : 'team'} · ${t.assignee ? 'held' : 'open'} · due ${t.due_date ?? '—'} · ${t.history?.p_confirmed_at ? `confirmed (${t.history.p_quality}${t.history.p_hours ? `, ${t.history.p_hours}h` : ''})` : t.history ? 'in progress' : 'not started'}`,
    );
  }
  const byOwner = new Map();
  for (const x of plan.targets) byOwner.set(x.owner_id, (byOwner.get(x.owner_id) ?? 0) + 1);
  console.log(`  outreach owners: ${[...byOwner.entries()].map(([id, n]) => `${members.find((m) => m.id === id)?.name_en ?? 'nobody'}=${n}`).join(', ')}`);
  if (notMembers.size) {
    console.log(
      `  named in the sheet but not club members (kept in the notes, no owner): ${[...notMembers.entries()].map(([name, n]) => `${name} (${n})`).join(', ')}`,
    );
  }

  if (problems.length) {
    console.log(`\n${problems.length} rows could not be matched:`);
    for (const p of problems) console.log(`  - ${p}`);
    if (!SKIP_UNMATCHED) {
      console.log('\nFix the names in the data file, or run with --skip-unmatched to load the rest.');
      process.exit(1);
    }
  }
  if (!WRITE) {
    console.log('\nDry run. Add --yes to write.');
    return;
  }

  // ---- write -------------------------------------------------------------
  const created = { at: new Date().toISOString(), tasks: [], targets: [], types: [], components: [] };
  const save = () => writeFile(LAST, JSON.stringify(created, null, 2));

  for (const t of plan.tasks) {
    const [task] = await post('tasks', {
      title: t.title,
      description: t.description,
      project_id: t.project_id,
      team_id: t.team_id,
      due_date: t.due_date,
      created_by: t.created_by,
    });
    created.tasks.push(task.id);
    if (t.assignee) await post('task_assignees', { task_id: task.id, member_id: t.assignee }, 'return=minimal');
    if (t.history) await rpc('import_task_history', { p_task: task.id, ...t.history });
    await save();
  }
  console.log(`  ${created.tasks.length} tasks written`);

  const existingComponents = await get('project_components?select=project_id,component_key');
  for (const project_id of plan.components) {
    const has = existingComponents.find((c) => c.project_id === project_id);
    if (has && has.component_key !== 'outreach') {
      console.log(`  project ${project_id} already carries ${has.component_key}; outreach not attached`);
      continue;
    }
    if (!has) {
      await post('project_components', { project_id, component_key: 'outreach', attached_by: fallback?.id ?? null }, 'return=minimal');
      created.components.push(project_id);
    }
  }
  for (const type of plan.types) {
    try {
      await post('outreach_types', { ...type, sort_order: 100 }, 'return=minimal');
      created.types.push({ project_id: type.project_id, key: type.key });
    } catch (error) {
      if (!/duplicate|23505/.test(String(error.message))) throw error;
    }
  }
  await save();

  for (let i = 0; i < plan.targets.length; i += 50) {
    const rows = await post('outreach_targets', plan.targets.slice(i, i + 50));
    created.targets.push(...rows.map((r) => r.id));
    await save();
  }
  console.log(`  ${created.targets.length} outreach targets written on ${created.components.length} newly attached projects`);
  console.log(`\nDone. Ids are in ${LAST}; \`npm run kpi:simulate -- --undo\` removes exactly these rows.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
