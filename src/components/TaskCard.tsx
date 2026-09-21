import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Badge, Card, Input, Label, Select, cx } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { toDateInput } from '@/lib/time';
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
  isMine,
  homeLabel,
  assigneeNames,
  showViewLink = true,
}: {
  task: TaskKpi;
  locale: string;
  /** The viewer is one of the people holding it (0057 E: there can be several). */
  isMine: boolean;
  /** "Project · Split" or "Team", already localised by the caller. */
  homeLabel: string;
  /** Everyone on it, localised — empty when it is posted for claiming. */
  assigneeNames: string[];
  /** The task's own page renders this card too, and needs no button to itself. */
  showViewLink?: boolean;
}) {
  const t = await getTranslations('tasks');
  const tCommon = await getTranslations('common');

  const assigneeName = assigneeNames.length
    ? assigneeNames.join(locale === 'ar' ? '، ' : ', ')
    : null;
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
          <div className="font-medium text-ink">{task.title}</div>
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
          {/* A button, not a linked title: on a phone a tappable name looks
              like plain text, and testers asked where the details were. */}
          {showViewLink ? (
            <Link
              href={`/tasks/${task.id}`}
              className="inline-flex touch-manipulation items-center rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {t('viewTask')}
            </Link>
          ) : null}
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

      {/* What was said on delivery, and by the reviewer (0058). */}
      {task.hours !== null && task.hours !== undefined ? (
        <p className="mt-2 text-xs text-ink-muted">
          {t('hours')}: <span className="ltr-nums">{task.hours}</span>
        </p>
      ) : null}

      {task.submission_note ? (
        <p className="mt-2 text-sm text-ink">
          <span className="text-ink-muted">{t('submissionNote')}: </span>
          {task.submission_note}
        </p>
      ) : null}
      {task.review_note ? (
        <p className="mt-1 text-sm text-ink">
          <span className="text-ink-muted">{t('reviewNote')}: </span>
          {task.review_note}
        </p>
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
              className="flex flex-wrap items-end gap-2 space-y-0"
            >
              {hidden}
              {/* Any task may be delivered as a link with a comment (0058).
                  Work that came from a request MUST carry the link — the
                  database refuses a blank one; `required` says so first. */}
              <div>
                <Label htmlFor={`url-${task.id}`}>{t('submissionUrl')}</Label>
                <Input
                  id={`url-${task.id}`}
                  name="submission_url"
                  type="url"
                  dir="ltr"
                  placeholder="https://"
                  defaultValue={task.submission_url ?? ''}
                  required={task.requires_link}
                />
              </div>
              <div>
                <Label htmlFor={`snote-${task.id}`}>{t('submissionNote')}</Label>
                <Input id={`snote-${task.id}`} name="submission_note" />
              </div>
              <div>
                <Label htmlFor={`hours-${task.id}`}>{t('hours')}</Label>
                <Input
                  id={`hours-${task.id}`}
                  name="hours"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={999}
                  step={0.5}
                  dir="ltr"
                  className="w-24"
                  placeholder="0"
                />
              </div>
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
                <div>
                  <Label htmlFor={`cnote-${task.id}`}>{t('reviewNote')}</Label>
                  <Input id={`cnote-${task.id}`} name="note" />
                </div>
                <div>
                  <Label htmlFor={`chours-${task.id}`}>{t('hours')}</Label>
                  <Input
                    id={`chours-${task.id}`}
                    name="hours"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={999}
                    step={0.5}
                    dir="ltr"
                    className="w-24"
                    defaultValue={task.hours ?? ''}
                  />
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
                      <Input
                        id={`start-${task.id}`}
                        name="new_start"
                        type="date"
                        min={toDateInput(new Date())}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor={`due-${task.id}`}>{t('newDeliveryDate')}</Label>
                      <Input
                        id={`due-${task.id}`}
                        name="new_due"
                        type="date"
                        min={toDateInput(new Date())}
                        required
                      />
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
