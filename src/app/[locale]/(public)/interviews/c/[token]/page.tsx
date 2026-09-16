import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, cx } from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import { loadDayRows, loadFeedbackFor, loadSessions, sessionDays, toFloorRow } from '@/lib/interviews/queries';
import { isToken } from '@/lib/interviews/tokens';
import type { Application, Company, Edition, EditionSettings } from '@/lib/interviews/types';
import { createInterviewsClient, isInterviewsConfigured } from '@/lib/supabase/interviews';
import { toDateInput } from '@/lib/time';
import { CompanyBoard, type Profile } from './CompanyBoard';
import { PinForm } from './PinForm';
import { pinCookieName, pinCookieValue } from '@/lib/interviews/pin';

/**
 * The interviewer's page: their company's schedule for a day, who has
 * arrived, who is next, each student's background and CV, and the feedback
 * form. The link is the key; a PIN, if the club set one, is the second lock.
 */
export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { locale, token } = await params;
  const { day } = await searchParams;
  setRequestLocale(locale);
  if (!isToken(token) || !isInterviewsConfigured()) notFound();

  const t = await getTranslations('interviews');
  const db = createInterviewsClient();

  const { data: companyRow } = await db.from('companies').select('*').eq('access_token', token).maybeSingle();
  const company = companyRow as Company | null;
  if (!company) notFound();

  const [{ data: editionRow }, { data: settingsRow }] = await Promise.all([
    db.from('editions').select('*').eq('id', company.edition_id).maybeSingle(),
    db.rpc('edition_settings', { p_edition: company.edition_id }),
  ]);
  const edition = editionRow as Edition | null;
  const settings = settingsRow as EditionSettings | null;
  if (!edition) notFound();

  const name = localized(company, 'name', locale);

  if (company.access_pin) {
    const jar = await cookies();
    if (jar.get(pinCookieName(company.id))?.value !== pinCookieValue(token, company.access_pin)) {
      return (
        <div className="mx-auto max-w-sm">
          <h1 className="mb-1 text-xl font-semibold">{name}</h1>
          <p className="mb-4 text-sm text-ink-muted">{t('companyPage.pinHint')}</p>
          <Card>
            <PinForm token={token} locale={locale} />
          </Card>
        </div>
      );
    }
  }

  const sessions = (await loadSessions(db, edition.id)).filter((s) => s.company_id === company.id);
  const days = sessionDays(sessions);
  const today = toDateInput(new Date());
  const selectedDay = day && days.includes(day) ? day : days.includes(today) ? today : (days[0] ?? today);

  const rows = (await loadDayRows(db, edition.id, selectedDay, edition.time_zone, company.id)).map(toFloorRow);
  const bookingIds = rows.map((r) => r.booking_id).filter((id): id is string => Boolean(id));
  const applicationIds = rows.map((r) => r.application_id).filter((id): id is string => Boolean(id));

  const [feedback, { data: applications }] = await Promise.all([
    loadFeedbackFor(db, bookingIds),
    applicationIds.length
      ? db
          .from('applications')
          .select('id, name, university, university_other, level, college, major, gpa, english_level, why_first, cv_path, cv_external_url, is_club_member')
          .in('id', applicationIds)
      : Promise.resolve({ data: [] as Partial<Application>[] }),
  ]);

  const profiles: Record<string, Profile> = {};
  for (const a of (applications ?? []) as Partial<Application>[]) {
    if (!a.id) continue;
    profiles[a.id] = {
      name: a.name ?? '',
      university:
        a.university === 'other' ? (a.university_other ?? '') : a.university ? t(`universities.${a.university}`) : '',
      level: a.level ? t(`levels.${a.level}`) : '',
      college: a.college ?? '',
      major: a.major ?? '',
      gpa: a.gpa ?? '',
      english: a.english_level ? t(`english.${a.english_level}`) : '',
      why_first: a.why_first ?? '',
      has_cv: Boolean(a.cv_path),
      cv_external_url: a.cv_external_url ?? null,
      is_club_member: a.is_club_member ?? null,
    };
  }

  const feedbackState: Record<string, { released: boolean; ratings: Record<string, number>; strengths: string; improvements: string; overall: string }> = {};
  for (const [bookingId, f] of feedback) {
    feedbackState[bookingId] = {
      released: Boolean(f.released_at),
      ratings: f.ratings ?? {},
      strengths: f.strengths ?? '',
      improvements: f.improvements ?? '',
      overall: f.overall ?? '',
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{name}</h1>
          <p className="text-sm text-ink-muted">{localized(edition, 'name', locale)}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {days.map((d) => (
            <Link
              key={d}
              href={`/interviews/c/${token}?day=${d}`}
              className={cx(
                'rounded-lg border px-3 py-1.5 text-sm',
                d === selectedDay
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                  : 'border-line text-ink-muted hover:bg-surface-muted',
              )}
            >
              {formatDate(`${d}T12:00:00Z`, locale)}
            </Link>
          ))}
        </div>
      </div>

      <CompanyBoard
        token={token}
        locale={locale}
        rows={rows}
        profiles={profiles}
        feedback={feedbackState}
        ratingLabels={(settings?.rating_labels ?? []).map((l) => ({ key: l.key, label: locale === 'ar' ? l.ar : l.en }))}
      />
    </div>
  );
}
