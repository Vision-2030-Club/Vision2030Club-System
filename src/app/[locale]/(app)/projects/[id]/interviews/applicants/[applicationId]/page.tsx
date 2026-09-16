import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge, Card, EmptyState } from '@/components/ui';
import { formatDateTime, formatTime, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import {
  loadApplication,
  loadBookingsOf,
  loadCompanies,
  loadFeedbackFor,
  loadPreferences,
  loadRooms,
} from '@/lib/interviews/queries';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { DECISION_TONES, STAGE_TONES } from '@/lib/interviews/ui';
import { DecisionForm } from './DecisionForm';

export default async function ApplicantPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; applicationId: string }>;
}) {
  const { locale, id, applicationId } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  if (!can.decide(role)) return <EmptyState>{tCommon('notPermitted')}</EmptyState>;

  const db = createInterviewsClient();
  const application = await loadApplication(db, applicationId);
  if (!application || application.edition_id !== edition.id) notFound();

  const [preferences, companies, rooms, bookings] = await Promise.all([
    loadPreferences(db, applicationId),
    loadCompanies(db, edition.id),
    loadRooms(db, edition.id),
    loadBookingsOf(db, applicationId),
  ]);
  const feedback = await loadFeedbackFor(db, bookings.map((b) => b.id));
  const { data: slotRooms } = bookings.length
    ? await db.from('slots').select('id, room_id').in('id', bookings.map((b) => b.slot_id))
    : { data: [] };

  const companyName = new Map(companies.map((c) => [c.id, localized(c, 'name', locale)]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const roomOfSlot = new Map((slotRooms ?? []).map((s) => [s.id as string, s.room_id as string]));
  const base = `/projects/${id}/interviews`;

  const field = (label: string, value: string | null | undefined, ltr = false) => (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={ltr ? 'ltr-nums text-sm' : 'text-sm'}>{value || '—'}</dd>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <Link href={`${base}/applicants`} className="text-xs text-ink-muted hover:text-ink">
              ← {t('tabs.applicants')}
            </Link>
            <h2 className="text-lg font-semibold">{application.name}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {application.cv_path ? (
              <a
                href={`/api/interviews/cv?project=${id}&application=${application.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                {t('applicants.openCv')}
              </a>
            ) : application.cv_external_url ? (
              <a href={application.cv_external_url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline">
                {t('applicants.cvLink')}
              </a>
            ) : (
              <span className="text-xs text-ink-muted">{t('applicants.noCv')}</span>
            )}
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          {field(t('applicants.email'), application.email, true)}
          {field(t('applicants.phone'), application.phone, true)}
          {field(
            t('applicants.university'),
            application.university === 'other'
              ? application.university_other
              : application.university
                ? t(`universities.${application.university}`)
                : null,
          )}
          {field(t('applicants.level'), application.level ? t(`levels.${application.level}`) : null)}
          {field(t('applicants.college'), application.college)}
          {field(t('applicants.major'), application.major)}
          {field(t('applicants.gpa'), application.gpa, true)}
          {field(t('applicants.english'), application.english_level ? t(`english.${application.english_level}`) : null)}
          {field(t('applicants.clubMember'), application.is_club_member == null ? null : application.is_club_member ? tCommon('yes') : tCommon('no'))}
          {field(t('applicants.submitted'), formatDateTime(application.submitted_at, locale))}
        </dl>
        {application.why_first ? (
          <div className="mt-4">
            <div className="text-xs text-ink-muted">{t('applicants.whyFirst')}</div>
            <p className="whitespace-pre-line text-sm">{application.why_first}</p>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">{t('applicants.choices')}</h2>
        <p className="mb-3 text-xs text-ink-muted">{t('applicants.choicesHint')}</p>
        <ul className="space-y-3">
          {preferences.map((p) => (
            <li key={p.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {p.rank}. {companyName.get(p.company_id) ?? '?'}
                </span>
                <Badge tone={DECISION_TONES[p.decision]}>{t(`decision.${p.decision}`)}</Badge>
              </div>
              {p.decided_at ? (
                <p className="mt-1 text-xs text-ink-muted">
                  {formatDateTime(p.decided_at, locale)}
                  {p.decision_note ? ` · ${p.decision_note}` : ''}
                </p>
              ) : null}
              <DecisionForm
                locale={locale}
                projectId={id}
                applicationId={application.id}
                companyId={p.company_id}
                current={p.decision}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="lg:col-span-3">
        <h2 className="mb-3 font-semibold">{t('applicants.bookings')}</h2>
        {bookings.length ? (
          <ul className="divide-y divide-line text-sm">
            {bookings.map((b) => {
              const f = feedback.get(b.id);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{companyName.get(b.company_id) ?? '?'}</span>
                  <span className="ltr-nums text-ink-muted">
                    {formatDateTime(b.starts_at, locale)} – {formatTime(b.ends_at, locale)}
                  </span>
                  <span className="text-ink-muted">{roomName.get(roomOfSlot.get(b.slot_id) ?? '') ?? ''}</span>
                  {b.cancelled_at ? (
                    <Badge tone="neutral">{t('bookings.cancelled')}</Badge>
                  ) : (
                    <Badge tone={STAGE_TONES[b.stage]}>{t(`stage.${b.stage}`)}</Badge>
                  )}
                  {f ? (
                    <Badge tone={f.released_at ? 'ok' : 'warn'}>
                      {f.released_at ? t('applicants.feedbackSent') : t('applicants.feedbackHeld')}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{tCommon('none')}</p>
        )}
      </Card>
    </div>
  );
}
