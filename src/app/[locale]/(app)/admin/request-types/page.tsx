import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { localized } from '@/lib/format';

type Status = {
  key: string;
  name_en: string;
  name_ar: string;
  is_initial: boolean;
  is_terminal: boolean;
  is_approved: boolean;
  sort_order: number;
};

type Transition = {
  from_status: string;
  to_status: string;
  actor_rule: string;
  required_permission: string | null;
  label_en: string;
  label_ar: string;
  sort_order: number;
};

/**
 * Shows each request type as what it actually is: rows in three tables.
 *
 * A new workflow is added by inserting into request_types, request_statuses
 * and request_transitions — no code, no deploy (spec §3). Seeing the statuses
 * and the allowed moves laid out here is what makes that believable to whoever
 * is about to try it.
 */
export default async function AdminRequestTypesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('admin');
  const supabase = await createClient();

  const [{ data: types }, { data: statuses }, { data: transitions }] = await Promise.all([
    supabase
      .from('request_types')
      .select(
        'id, key, name_en, name_ar, description_en, description_ar, field_schema, on_approval_hook, is_active, teams:owning_team_id(name_en, name_ar)',
      )
      .order('key'),
    supabase
      .from('request_statuses')
      .select('request_type_id, key, name_en, name_ar, is_initial, is_terminal, is_approved, sort_order')
      .order('sort_order'),
    supabase
      .from('request_transitions')
      .select(
        'request_type_id, from_status, to_status, actor_rule, required_permission, label_en, label_ar, sort_order',
      )
      .order('sort_order'),
  ]);

  const statusesByType = new Map<string, Status[]>();
  for (const row of statuses ?? []) {
    const list = statusesByType.get(row.request_type_id) ?? [];
    list.push(row as Status);
    statusesByType.set(row.request_type_id, list);
  }

  const transitionsByType = new Map<string, Transition[]>();
  for (const row of transitions ?? []) {
    const list = transitionsByType.get(row.request_type_id) ?? [];
    list.push(row as Transition);
    transitionsByType.set(row.request_type_id, list);
  }

  return (
    <>
      <PageHeader title={t('requestTypes')} description={t('requestTypesHint')} />

      {types?.length ? (
        <div className="space-y-4">
          {types.map((type) => {
            const typeStatuses = statusesByType.get(type.id) ?? [];
            const typeTransitions = transitionsByType.get(type.id) ?? [];
            const fields = Array.isArray(type.field_schema) ? type.field_schema : [];

            return (
              <Card key={type.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-ink">
                    {localized(type, 'name', locale)}
                  </h2>
                  <Badge>{type.key}</Badge>
                  {type.teams ? (
                    <Badge tone="brand">
                      {localized(
                        type.teams as unknown as Record<string, string>,
                        'name',
                        locale,
                      )}
                    </Badge>
                  ) : null}
                  {type.on_approval_hook ? (
                    <Badge tone="ok">{type.on_approval_hook}</Badge>
                  ) : null}
                  {!type.is_active ? <Badge tone="danger">—</Badge> : null}
                </div>

                {localized(type, 'description', locale) ? (
                  <p className="mt-1 text-sm text-ink-muted">
                    {localized(type, 'description', locale)}
                  </p>
                ) : null}

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-ink">{t('statuses')}</h3>
                    <ul className="flex flex-wrap gap-2">
                      {typeStatuses.map((status) => (
                        <li key={status.key}>
                          <Badge
                            tone={
                              status.is_approved
                                ? 'ok'
                                : status.is_initial
                                  ? 'brand'
                                  : status.is_terminal
                                    ? 'neutral'
                                    : 'warn'
                            }
                          >
                            {localized(
                              status as unknown as Record<string, string>,
                              'name',
                              locale,
                            )}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-medium text-ink">
                      {t('transitions')}
                    </h3>
                    <ul className="space-y-1 text-sm">
                      {typeTransitions.map((transition) => (
                        <li
                          key={`${transition.from_status}->${transition.to_status}`}
                          className="flex flex-wrap items-center gap-2 text-ink-muted"
                        >
                          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                            {transition.from_status}
                          </code>
                          <span aria-hidden>→</span>
                          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                            {transition.to_status}
                          </code>
                          <span className="text-ink">
                            {localized(
                              transition as unknown as Record<string, string>,
                              'label',
                              locale,
                            )}
                          </span>
                          <Badge>{transition.actor_rule}</Badge>
                          {transition.required_permission ? (
                            <Badge tone="brand">{transition.required_permission}</Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {fields.length ? (
                  <div className="mt-4">
                    <h3 className="mb-2 text-sm font-medium text-ink">
                      {t('fields')}
                    </h3>
                    <ul className="flex flex-wrap gap-2">
                      {(fields as Record<string, unknown>[]).map((field) => (
                        <li key={String(field.key)}>
                          <Badge>
                            {String(field.key)}
                            {field.required ? ' *' : ''} · {String(field.type)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState>{t('requestTypesHint')}</EmptyState>
      )}
    </>
  );
}
