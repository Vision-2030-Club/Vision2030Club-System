import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getMyMember } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { TaskCard } from '@/components/TaskCard';
import { Card, PageHeader } from '@/components/ui';
import { formatDate, formatDateTime, localized } from '@/lib/format';
import { groupTaskRows, qualityKey, type TaskKpi } from '@/lib/kpi';
import { setTaskAssigneesAction } from '../actions';

/**
 * One task, in full.
 *
 * The list shows a card; this is the same card with everything the card has
 * no room for underneath it — the description, who created it and when, the
 * delivered link and what was said with it, the reviewer's comment — and,
 * for whoever may administer the task, the one control the list never had:
 * changing who holds it (0058).
 */
export default async function TaskPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('tasks');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();
  const me = await getMyMember();

  // task_kpi is one row per (task, assignee); RLS decides whether any come
  // back at all, so an empty result and a missing task look the same here.
  const { data: rows } = await supabase.from('task_kpi').select('*').eq('id', id);
  if (!rows?.length) notFound();
  const [{ task, assigneeIds }] = groupTaskRows(rows as TaskKpi[]);

  const [{ data: people }, { data: project }, { data: team }, { data: split }] =
    await Promise.all([
      supabase
        .from('members')
        .select('id, name_en, name_ar')
        .in('id', [...assigneeIds, ...(task.created_by ? [task.created_by] : [])]),
      task.project_id
        ? supabase.from('projects').select('id, name_en, name_ar').eq('id', task.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
      task.team_id
        ? supabase.from('teams').select('id, name_en, name_ar').eq('id', task.team_id).maybeSingle()
        : Promise.resolve({ data: null }),
      task.split_id
        ? supabase.from('project_splits').select('id, name').eq('id', task.split_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const name = new Map((people ?? []).map((p) => [p.id as string, localized(p, 'name', locale)]));
  const assigneeNames = assigneeIds.map((aid) => name.get(aid) ?? '').filter(Boolean);
  const isMine = me !== null && assigneeIds.includes(me.id);

  const homeLabel = task.project_id
    ? `${localized(project, 'name', locale)} · ${split ? (split.name as string) : t('projectWide')}`
    : `${t('team')}: ${localized(team, 'name', locale)}`;

  // Who may be handed it — the same list the New Task form offers (0057 F),
  // asked for only when the viewer may change it.
  const { data: assignable } = task.can_administer
    ? await supabase.from('assignable_members').select('id, name_en, name_ar').order('name_en')
    : { data: null };

  return (
    <>
      <PageHeader
        back={{ href: '/tasks', label: tCommon('back') }}
        title={task.title}
        description={homeLabel}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <TaskCard
            task={task}
            locale={locale}
            isMine={isMine}
            homeLabel={homeLabel}
            assigneeNames={assigneeNames}
          />

          <Card>
            <h2 className="mb-3 font-semibold">{t('details')}</h2>
            {task.description ? (
              <p className="mb-4 whitespace-pre-line text-sm">{task.description}</p>
            ) : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">{t('assignees')}</dt>
              <dd>{assigneeNames.length ? assigneeNames.join(locale === 'ar' ? '، ' : ', ') : t('unassigned')}</dd>
              <dt className="text-ink-muted">{t('createdBy')}</dt>
              <dd>
                {task.created_by ? (name.get(task.created_by) ?? '—') : '—'}
                {' · '}
                <span className="text-ink-muted">{formatDateTime(task.created_at, locale)}</span>
              </dd>
              {task.assigned_at ? (
                <>
                  <dt className="text-ink-muted">{t('assignedOn')}</dt>
                  <dd>{formatDate(task.assigned_at, locale)}</dd>
                </>
              ) : null}
              <dt className="text-ink-muted">{t('dueDate')}</dt>
              <dd>{task.due_date ? formatDate(task.due_date, locale) : t('noDueDate')}</dd>
              {task.submitted_at ? (
                <>
                  <dt className="text-ink-muted">{t('submittedOn')}</dt>
                  <dd>{formatDateTime(task.submitted_at, locale)}</dd>
                </>
              ) : null}
              {task.confirmed_at ? (
                <>
                  <dt className="text-ink-muted">{t('confirmedOn')}</dt>
                  <dd>
                    {formatDateTime(task.confirmed_at, locale)}
                    {task.quality ? ` · ${t(qualityKey(task.quality))}` : ''}
                  </dd>
                </>
              ) : null}
              {task.submission_url ? (
                <>
                  <dt className="text-ink-muted">{t('submissionUrl')}</dt>
                  <dd>
                    <a
                      href={task.submission_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      dir="ltr"
                      className="break-all text-brand-700 underline"
                    >
                      {task.submission_url}
                    </a>
                  </dd>
                </>
              ) : null}
              {task.submission_note ? (
                <>
                  <dt className="text-ink-muted">{t('submissionNote')}</dt>
                  <dd className="whitespace-pre-line">{task.submission_note}</dd>
                </>
              ) : null}
              {task.review_note ? (
                <>
                  <dt className="text-ink-muted">{t('reviewNote')}</dt>
                  <dd className="whitespace-pre-line">{task.review_note}</dd>
                </>
              ) : null}
            </dl>
          </Card>
        </div>

        {task.can_administer && assignable ? (
          <Card>
            <h2 className="mb-1 font-semibold">{t('editAssignees')}</h2>
            <p className="mb-3 text-xs text-ink-muted">{t('assigneesHint')}</p>
            <ActionForm action={setTaskAssigneesAction} submitLabel={tCommon('save')}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="task_id" value={task.id} />
              <input type="hidden" name="project_id" value={task.project_id ?? ''} />
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-2 text-sm">
                {assignable.map((person) => (
                  <label key={person.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="assignee_ids"
                      value={person.id}
                      defaultChecked={assigneeIds.includes(person.id as string)}
                      className="accent-brand-600"
                    />
                    {localized(person, 'name', locale)}
                  </label>
                ))}
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
