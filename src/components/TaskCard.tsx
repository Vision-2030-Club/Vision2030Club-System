import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Badge, Card, Input, Label, Select, cx } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  QUALITY_CHOICES,
  RISK_CLASSES,
  STATE_TONES,
  formatScore,
  qualityKey,
  riskKey,
  stateKey,
  type TaskKpi,
} from '@/lib/kpi';
import {
  claimTaskAction,
  confirmTaskAction,
  deleteTaskAction,
  markNotDoneAction,
  rejectTaskAction,
  submitTaskAction,
} from '@/app/[locale]/(app)/tasks/actions';

/**
 * One task, with whichever workflow actions the viewer may actually take.
 *
 * Which buttons appear is decided by the `can_claim` / `can_confirm` /
 * `can_administer` flags on the row — computed in the database by the same
 * functions the policies use — so this file contains no authority logic of its
 * own to drift out of step. Status is never editable here: §1 has no manual
 * status anywhere, so the only controls are the workflow events.
 */
export async function TaskCard({
  task,
  locale,
  meId,
  homeLabel,
  assigneeName,
}: {
  task: TaskKpi;
  locale: string;
  meId: string | null;
  /** "Project · Split" or "Team", already localised by the caller. */
  homeLabel: string;
  assigneeName: string | null;
}) {
  const t = await getTranslations('tasks');
  const tCommon = await getTranslations('common');

  const isMine = meId !== null && task.assignee_id === meId;
  const isOpen = task.state === 'in_progress' || task.state === 'not_started';

  const canSubmit = isMine && task.state === 'in_progress';
  const canReview = task.can_confirm && task.state === 'pending_confirmation';
  // §2.5: only once the due date has passed with nothing submitted.
  const canMarkNotDone = task.can_confirm && isOpen && task.risk === 'overdue';

  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="task_id" value={task.id} />
      <input type="hidden" name="project_id" value={task.project_id ?? ''} />
    </>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{task.title}</div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {homeLabel}
            {' · '}
            {task.due_date ? formatDate(task.due_date, locale) : t('noDueDate')}
            {assigneeName
              ? ` · ${t('assignedTo')} ${assigneeName}`
              : task.project_id
                ? ` · ${t('unassigned')}`
                : ''}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge tone={STATE_TONES[task.state]}>{t(stateKey(task.state))}</Badge>
          {/* §4's risk read is only meaningful while work is outstanding. */}
          {isOpen ? (
            <span
              className={cx(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                RISK_CLASSES[task.risk],
              )}
            >
              {t(riskKey(task.risk))}
            </span>
          ) : null}
        </div>
      </div>

      {/* The delivered work, once there is any. */}
      {task.submission_url ? (
        <div className="mt-2 text-sm">
          <a
            href={task.submission_url}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="break-all text-brand-700 underline"
          >
            {task.submission_url}
          </a>
        </div>
      ) : null}

      {/* §4 scores. Null means the viewer is barred (§8), not zero. */}
      {task.counts_toward_kpi ? (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-xs">
          {task.overall_score === null ? (
            <span className="text-ink-muted">{isMine ? t('scoreHidden') : '—'}</span>
          ) : (
            <>
              <span>
                <span className="text-ink-muted">{t('qualityScore')}: </span>
                {task.quality ? t(qualityKey(task.quality)) : '—'}
                {' · '}
                {formatScore(task.quality_score)}
              </span>
              <span>
                <span className="text-ink-muted">{t('completionScore')}: </span>
                {formatScore(task.completion_score)}
              </span>
              <span className="font-semibold">
                <span className="font-normal text-ink-muted">{t('overallScore')}: </span>
                {formatScore(task.overall_score)}
              </span>
            </>
          )}
        </div>
      ) : null}

      {task.state === 'pending_confirmation' && !task.can_confirm ? (
        <p className="mt-2 text-xs text-ink-muted">
          {t('awaitingConfirmation')} {t('submittedOn')}:{' '}
          {formatDateTime(task.submitted_at, locale)}
        </p>
      ) : null}

      {task.rejected_at && task.state === 'in_progress' ? (
        <p className="mt-2 text-xs text-warn">
          {t('lastRejection')}: {formatDateTime(task.rejected_at, locale)}
        </p>
      ) : null}

      {canSubmit || task.can_claim || canReview || canMarkNotDone || task.can_administer ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          {task.can_claim ? (
            <ActionForm
              action={claimTaskAction}
              submitLabel={t('claim')}
              className="space-y-0"
            >
              {hidden}
            </ActionForm>
          ) : null}

          {canSubmit ? (
            <ActionForm
              action={submitTaskAction}
              submitLabel={t('submitForReview')}
              className={task.requires_link ? 'flex items-end gap-2 space-y-0' : 'space-y-0'}
            >
              {hidden}
              {/* Work that came from a request is delivered as a link — no
                  upload. The database refuses a blank one; this asks for it. */}
              {task.requires_link ? (
                <div>
                  <Label htmlFor={`url-${task.id}`}>{t('submissionUrl')}</Label>
                  <Input
                    id={`url-${task.id}`}
                    name="submission_url"
                    type="url"
                    dir="ltr"
                    placeholder="https://"
                    defaultValue={task.submission_url ?? ''}
                    required
                  />
                </div>
              ) : null}
            </ActionForm>
          ) : null}

          {canReview ? (
            <>
              <ActionForm
                action={confirmTaskAction}
                submitLabel={t('confirmTask')}
                className="flex items-end gap-2 space-y-0"
              >
                {hidden}
                <div>
                  <Label htmlFor={`quality-${task.id}`}>{t('quality')}</Label>
                  <Select
                    id={`quality-${task.id}`}
                    name="quality"
                    defaultValue="excellent"
                    required
                  >
                    {QUALITY_CHOICES.map((quality) => (
                      <option key={quality} value={quality}>
                        {t(qualityKey(quality))}
                      </option>
                    ))}
                  </Select>
                </div>
              </ActionForm>

              <ActionForm
                action={rejectTaskAction}
                submitLabel={t('reject')}
                variant="secondary"
                className="flex flex-wrap items-end gap-2 space-y-0"
              >
                {hidden}
                <div>
                  <Label htmlFor={`note-${task.id}`}>{t('rejectNote')}</Label>
                  <Input id={`note-${task.id}`} name="note" />
                </div>
                {/* Sending request work back sets a fresh commitment: the old
                    dates stopped meaning anything the moment it came back. */}
                {task.source_request_id ? (
                  <>
                    <div>
                      <Label htmlFor={`start-${task.id}`}>{t('newStartingDate')}</Label>
                      <Input id={`start-${task.id}`} name="new_start" type="date" required />
                    </div>
                    <div>
                      <Label htmlFor={`due-${task.id}`}>{t('newDeliveryDate')}</Label>
                      <Input id={`due-${task.id}`} name="new_due" type="date" required />
                    </div>
                  </>
                ) : null}
              </ActionForm>
            </>
          ) : null}

          {canMarkNotDone ? (
            <ActionForm
              action={markNotDoneAction}
              submitLabel={t('markNotDone')}
              variant="danger"
              className="space-y-0"
            >
              {hidden}
            </ActionForm>
          ) : null}

          {/* §7: never a one-click delete. */}
          {task.can_administer ? (
            <div className="ms-auto">
              <ConfirmForm
                action={deleteTaskAction}
                trigger={t('deleteTask')}
                title={t('deleteTitle')}
                body={t('deleteBody')}
                confirmLabel={tCommon('delete')}
              >
                {hidden}
              </ConfirmForm>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
