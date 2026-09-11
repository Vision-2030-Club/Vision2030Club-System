import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatDateTime, localized } from '@/lib/format';
import {
  REQUEST_FILE_BUCKET,
  findStatus,
  loadFieldOptions,
  loadStatusLookup,
  optionLabel,
  type RequestField,
} from '@/lib/requests';
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

  /*
   * Two embeds here name the foreign key explicitly, and both have to: as of
   * 0029 `requests` has two FKs to `members` (the submitter and a meeting's
   * individual target), and `meeting_details` has two back to `requests` (its
   * own row, and the request that spawned it). PostgREST refuses an ambiguous
   * embed by failing the WHOLE query with a 300, so leaving either bare takes
   * the entire page down rather than dropping one field.
   */
  const { data: request } = await supabase
    .from('requests')
    .select(
      'id, status, data, created_at, request_type_id, submitted_by, target_kind, target_team_id, target_project_id, target_member_id, request_types(key, name_en, name_ar, field_schema), members:submitted_by(name_en, name_ar), target_member:target_member_id(name_en, name_ar), teams(name_en, name_ar), projects(name_en, name_ar), meeting_details!request_id(booking_id, meet_link, meet_state)',
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
      .select('to_status, actor_rule, required_permission, label_en, label_ar, sort_order, field_schema')
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
        field_schema: (transition.field_schema ?? []) as RequestField[],
      };
    });

  const type = request.request_types as unknown as {
    key: string;
    name_en: string;
    name_ar: string;
    field_schema: RequestField[];
  };
  const data = (request.data ?? {}) as Record<string, string | number>;

  /*
   * A live-sourced select stores an id, so the label has to be looked up the
   * same way the form built it — hence the shared loader rather than a second
   * query written to taste here.
   *
   * Both schemas are passed: the TYPE's, for the answers shown above, and each
   * TRANSITION's, for the questions a move is about to ask. A counter-offer's
   * room picker lives in the second, and would silently render empty if only
   * the first were loaded.
   */
  /*
   * Any `file` answers, signed for download. Collected from the type's schema
   * AND every transition's, because a deliverable is attached BY a move.
   */
  const filePaths = [...(type.field_schema ?? []), ...available.flatMap((a) => a.field_schema)]
    .filter((field) => field.type === 'file')
    .map((field) => data[field.key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const fileLinks = new Map<string, string>();
  if (filePaths.length) {
    const { data: signed } = await supabase.storage
      .from(REQUEST_FILE_BUCKET)
      .createSignedUrls([...new Set(filePaths)], 60 * 60);
    for (const row of signed ?? []) {
      if (row.path && row.signedUrl) fileLinks.set(row.path, row.signedUrl);
    }
  }

  const fieldOptions = await loadFieldOptions(supabase, [
    type,
    ...available.map((transition) => ({ field_schema: transition.field_schema })),
  ]);

  const target =
    request.target_kind === 'team'
      ? localized(request.teams as unknown as Record<string, string>, 'name', locale)
      : request.target_kind === 'project'
        ? localized(request.projects as unknown as Record<string, string>, 'name', locale)
        : request.target_kind === 'individual'
          ? localized(request.target_member as unknown as Record<string, string>, 'name', locale)
          : t('targetPresidency');

  /*
   * A meeting's room and Meet link live beside the request, not in its
   * answers — see migration 0029. `meeting_details` has no row for any other
   * type, so its absence is what says "this is not a meeting".
   */
  const meeting = request.meeting_details as unknown as {
    booking_id: string | null;
    meet_link: string | null;
    meet_state: 'not_needed' | 'pending' | 'ready' | 'failed';
  } | null;

  return (
    <>
      <PageHeader
        // Same order as the list: who it is for, then what kind of request.
        title={target}
        description={localized(type, 'name', locale)}
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
                    {field.type === 'datetime' ? (
                      formatDateTime(String(value), locale)
                    ) : field.type === 'select' ? (
                      optionLabel(field, String(value), fieldOptions, locale)
                    ) : field.type === 'file' ? (
                      // The bucket is private, so this is a signed link — and
                      // the storage policy grants it only to people who can
                      // already see this request.
                      fileLinks.get(String(value)) ? (
                        <a
                          href={fileLinks.get(String(value))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-700 underline"
                        >
                          {String(value).split('/').pop()}
                        </a>
                      ) : (
                        String(value).split('/').pop()
                      )
                    ) : (
                      String(value)
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>

        {/* §2/§3: what confirmation produced — the room and the Meet link. */}
        {meeting ? (
          <Card>
            <h2 className="mb-3 font-semibold">{t('meetingDetails')}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">{t('meetingRoom')}</dt>
              <dd>{meeting.booking_id ? t('roomHeld') : t('noRoom')}</dd>

              <dt className="text-ink-muted">{t('meetLink')}</dt>
              <dd>
                {meeting.meet_link ? (
                  <a
                    href={meeting.meet_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 underline"
                  >
                    {meeting.meet_link}
                  </a>
                ) : (
                  <span className="text-ink-muted">{t(`meet_${meeting.meet_state}`)}</span>
                )}
              </dd>
            </dl>
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-3 font-semibold">{t('actions')}</h2>
          <RequestActions
            requestId={request.id as string}
            transitions={available}
            fieldOptions={fieldOptions}
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
