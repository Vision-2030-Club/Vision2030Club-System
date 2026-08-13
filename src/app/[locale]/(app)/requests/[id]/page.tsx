import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatDateTime, localized, toDateTimeInput } from '@/lib/format';
import { findStatus, loadStatusLookup, type RequestField } from '@/lib/requests';
import { RequestActions, type AvailableTransition } from './RequestActions';

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('requests');
  const supabase = await createClient();
  const me = await getMyMember();

  const { data: request } = await supabase
    .from('requests')
    .select(
      'id, status, data, created_at, request_type_id, submitted_by, target_kind, target_team_id, target_project_id, request_types(key, name_en, name_ar, field_schema), members(name_en, name_ar), teams(name_en, name_ar), projects(name_en, name_ar)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!request) notFound();

  const [{ data: history }, { data: transitions }, statuses] = await Promise.all([
    supabase
      .from('request_status_history')
      .select('id, from_status, to_status, note, proposed_start, proposed_end, created_at, members(name_en, name_ar)')
      .eq('request_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('request_transitions')
      .select('to_status, actor_rule, required_permission, label_en, label_ar, sort_order')
      .eq('request_type_id', request.request_type_id as string)
      .eq('from_status', request.status as string)
      .order('sort_order'),
    loadStatusLookup(supabase, [request.request_type_id as string]),
  ]);

  const status = findStatus(
    statuses,
    request.request_type_id as string,
    request.status as string,
  );

  // Mirror of app.can_act_on_request, used only to decide which buttons to
  // draw. If this guess is too generous, the trigger still refuses the move
  // and the user sees the database's own message.
  const approveScope = await scopeFor('requests.approve');
  let managesTargetProject = false;
  if (approveScope === 'own_projects' && request.target_project_id) {
    const { data } = await supabase
      .from('project_managers')
      .select('member_id')
      .eq('project_id', request.target_project_id as string)
      .eq('member_id', me!.id)
      .maybeSingle();
    managesTargetProject = Boolean(data);
  }

  const isApprover =
    approveScope === 'all' ||
    (approveScope === 'own_team' && request.target_team_id === me!.team_id) ||
    (approveScope === 'own_projects' && managesTargetProject);
  const isRequester = request.submitted_by === me!.id;

  const available: AvailableTransition[] = (transitions ?? [])
    .filter((transition) => {
      if (transition.actor_rule === 'requester') return isRequester;
      if (transition.actor_rule === 'target_approver') return isApprover;
      return true; // 'permission' rules are checked in the database
    })
    .map((transition) => {
      const target = findStatus(
        statuses,
        request.request_type_id as string,
        transition.to_status as string,
      );
      return {
        to_status: transition.to_status as string,
        label_en: transition.label_en as string,
        label_ar: transition.label_ar as string,
        is_terminal: Boolean(target?.is_terminal),
        is_approved: Boolean(target?.is_approved),
      };
    });

  const type = request.request_types as unknown as {
    key: string;
    name_en: string;
    name_ar: string;
    field_schema: RequestField[];
  };
  const data = (request.data ?? {}) as Record<string, string | number>;

  // A request type that collects a proposed time is a scheduling one — that's
  // what makes the counter-offer inputs appear, not the type's name.
  const scheduling = (type.field_schema ?? []).some(
    (field) => field.key === 'proposed_start',
  );

  const target =
    request.target_kind === 'team'
      ? localized(request.teams as unknown as Record<string, string>, 'name', locale)
      : request.target_kind === 'project'
        ? localized(request.projects as unknown as Record<string, string>, 'name', locale)
        : t('targetPresidency');

  return (
    <>
      <PageHeader
        title={localized(type, 'name', locale)}
        description={`${t('target')}: ${target}`}
        action={
          <Badge tone={status?.is_approved ? 'ok' : status?.is_terminal ? 'neutral' : 'warn'}>
            {localized(status, 'name', locale) || String(request.status)}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">{t('answers')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-muted">{t('submittedBy')}</dt>
            <dd>
              {localized(request.members as unknown as Record<string, string>, 'name', locale)}
            </dd>
            <dt className="text-ink-muted">{t('submittedAt')}</dt>
            <dd>{formatDateTime(request.created_at, locale)}</dd>

            {(type.field_schema ?? []).map((field) => {
              const value = data[field.key];
              if (value === undefined || value === null || value === '') return null;
              return (
                <div key={field.key} className="contents">
                  <dt className="text-ink-muted">
                    {locale === 'ar' ? field.label_ar : field.label_en}
                  </dt>
                  <dd>
                    {field.type === 'datetime'
                      ? formatDateTime(String(value), locale)
                      : String(value)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('actions')}</h2>
          <RequestActions
            requestId={request.id as string}
            transitions={available}
            scheduling={scheduling}
            proposedStart={
              data.proposed_start
                ? toDateTimeInput(new Date(String(data.proposed_start)))
                : undefined
            }
            proposedEnd={
              data.proposed_end
                ? toDateTimeInput(new Date(String(data.proposed_end)))
                : undefined
            }
          />
        </Card>

        <Card className="lg:col-span-3">
          <h2 className="mb-3 font-semibold">{t('history')}</h2>
          {history?.length ? (
            <ol className="space-y-3">
              {history.map((entry) => {
                const from = entry.from_status
                  ? findStatus(
                      statuses,
                      request.request_type_id as string,
                      entry.from_status as string,
                    )
                  : null;
                const to = findStatus(
                  statuses,
                  request.request_type_id as string,
                  entry.to_status as string,
                );
                const actor = entry.members as unknown as Record<string, string>;

                return (
                  <li key={entry.id} className="border-s-2 border-line ps-3 text-sm">
                    <div className="font-medium">
                      {from
                        ? t('changedFrom', {
                            from: localized(from, 'name', locale),
                            to: localized(to, 'name', locale),
                          })
                        : `${t('submitted')} · ${localized(to, 'name', locale)}`}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {formatDateTime(entry.created_at, locale)}
                      {actor ? ` · ${localized(actor, 'name', locale)}` : ''}
                    </div>
                    {entry.proposed_start ? (
                      <div className="mt-1 text-xs">
                        {t('currentProposal')}:{' '}
                        {formatDateTime(entry.proposed_start, locale)}
                      </div>
                    ) : null}
                    {entry.note ? <p className="mt-1">{entry.note}</p> : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState>{t('history')}</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
