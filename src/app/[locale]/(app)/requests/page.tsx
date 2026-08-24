import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, hasPermission } from '@/lib/auth/session';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatDateTime, localized } from '@/lib/format';
import { findStatus, loadStatusLookup } from '@/lib/requests';

export default async function RequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { locale } = await params;
  const { filter } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations('requests');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();
  const me = await getMyMember();

  let query = supabase
    .from('requests')
    /*
     * `members:submitted_by` is spelled out because `requests` has TWO foreign
     * keys to members now — the submitter, and the person a meeting is aimed at
     * (migration 0029). A bare `members(...)` is ambiguous, and PostgREST
     * answers an ambiguous embed by refusing the WHOLE query — so this page
     * showed nothing at all, for every request type, rather than showing rows
     * with one name missing.
     *
     * It has to stay one string literal: supabase-js reads it to type the row.
     */
    .select(
      'id, status, created_at, request_type_id, submitted_by, target_kind, request_types(name_en, name_ar), members:submitted_by(name_en, name_ar), teams(name_en, name_ar), projects(name_en, name_ar)',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  // "Mine" is a filter, not a permission — RLS already limits the list to what
  // this person may see (their own, their scope's, and anything routed to them).
  if (filter === 'mine') query = query.eq('submitted_by', me!.id);

  const { data: requests } = await query;

  const statuses = await loadStatusLookup(
    supabase,
    (requests ?? []).map((r) => r.request_type_id as string),
  );

  const visible = (requests ?? []).filter((request) => {
    if (filter !== 'decide') return true;
    // Anything not yet finished and not submitted by me is something I was
    // shown because I can act on it.
    const status = findStatus(statuses, request.request_type_id as string, request.status as string);
    return !status?.is_terminal && request.submitted_by !== me!.id;
  });

  const canSubmit = await hasPermission('requests.submit');

  const tabs = [
    { key: 'all', label: tCommon('all'), href: '/requests' },
    { key: 'mine', label: t('mine'), href: '/requests?filter=mine' },
    { key: 'decide', label: t('toDecide'), href: '/requests?filter=decide' },
  ];
  const active = filter ?? 'all';

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          canSubmit ? (
            <Link
              href="/requests/new"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t('newRequest')}
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex gap-1 rounded-lg border border-line p-1 text-sm">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={
              active === tab.key
                ? 'rounded bg-brand-50 px-3 py-1 font-medium text-brand-700'
                : 'rounded px-3 py-1 text-ink-muted hover:text-ink'
            }
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {visible.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('type')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('target')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('submittedBy')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('submittedAt')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((request) => {
                const status = findStatus(
                  statuses,
                  request.request_type_id as string,
                  request.status as string,
                );
                const target =
                  request.target_kind === 'team'
                    ? localized(request.teams as unknown as Record<string, string>, 'name', locale)
                    : request.target_kind === 'project'
                      ? localized(
                          request.projects as unknown as Record<string, string>,
                          'name',
                          locale,
                        )
                      : t('targetPresidency');

                return (
                  <tr key={request.id} className="hover:bg-surface-muted">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/requests/${request.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {localized(
                          request.request_types as unknown as Record<string, string>,
                          'name',
                          locale,
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">{target}</td>
                    <td className="px-4 py-2.5">
                      {localized(
                        request.members as unknown as Record<string, string>,
                        'name',
                        locale,
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">
                      {formatDateTime(request.created_at, locale)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        tone={
                          status?.is_approved ? 'ok' : status?.is_terminal ? 'neutral' : 'warn'
                        }
                      >
                        {localized(status, 'name', locale) || String(request.status)}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState>{t('empty')}</EmptyState>
      )}
    </>
  );
}
