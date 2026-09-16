import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Badge, Card, EmptyState } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { isEmailConfigured } from '@/lib/interviews/email';
import type { OutboxRow } from '@/lib/interviews/types';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { retryEmailAction, sendPendingEmailsAction } from '../actions';

function stateOf(row: OutboxRow): 'sent' | 'failed' | 'pending' {
  if (row.sent_at) return 'sent';
  if (row.attempts >= 5 || (row.last_error && row.attempts > 0)) return 'failed';
  return 'pending';
}

const TONES = { sent: 'ok', failed: 'danger', pending: 'warn' } as const;

export default async function InterviewsMessagesPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  if (!can.manage(role)) return <EmptyState>{tCommon('notPermitted')}</EmptyState>;

  const db = createInterviewsClient();
  const [{ data }, { count: pending }] = await Promise.all([
    db
      .from('email_outbox')
      .select('*')
      .eq('edition_id', edition.id)
      .order('created_at', { ascending: false })
      .limit(200),
    db
      .from('email_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('edition_id', edition.id)
      .is('sent_at', null),
  ]);
  const rows = (data ?? []) as OutboxRow[];
  const configured = isEmailConfigured();

  return (
    <div className="space-y-4">
      {!configured ? <Alert tone="warn">{t('messages.notConfigured')}</Alert> : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{t('messages.outbox')}</h2>
            <p className="text-xs text-ink-muted">{t('messages.pending', { count: pending ?? 0 })}</p>
          </div>
          <ActionForm action={sendPendingEmailsAction} submitLabel={t('messages.sendNow')} variant="secondary" className="space-y-0">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={id} />
          </ActionForm>
        </div>
      </Card>

      {rows.length === 0 ? (
        <EmptyState>{t('messages.empty')}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('messages.to')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('messages.kind')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('messages.queued')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('messages.state')}</th>
                <th className="px-3 py-2 text-start font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = stateOf(row);
                return (
                  <tr key={row.id} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      <div className="text-sm">{row.to_name ?? ''}</div>
                      <div className="text-xs text-ink-muted" dir="ltr">
                        {row.to_email}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{t(`emailKind.${row.kind}`)}</td>
                    <td className="ltr-nums px-3 py-2 text-xs text-ink-muted">{formatDateTime(row.created_at, locale)}</td>
                    <td className="px-3 py-2 text-xs">
                      <Badge tone={TONES[state]}>{t(`messages.state_${state}`)}</Badge>
                      {row.sent_at ? (
                        <div className="ltr-nums mt-1 text-ink-muted">{formatDateTime(row.sent_at, locale)}</div>
                      ) : null}
                      {row.last_error ? (
                        <div className="mt-1 text-danger" dir="ltr">
                          {row.last_error}
                        </div>
                      ) : null}
                      {!row.sent_at && row.attempts > 0 ? (
                        <div className="ltr-nums mt-1 text-ink-muted">{t('messages.attempts', { count: row.attempts })}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {state === 'failed' ? (
                        <ActionForm action={retryEmailAction} submitLabel={t('messages.retry')} variant="secondary" className="space-y-0">
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="project_id" value={id} />
                          <input type="hidden" name="email_id" value={row.id} />
                        </ActionForm>
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
