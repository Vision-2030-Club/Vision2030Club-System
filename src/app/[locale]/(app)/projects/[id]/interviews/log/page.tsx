import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Button, Card, EmptyState, Input, Label, Select } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import type { AuditRow } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';

const TABLES = [
  'editions',
  'rooms',
  'companies',
  'applications',
  'application_preferences',
  'sessions',
  'slots',
  'bookings',
  'feedback',
  'exports',
];

/** Columns whose before/after are noise in a diff. */
const QUIET = new Set(['updated_at', 'stage_changed_at', 'created_at', 'submitted_at']);

/** The keys that changed, first six, as "key: before → after". */
function changes(row: AuditRow): { key: string; before: string; after: string }[] {
  if (row.action !== 'update' || !row.before || !row.after) return [];
  const out: { key: string; before: string; after: string }[] = [];
  for (const key of Object.keys(row.after)) {
    if (QUIET.has(key)) continue;
    const b = JSON.stringify(row.before[key] ?? null);
    const a = JSON.stringify(row.after[key] ?? null);
    if (b !== a) out.push({ key, before: b.slice(0, 60), after: a.slice(0, 60) });
    if (out.length === 6) break;
  }
  return out;
}

const ACTION_TONES: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'brand'> = {
  insert: 'ok',
  update: 'warn',
  delete: 'danger',
};

export default async function InterviewsLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ table?: string; q?: string }>;
}) {
  const { locale, id } = await params;
  const { table, q } = await searchParams;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  if (!can.manage(role)) return <EmptyState>{tCommon('notPermitted')}</EmptyState>;

  const db = createInterviewsClient();
  let query = db
    .from('audit_log')
    .select('*')
    .eq('edition_id', edition.id)
    .order('id', { ascending: false })
    .limit(200);
  if (table && TABLES.includes(table)) query = query.eq('table_name', table);
  if (q?.trim()) {
    const term = q.trim().replace(/[%,]/g, ' ');
    query = query.or(`actor_name.ilike.%${term}%,row_id.ilike.%${term}%,action.ilike.%${term}%`);
  }
  const { data } = await query;
  const rows = (data ?? []) as AuditRow[];

  return (
    <div className="space-y-4">
      <Card>
        <form className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="table">{t('log.table')}</Label>
            <Select id="table" name="table" defaultValue={table ?? ''}>
              <option value="">{tCommon('all')}</option>
              {TABLES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="q">{tCommon('search')}</Label>
            <Input id="q" name="q" defaultValue={q ?? ''} placeholder={t('log.searchPlaceholder')} />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              {tCommon('filter')}
            </Button>
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState>{t('log.empty')}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('log.when')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('log.who')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('log.what')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('log.changes')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const diff = changes(row);
                return (
                  <tr key={row.id} className="border-t border-line align-top">
                    <td className="ltr-nums whitespace-nowrap px-3 py-2 text-xs text-ink-muted">
                      {formatDateTime(row.at, locale)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Badge tone="neutral">{t(`actor.${row.actor_kind}`)}</Badge>{' '}
                      {row.actor_name ?? ''}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Badge tone={ACTION_TONES[row.action] ?? 'brand'}>{row.action}</Badge>{' '}
                      <span className="text-ink-muted">{row.table_name}</span>
                      {row.row_id ? (
                        <span className="ltr-nums ms-1 text-ink-muted" title={row.row_id}>
                          {row.row_id.slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {diff.length ? (
                        <ul className="space-y-0.5">
                          {diff.map((d) => (
                            <li key={d.key} className="ltr-nums" dir="ltr">
                              <span className="text-ink-muted">{d.key}:</span> {d.before} → {d.after}
                            </li>
                          ))}
                        </ul>
                      ) : row.action === 'insert' && row.after ? (
                        <span className="text-ink-muted" dir="ltr">
                          {String(row.after.name ?? row.after.name_en ?? row.after.stage ?? row.after.email ?? '').slice(0, 60)}
                        </span>
                      ) : row.after && row.action !== 'update' ? (
                        <span className="text-ink-muted" dir="ltr">
                          {JSON.stringify(row.after).slice(0, 80)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
