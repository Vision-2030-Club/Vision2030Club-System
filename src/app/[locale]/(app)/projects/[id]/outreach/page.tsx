import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { StatTile } from '@/components/charts/BarList';
import { Badge, Card, EmptyState, Input, Label, PageHeader, Select, Textarea } from '@/components/ui';
import { formatScore } from '@/lib/kpi';
import { localized } from '@/lib/format';
import { can, getOutreachAccess } from '@/lib/outreach/access';
import {
  OUTREACH_OPEN,
  OUTREACH_STATUSES,
  OUTREACH_STATUS_TONES,
  type OutreachMemberSummary,
  type OutreachTarget,
  type OutreachType,
  type OutreachTypeSummary,
} from '@/lib/outreach/types';
import { createClient } from '@/lib/supabase/server';
import {
  addTargetAction,
  addTypeAction,
  deleteTargetAction,
  removeTypeAction,
  updateTargetAction,
} from './actions';
import { StatusSelect } from './StatusSelect';

/**
 * A project's Outreach component (0065): every target the project is
 * chasing, grouped by type, with the status a click away, and the two
 * summaries the old sheets computed by hand — per member and per type.
 */
export default async function OutreachPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getOutreachAccess(id);
  if (!access) notFound();

  const t = await getTranslations('outreach');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();
  const { role, me } = access;

  const [
    { data: typeRows },
    { data: targetRows },
    { data: memberSummaryRows },
    { data: typeSummaryRows },
    { data: managers },
    { data: staff },
  ] = await Promise.all([
    supabase.from('outreach_types').select('*').eq('project_id', id).order('sort_order').order('name_en'),
    supabase
      .from('outreach_targets')
      .select('*')
      .eq('project_id', id)
      .order('status')
      .order('name'),
    supabase.from('outreach_member_summary').select('*').eq('project_id', id),
    supabase.from('outreach_type_summary').select('*').eq('project_id', id),
    supabase.from('project_managers').select('member_id, members(id, name_en, name_ar)').eq('project_id', id),
    supabase.from('project_members').select('member_id, members(id, name_en, name_ar)').eq('project_id', id),
  ]);

  const types = (typeRows ?? []) as OutreachType[];
  const targets = (targetRows ?? []) as OutreachTarget[];
  const memberSummary = (memberSummaryRows ?? []) as OutreachMemberSummary[];
  const typeSummary = (typeSummaryRows ?? []) as OutreachTypeSummary[];

  // Everyone on the project, once, for owner pickers and names.
  const people = new Map<string, { id: string; name_en: string; name_ar: string }>();
  for (const row of [...(managers ?? []), ...(staff ?? [])]) {
    const m = row.members as unknown as { id: string; name_en: string; name_ar: string } | null;
    if (m) people.set(m.id, m);
  }
  if (!people.has(me.id)) people.set(me.id, { id: me.id, name_en: me.name_en, name_ar: me.name_ar });
  const nameOf = (memberId: string | null) =>
    memberId ? (people.get(memberId) ? localized(people.get(memberId)!, 'name', locale) : '—') : t('unassigned');
  const typeName = new Map(types.map((x) => [x.key, localized(x, 'name', locale)]));

  const total = targets.length;
  const confirmed = targets.filter((x) => x.status === 'confirmed').length;
  const rejected = targets.filter((x) => x.status === 'rejected').length;
  const open = targets.filter((x) => OUTREACH_OPEN.includes(x.status)).length;
  const conversion = total ? Math.round((1000 * confirmed) / total) / 10 : null;

  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="project_id" value={id} />
    </>
  );

  const ownerPicker = (fieldId: string, defaultValue: string | null) => (
    <div>
      <Label htmlFor={fieldId}>{t('owner')}</Label>
      <Select id={fieldId} name="owner_id" defaultValue={defaultValue ?? ''}>
        <option value="">{t('unassigned')}</option>
        {[...people.values()].map((p) => (
          <option key={p.id} value={p.id}>
            {localized(p, 'name', locale)}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <>
      <PageHeader
        title={localized(access.project, 'name', locale)}
        description={t('subtitle')}
        back={{ href: `/projects/${id}`, label: t('backToProject') }}
        action={<Badge tone="brand">{t(`roles.${role}`)}</Badge>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t('totalTargets')} value={String(total)} />
        <StatTile label={t('open')} value={String(open)} />
        <StatTile label={t('statuses.confirmed')} value={String(confirmed)} tone={confirmed > 0 ? 'ok' : undefined} />
        <StatTile label={t('statuses.rejected')} value={String(rejected)} tone={rejected > 0 ? 'danger' : undefined} />
        <StatTile label={t('conversion')} value={conversion === null ? '—' : `${formatScore(conversion)}%`} />
      </div>

      {can.add(role) ? (
        <Card className="mt-4">
          {types.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('noTypes')}</p>
          ) : (
            <Disclosure label={t('addTarget')}>
              <ActionForm action={addTargetAction} submitLabel={tCommon('create')}>
                {hidden}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label htmlFor="new-name">{t('name')}</Label>
                    <Input id="new-name" name="name" required />
                  </div>
                  <div>
                    <Label htmlFor="new-type">{t('type')}</Label>
                    <Select id="new-type" name="type_key" required>
                      {types.map((x) => (
                        <option key={x.key} value={x.key}>
                          {localized(x, 'name', locale)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {can.manage(role) ? ownerPicker('new-owner', me.id) : null}
                  <div>
                    <Label htmlFor="new-status">{t('status')}</Label>
                    <Select id="new-status" name="status" defaultValue="new">
                      {OUTREACH_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(`statuses.${s}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <Label htmlFor="new-notes">{t('notes')}</Label>
                    <Textarea id="new-notes" name="notes" rows={2} />
                  </div>
                </div>
              </ActionForm>
            </Disclosure>
          )}
        </Card>
      ) : null}

      {/* ---- Targets, one section per type ---- */}
      {targets.length === 0 ? (
        <div className="mt-4">
          <EmptyState>{t('empty')}</EmptyState>
        </div>
      ) : (
        types
          .filter((x) => targets.some((y) => y.type_key === x.key))
          .map((type) => {
            const rows = targets.filter((y) => y.type_key === type.key);
            return (
              <Card key={type.key} className="mt-4 overflow-x-auto p-0">
                <div className="flex flex-wrap items-baseline gap-2 px-5 pt-5">
                  <h2 className="font-semibold">{localized(type, 'name', locale)}</h2>
                  <span className="text-xs text-ink-muted">
                    {rows.length} · {t('statuses.confirmed')} {rows.filter((y) => y.status === 'confirmed').length}
                  </span>
                </div>
                <table className="mt-3 w-full text-sm">
                  <thead className="border-y border-line bg-surface-muted">
                    <tr>
                      <th className="px-4 py-2.5 text-start font-medium">{t('target')}</th>
                      <th className="px-4 py-2.5 text-start font-medium">{t('owner')}</th>
                      <th className="px-4 py-2.5 text-start font-medium">{t('status')}</th>
                      <th className="px-4 py-2.5 text-start font-medium">{t('notes')}</th>
                      <th className="px-4 py-2.5 text-end font-medium">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((target) => {
                      const editable = can.edit(role, target, me.id);
                      return (
                        <tr key={target.id} className="align-top hover:bg-surface-muted">
                          <td className="px-4 py-2.5 font-medium">{target.name}</td>
                          <td className="px-4 py-2.5">{nameOf(target.owner_id)}</td>
                          <td className="px-4 py-2.5">
                            {editable ? (
                              <StatusSelect
                                targetId={target.id}
                                projectId={id}
                                locale={locale}
                                status={target.status}
                                disabled={false}
                              />
                            ) : (
                              <Badge tone={OUTREACH_STATUS_TONES[target.status]}>
                                {t(`statuses.${target.status}`)}
                              </Badge>
                            )}
                          </td>
                          <td className="max-w-xs whitespace-pre-line px-4 py-2.5 text-xs text-ink-muted">
                            {target.notes ?? ''}
                          </td>
                          <td className="px-4 py-2.5 text-end">
                            {editable ? (
                              <div className="flex flex-wrap justify-end gap-2">
                                <Disclosure label={tCommon('edit')} title={target.name}>
                                  <ActionForm action={updateTargetAction} submitLabel={tCommon('save')}>
                                    {hidden}
                                    <input type="hidden" name="target_id" value={target.id} />
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <div>
                                        <Label htmlFor={`${target.id}-name`}>{t('name')}</Label>
                                        <Input id={`${target.id}-name`} name="name" defaultValue={target.name} required />
                                      </div>
                                      <div>
                                        <Label htmlFor={`${target.id}-type`}>{t('type')}</Label>
                                        <Select id={`${target.id}-type`} name="type_key" defaultValue={target.type_key}>
                                          {types.map((x) => (
                                            <option key={x.key} value={x.key}>
                                              {localized(x, 'name', locale)}
                                            </option>
                                          ))}
                                        </Select>
                                      </div>
                                      {can.manage(role) ? ownerPicker(`${target.id}-owner`, target.owner_id) : null}
                                      <div className="sm:col-span-2">
                                        <Label htmlFor={`${target.id}-notes`}>{t('notes')}</Label>
                                        <Textarea id={`${target.id}-notes`} name="notes" rows={2} defaultValue={target.notes ?? ''} />
                                      </div>
                                    </div>
                                  </ActionForm>
                                </Disclosure>
                                {can.manage(role) ? (
                                  <ConfirmForm
                                    action={deleteTargetAction}
                                    trigger={tCommon('delete')}
                                    title={t('deleteTitle')}
                                    body={t('deleteBody')}
                                    confirmLabel={tCommon('delete')}
                                  >
                                    {hidden}
                                    <input type="hidden" name="target_id" value={target.id} />
                                  </ConfirmForm>
                                ) : null}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            );
          })
      )}

      {/* ---- The sheet's summary page ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto p-0">
          <h2 className="px-5 pt-5 font-semibold">{t('byMember')}</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="border-y border-line bg-surface-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('member')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('total')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('statuses.waiting')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('statuses.in_progress')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('statuses.meeting')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('statuses.confirmed')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('statuses.rejected')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('conversion')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {memberSummary
                .slice()
                .sort((a, b) => b.confirmed - a.confirmed || b.total - a.total)
                .map((row) => (
                  <tr key={row.member_id ?? 'none'} className="hover:bg-surface-muted">
                    <td className="px-4 py-2.5 font-medium">{nameOf(row.member_id)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.total}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.waiting}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.in_progress}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.meeting}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.confirmed}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.rejected}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatScore(row.conversion_pct)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto p-0">
          <h2 className="px-5 pt-5 font-semibold">{t('byType')}</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="border-y border-line bg-surface-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('type')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('total')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('open')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('statuses.confirmed')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('statuses.rejected')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('conversion')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {typeSummary.map((row) => (
                <tr key={row.type_key} className="hover:bg-surface-muted">
                  <td className="px-4 py-2.5 font-medium">{typeName.get(row.type_key) ?? row.type_key}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.total}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.open_count}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.confirmed}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.rejected}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatScore(row.conversion_pct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* ---- Types: the manager's own list ---- */}
      {can.manage(role) ? (
        <Card className="mt-4">
          <h2 className="mb-1 font-semibold">{t('types')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('typesHint')}</p>
          {types.length ? (
            <ul className="mb-3 flex flex-wrap gap-2">
              {types.map((x) => (
                <li key={x.key} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                  <span>{localized(x, 'name', locale)}</span>
                  <span className="text-xs text-ink-muted ltr-nums">{x.key}</span>
                  <ActionForm action={removeTypeAction} submitLabel={tCommon('delete')} variant="secondary" className="space-y-0">
                    {hidden}
                    <input type="hidden" name="key" value={x.key} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : null}
          <Disclosure label={t('addType')}>
            <ActionForm action={addTypeAction} submitLabel={tCommon('create')}>
              {hidden}
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="type-name-en">{t('typeNameEn')}</Label>
                  <Input id="type-name-en" name="name_en" required />
                </div>
                <div>
                  <Label htmlFor="type-name-ar">{t('typeNameAr')}</Label>
                  <Input id="type-name-ar" name="name_ar" dir="rtl" />
                </div>
                <div>
                  <Label htmlFor="type-sort">{t('sortOrder')}</Label>
                  <Input id="type-sort" name="sort_order" type="number" defaultValue={100} dir="ltr" />
                </div>
              </div>
            </ActionForm>
          </Disclosure>
        </Card>
      ) : null}
    </>
  );
}
