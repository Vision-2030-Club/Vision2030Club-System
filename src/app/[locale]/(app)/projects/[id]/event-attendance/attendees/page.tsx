import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Alert, Badge, Button, EmptyState, Input, PageHeader } from '@/components/ui';
import { can, getEventAttendanceAccess } from '@/lib/eventAttendance/access';
import type { EventAttendeeRow } from '@/lib/eventAttendance/types';
import { formatDate, localized } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { resendPassAction, setCancelledAction } from '../actions';

/** How many rows one page shows; the search narrows a longer list. */
const SHOWN = 200;

/**
 * Everyone signed up to the project's event (0075), for its managers only:
 * who they are, where they came from, the days they attended and whether
 * their pass email went out. A manager cancels a pass (it stops working at
 * the gate), brings it back, or sends the pass email again. Nothing is
 * deleted.
 */
export default async function EventAttendeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, id } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);

  const access = await getEventAttendanceAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('eventAttendance');
  const header = <PageHeader title={t('attendees.title')} description={localized(access.project, 'name', locale)} />;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('event_attendee_list', { p_project: id });
  if (error) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('notReady')}</Alert>
      </>
    );
  }

  const all = (data ?? []) as EventAttendeeRow[];
  const query = (q ?? '').trim().toLowerCase();
  const digits = query.replace(/\D/g, '');
  const matching = query
    ? all.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          (a.email ?? '').includes(query) ||
          (digits.length >= 3 && a.phone.includes(digits)),
      )
    : all;
  const shown = matching.slice(0, SHOWN);

  return (
    <div className="space-y-4">
      {header}

      <form className="flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <Input
            name="q"
            type="search"
            defaultValue={q ?? ''}
            placeholder={t('attendees.searchPlaceholder')}
            aria-label={t('attendees.search')}
          />
        </div>
        <Button type="submit" variant="secondary">
          {t('attendees.search')}
        </Button>
      </form>

      <p className="text-sm text-ink-muted">
        {matching.length > shown.length
          ? t('attendees.shown', { shown: shown.length, total: matching.length })
          : t('attendees.count', { count: matching.length })}
      </p>

      {shown.length === 0 ? (
        <EmptyState>{t('attendees.empty')}</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
          {shown.map((attendee) => {
            const cancelled = attendee.cancelled_at !== null;
            const pass = !attendee.email
              ? null
              : attendee.pass_sent_at
                ? ({ tone: 'ok', key: 'passSent' } as const)
                : attendee.pass_error
                  ? ({ tone: 'danger', key: 'passFailed' } as const)
                  : ({ tone: 'warn', key: 'passWaiting' } as const);
            return (
              <li key={attendee.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-ink">{attendee.name}</span>
                  {cancelled ? <Badge tone="danger">{t('attendees.cancelled')}</Badge> : null}
                  <Badge tone={attendee.days.length > 0 ? 'ok' : 'neutral'}>
                    {t('attendees.daysCount', { count: attendee.days.length })}
                  </Badge>
                  {pass ? <Badge tone={pass.tone}>{t(`attendees.${pass.key}`)}</Badge> : null}
                  <span className="ms-auto text-xs text-ink-muted">
                    {t('attendees.registered', { date: formatDate(attendee.created_at, locale) })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                  <span className="ltr-nums" dir="ltr">
                    {attendee.phone}
                  </span>
                  {attendee.email ? (
                    <span className="ltr-nums break-all" dir="ltr">
                      {attendee.email}
                    </span>
                  ) : null}
                  <span>
                    {attendee.source === 'form'
                      ? t('attendees.sourceForm')
                      : t('attendees.sourceOther', { source: attendee.source })}
                  </span>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {cancelled ? (
                    <ActionForm action={setCancelledAction} submitLabel={t('attendees.restore')} variant="secondary">
                      <input type="hidden" name="project_id" value={id} />
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="attendee_id" value={attendee.id} />
                      <input type="hidden" name="cancelled" value="false" />
                    </ActionForm>
                  ) : (
                    <>
                      {attendee.email ? (
                        <ActionForm
                          action={resendPassAction}
                          submitLabel={t('attendees.resend')}
                          successText={t('attendees.resent')}
                          variant="secondary"
                        >
                          <input type="hidden" name="project_id" value={id} />
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="attendee_id" value={attendee.id} />
                        </ActionForm>
                      ) : null}
                      <ConfirmForm
                        action={setCancelledAction}
                        trigger={t('attendees.cancel')}
                        title={t('attendees.cancelTitle', { name: attendee.name })}
                        body={t('attendees.cancelBody')}
                        confirmLabel={t('attendees.cancel')}
                        variant="secondary"
                      >
                        <input type="hidden" name="project_id" value={id} />
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="attendee_id" value={attendee.id} />
                        <input type="hidden" name="cancelled" value="true" />
                      </ConfirmForm>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
