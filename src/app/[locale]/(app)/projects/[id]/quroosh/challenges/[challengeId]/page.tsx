import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Badge, Card, Input, Label, PageHeader } from '@/components/ui';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import {
  challengeUrl,
  formatSeconds,
  type ChallengeRow,
  type QuestionRow,
  type TopAttempt,
} from '@/lib/quroosh/challenges';
import { formatQuroosh } from '@/lib/quroosh/wallet';
import { qrDataUrls } from '@/lib/links';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { CopyField } from '../../../interviews/CopyField';
import { hideQuestionAction, saveChallengeAction, saveQuestionAction } from '../actions';
import { ChallengeFields } from '../ChallengeFields';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One challenge (Quroosh 0008), for the project's managers only: its
 * settings, the QR code to print for the booth, its questions with the
 * right option marked, and the best scores with full names.
 *
 * A question that has been answered can still be rewritten or hidden; what
 * guests already answered stays as it was scored.
 */
export default async function QurooshChallengePage({
  params,
}: {
  params: Promise<{ locale: string; id: string; challengeId: string }>;
}) {
  const { locale, id, challengeId } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();
  if (!UUID.test(challengeId) || !isQurooshConfigured()) notFound();

  const db = createQurooshClient();
  const [list, questionsResult, topResult] = await Promise.all([
    db.rpc('challenge_list', { p_project: id }),
    db.rpc('challenge_questions_list', { p_project: id, p_challenge: challengeId }),
    db.rpc('challenge_top', { p_project: id, p_challenge: challengeId, p_limit: 10 }),
  ]);
  const challenge = ((list.data ?? []) as ChallengeRow[]).find((row) => row.id === challengeId);
  if (!challenge) notFound();

  const t = await getTranslations('quroosh.challenges');
  const questions = (questionsResult.data ?? []) as QuestionRow[];
  const top = (topResult.data ?? []) as TopAttempt[];
  const shownQuestions = questions.filter((question) => !question.hidden).length;
  const link = challengeUrl(locale, challenge.token);
  const qr = await qrDataUrls(link);
  const letters = [t('letters.a'), t('letters.b'), t('letters.c'), t('letters.d')];

  const questionFields = (prefix: string, question?: QuestionRow) => (
    <>
      <div>
        <Label htmlFor={`${prefix}-prompt`}>{t('question.prompt')}</Label>
        <Input id={`${prefix}-prompt`} name="prompt" required maxLength={500} defaultValue={question?.prompt ?? ''} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">{t('question.options')}</legend>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-3">
            <input
              type="radio"
              name="correct"
              value={index}
              defaultChecked={question ? question.correct === index : index === 0}
              aria-label={t('question.rightOne', { letter: letters[index] })}
              className="size-5 shrink-0 accent-brand-600"
            />
            <Input
              name={`option_${index}`}
              maxLength={200}
              required={index < 2}
              aria-label={t('question.option', { letter: letters[index] })}
              placeholder={t('question.option', { letter: letters[index] })}
              defaultValue={question?.options[index] ?? ''}
            />
          </div>
        ))}
        <p className="text-xs text-ink-muted">{t('question.optionsHint')}</p>
      </fieldset>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={challenge.booth}
        description={challenge.topic ?? undefined}
        back={{ href: `/projects/${id}/quroosh/challenges`, label: t('title') }}
      />

      {challenge.active ? null : <Alert tone="warn">{t('offNote')}</Alert>}
      {shownQuestions === 0 ? <Alert tone="warn">{t('noQuestionsNote')}</Alert> : null}

      <Card className="space-y-4">
        <h2 className="font-semibold text-ink">{t('qrTitle')}</h2>
        <div className="flex flex-wrap items-start gap-5">
          {/* A QR code is dark on white whatever the theme. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.svg} alt={t('qrAlt', { booth: challenge.booth })} className="size-44 rounded-lg border border-line" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm text-ink-muted">{t('qrHint')}</p>
            <CopyField label={t('link')} value={link} />
            <a
              href={qr.png}
              download={`quroosh-challenge-${challenge.id.slice(0, 8)}.png`}
              className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted"
            >
              {t('downloadQr')}
            </a>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold text-ink">{t('settingsTitle')}</h2>
        <ActionForm action={saveChallengeAction} submitLabel={t('save')}>
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="challenge_id" value={challenge.id} />
          <ChallengeFields
            prefix="edit"
            values={{
              booth: challenge.booth,
              topic: challenge.topic,
              day: challenge.day,
              seconds: challenge.seconds_per_question,
              maxPoints: challenge.max_points,
            }}
          />
          <label className="flex items-center gap-3 text-sm text-ink">
            <input type="checkbox" name="active" defaultChecked={challenge.active} className="size-5 accent-brand-600" />
            {t('fields.active')}
          </label>
          <p className="text-xs text-ink-muted">{t('settingsHint')}</p>
        </ActionForm>
      </Card>

      <section className="space-y-3">
        <h2 className="font-semibold text-ink">{t('questionsTitle', { count: shownQuestions })}</h2>
        {questions.map((question, index) => (
          <Card key={question.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ltr-nums text-sm font-bold text-ink-muted">{index + 1}</span>
              <span className="min-w-0 flex-1 font-medium text-ink">{question.prompt}</span>
              {question.hidden ? <Badge tone="neutral">{t('question.hidden')}</Badge> : null}
            </div>
            <ul className="space-y-1 text-sm">
              {question.options.map((option, optionIndex) => (
                <li
                  key={optionIndex}
                  className={optionIndex === question.correct ? 'font-semibold text-ok' : 'text-ink-muted'}
                >
                  {letters[optionIndex]}. {option}
                  {optionIndex === question.correct ? ` (${t('question.right')})` : ''}
                </li>
              ))}
            </ul>
            {Number(question.answered) > 0 ? (
              <p className="text-xs text-ink-muted">
                {t('question.stats', { right: Number(question.right_answers), answered: Number(question.answered) })}
              </p>
            ) : null}
            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-600">{t('question.edit')}</summary>
              <div className="mt-3 space-y-4">
                <ActionForm action={saveQuestionAction} submitLabel={t('save')}>
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="challenge_id" value={challenge.id} />
                  <input type="hidden" name="question_id" value={question.id} />
                  {questionFields(`q-${question.id}`, question)}
                </ActionForm>
                <ActionForm
                  action={hideQuestionAction}
                  submitLabel={question.hidden ? t('question.show') : t('question.hide')}
                  variant="secondary"
                >
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="challenge_id" value={challenge.id} />
                  <input type="hidden" name="question_id" value={question.id} />
                  <input type="hidden" name="hidden" value={question.hidden ? 'false' : 'true'} />
                </ActionForm>
              </div>
            </details>
          </Card>
        ))}

        <Card className="space-y-4">
          <h3 className="font-semibold text-ink">{t('question.addTitle')}</h3>
          {/* Keyed by how many there are, so the form empties after each one is added. */}
          <ActionForm key={questions.length} action={saveQuestionAction} submitLabel={t('question.add')}>
            <input type="hidden" name="project_id" value={id} />
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="challenge_id" value={challenge.id} />
            {questionFields('new')}
          </ActionForm>
        </Card>
      </section>

      {top.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-semibold text-ink">{t('topTitle')}</h2>
          <ol className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
            {top.map((attempt, index) => (
              <li key={attempt.account_id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="ltr-nums w-6 shrink-0 text-center text-sm font-bold text-ink-muted">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{attempt.name}</span>
                <span className="ltr-nums text-xs text-ink-muted">
                  {t('topLine', { correct: attempt.correct_count, seconds: formatSeconds(attempt.total_ms) })}
                </span>
                <span className="ltr-nums font-semibold tabular-nums text-ink" dir="ltr">
                  {formatQuroosh(attempt.points)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
