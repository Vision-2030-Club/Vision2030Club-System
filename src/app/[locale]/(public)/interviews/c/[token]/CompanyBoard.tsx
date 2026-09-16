'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Alert, Badge, Button, Label, Textarea, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import type { FloorRow } from '@/lib/interviews/types';
import { STAGE_TONES } from '@/lib/interviews/ui';
import { feedbackAction } from './actions';

const POLL_MS = 12_000;

export type Profile = {
  name: string;
  university: string;
  level: string;
  college: string;
  major: string;
  gpa: string;
  english: string;
  why_first: string;
  has_cv: boolean;
  cv_external_url: string | null;
  is_club_member: boolean | null;
};

export type FeedbackState = {
  released: boolean;
  ratings: Record<string, number>;
  strengths: string;
  improvements: string;
  overall: string;
};

function timeLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/**
 * The company's list for a day. Refreshes the page's data every twelve
 * seconds (a soft refresh — what is expanded stays expanded), so arrivals
 * appear without anyone pressing anything.
 */
export function CompanyBoard({
  token,
  locale,
  rows,
  profiles,
  feedback,
  ratingLabels,
}: {
  token: string;
  locale: string;
  rows: FloorRow[];
  profiles: Record<string, Profile>;
  feedback: Record<string, FeedbackState>;
  ratingLabels: { key: string; label: string }[];
}) {
  const t = useTranslations('interviews');
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  const booked = rows.filter((r) => r.booking_id);
  const now = new Date().getTime();
  const next =
    booked.find((r) => r.stage === 'arrived') ??
    booked.find((r) => r.stage === 'scheduled' && new Date(r.ends_at).getTime() > now) ??
    null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('companyPage.arrived')} value={booked.filter((r) => r.stage === 'arrived').length} />
        <Stat label={t('companyPage.inside')} value={booked.filter((r) => r.stage === 'in_interview').length} />
        <Stat label={t('companyPage.finished')} value={booked.filter((r) => r.stage === 'done').length} />
      </div>

      {next ? (
        <Alert tone="info">
          {t('companyPage.nextUp', { name: next.student_name ?? '', time: timeLabel(next.starts_at, locale), room: next.room_name })}
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <ul className="divide-y divide-line">
          {rows.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-ink-muted">{t('companyPage.empty')}</li>
          ) : null}
          {rows.map((row) => {
            const open = openId === row.booking_id;
            const profile = row.application_id ? profiles[row.application_id] : undefined;
            const fb = row.booking_id ? feedback[row.booking_id] : undefined;
            return (
              <li key={row.slot_id}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="ltr-nums w-24 shrink-0 text-sm font-semibold">{timeLabel(row.starts_at, locale)}</span>
                  <span className="w-20 shrink-0 text-xs text-ink-muted">{row.room_name}</span>
                  {row.booking_id && row.stage ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.student_name}</span>
                      <Badge tone={STAGE_TONES[row.stage]}>{t(`stage.${row.stage}`)}</Badge>
                      {fb ? <Badge tone={fb.released ? 'ok' : 'brand'}>{fb.released ? t('companyPage.feedbackSent') : t('companyPage.feedbackSaved')}</Badge> : null}
                      <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setOpenId(open ? null : row.booking_id)}>
                        {open ? t('companyPage.hide') : t('companyPage.details')}
                      </Button>
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 text-sm text-ink-muted">
                      {row.is_closed ? t('schedule.closed') : t('schedule.free')}
                    </span>
                  )}
                </div>

                {open && row.booking_id && profile ? (
                  <div className="grid gap-4 border-t border-line bg-surface-muted px-4 py-4 md:grid-cols-2">
                    <div className="space-y-2 text-sm">
                      <h3 className="font-semibold">{profile.name}</h3>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <Field label={t('applicants.university')} value={profile.university} />
                        <Field label={t('applicants.level')} value={profile.level} />
                        <Field label={t('applicants.college')} value={profile.college} />
                        <Field label={t('applicants.major')} value={profile.major} />
                        <Field label={t('applicants.gpa')} value={profile.gpa} />
                        <Field label={t('applicants.english')} value={profile.english} />
                      </dl>
                      {profile.why_first ? (
                        <p className="whitespace-pre-line text-xs text-ink-muted">
                          <span className="font-medium text-ink">{t('applicants.whyFirst')}:</span> {profile.why_first}
                        </p>
                      ) : null}
                      {profile.has_cv ? (
                        <a
                          href={`/api/interviews/cv?token=${token}&booking=${row.booking_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                        >
                          {t('applicants.openCv')}
                        </a>
                      ) : profile.cv_external_url ? (
                        <a href={profile.cv_external_url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">
                          {t('applicants.cvLink')}
                        </a>
                      ) : (
                        <span className="text-xs text-ink-muted">{t('applicants.noCv')}</span>
                      )}
                    </div>

                    <FeedbackForm token={token} locale={locale} bookingId={row.booking_id} initial={fb} ratingLabels={ratingLabels} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-xs text-ink-muted">{t('floor.refreshes')}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="ltr-nums text-xl font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="ltr-nums">{value}</dd>
    </>
  );
}

function FeedbackForm({
  token,
  locale,
  bookingId,
  initial,
  ratingLabels,
}: {
  token: string;
  locale: string;
  bookingId: string;
  initial?: FeedbackState;
  ratingLabels: { key: string; label: string }[];
}) {
  const t = useTranslations('interviews');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(feedbackAction, {
    ok: false,
  });
  const frozen = initial?.released ?? false;

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-line bg-surface p-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="booking_id" value={bookingId} />
      <h3 className="text-sm font-semibold">{t('companyPage.feedback')}</h3>
      {frozen ? <Alert tone="ok">{t('companyPage.feedbackFrozen')}</Alert> : null}

      {ratingLabels.map((label) => (
        <fieldset key={label.key} disabled={frozen}>
          <legend className="mb-1 text-xs font-medium">{label.label}</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <label
                key={n}
                className={cx(
                  'flex size-8 cursor-pointer items-center justify-center rounded-lg border text-sm',
                  'has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:font-semibold has-[:checked]:text-brand-700',
                  'border-line text-ink-muted',
                )}
              >
                <input type="radio" name={`rating_${label.key}`} value={n} defaultChecked={initial?.ratings[label.key] === n} className="sr-only" />
                {n}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div>
        <Label htmlFor={`strengths-${bookingId}`}>{t('companyPage.strengths')}</Label>
        <Textarea id={`strengths-${bookingId}`} name="strengths" rows={2} defaultValue={initial?.strengths} disabled={frozen} />
      </div>
      <div>
        <Label htmlFor={`improvements-${bookingId}`}>{t('companyPage.improvements')}</Label>
        <Textarea id={`improvements-${bookingId}`} name="improvements" rows={2} defaultValue={initial?.improvements} disabled={frozen} />
      </div>
      <div>
        <Label htmlFor={`overall-${bookingId}`}>{t('companyPage.overall')}</Label>
        <Textarea id={`overall-${bookingId}`} name="overall" rows={2} defaultValue={initial?.overall} disabled={frozen} />
      </div>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="ok">{t('companyPage.feedbackSavedNote')}</Alert> : null}

      {!frozen ? (
        <Button type="submit" disabled={pending}>
          {t('companyPage.saveFeedback')}
        </Button>
      ) : null}
    </form>
  );
}
