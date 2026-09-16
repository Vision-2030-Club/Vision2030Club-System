import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge, Button, Card, EmptyState, Input, Label, Select } from '@/components/ui';
import { formatDateTime, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { loadApplicants, loadCompanies } from '@/lib/interviews/queries';
import { DECISION_TONES } from '@/lib/interviews/ui';
import { createInterviewsClient } from '@/lib/supabase/interviews';

export default async function InterviewsApplicantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ q?: string; company?: string; decision?: string }>;
}) {
  const { locale, id } = await params;
  const { q, company, decision } = await searchParams;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');

  if (!can.decide(role)) {
    return <EmptyState>{tCommon('notPermitted')}</EmptyState>;
  }

  const db = createInterviewsClient();
  const [companies, { applications, preferences }] = await Promise.all([
    loadCompanies(db, edition.id),
    loadApplicants(db, edition.id, {
      q,
      companyId: company,
      decision: decision && ['pending', 'accepted', 'rejected'].includes(decision) ? decision : undefined,
    }),
  ]);

  const companyName = new Map(companies.map((c) => [c.id, localized(c, 'name', locale)]));
  const prefsOf = new Map<string, typeof preferences>();
  for (const p of preferences) {
    const list = prefsOf.get(p.application_id) ?? [];
    list.push(p);
    prefsOf.set(p.application_id, list);
  }

  const base = `/projects/${id}/interviews/applicants`;

  return (
    <div className="space-y-4">
      <Card>
        <form className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="q">{tCommon('search')}</Label>
            <Input id="q" name="q" defaultValue={q ?? ''} placeholder={t('applicants.searchPlaceholder')} />
          </div>
          <div>
            <Label htmlFor="company">{t('company')}</Label>
            <Select id="company" name="company" defaultValue={company ?? ''}>
              <option value="">{tCommon('all')}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {localized(c, 'name', locale)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="decision">{t('applicants.decision')}</Label>
            <Select id="decision" name="decision" defaultValue={decision ?? ''}>
              <option value="">{tCommon('all')}</option>
              <option value="pending">{t('decision.pending')}</option>
              <option value="accepted">{t('decision.accepted')}</option>
              <option value="rejected">{t('decision.rejected')}</option>
            </Select>
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" variant="secondary">
              {tCommon('filter')}
            </Button>
          </div>
        </form>
      </Card>

      <p className="text-xs text-ink-muted">{t('applicants.count', { count: applications.length })}</p>

      {applications.length === 0 ? (
        <EmptyState>{t('applicants.empty')}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('applicants.name')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('applicants.university')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('applicants.level')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('applicants.gpa')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('applicants.choices')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('applicants.submitted')}</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <Link href={`${base}/${a.id}`} className="font-medium text-brand-700 hover:underline">
                      {a.name}
                    </Link>
                    <div className="text-xs text-ink-muted" dir="ltr">
                      {a.email}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {a.university === 'other' ? a.university_other : a.university ? t(`universities.${a.university}`) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">{a.level ? t(`levels.${a.level}`) : '—'}</td>
                  <td className="ltr-nums px-3 py-2 text-xs">{a.gpa ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(prefsOf.get(a.id) ?? []).map((p) => (
                        <Badge key={p.id} tone={DECISION_TONES[p.decision]}>
                          {p.rank}. {companyName.get(p.company_id) ?? '?'}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">{formatDateTime(a.submitted_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
