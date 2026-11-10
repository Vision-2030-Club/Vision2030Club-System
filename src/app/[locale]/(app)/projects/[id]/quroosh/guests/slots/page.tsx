import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Alert, Badge, Card, EmptyState, Input, Label, PageHeader, cx } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { loadSlots, slotDay } from '@/lib/quroosh/guests';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { toDateInput } from '@/lib/time';
import { addSlotAction, editSlotAction, setSlotActiveAction } from './actions';

/**
 * The days guests can book (Quroosh 0005), for the project's managers: one
 * row per day, each free, booked (and by whom) or off. A day is added with
 * the browser's own date input, no time: it is saved as 00:00 Riyadh time
 * and shown as the day only. Days are never deleted, only turned off. A
 * booked day cannot be changed or turned off: its booking is cancelled or
 * moved first.
 *
 * A day is offered to guests until the day before; once it has begun it is
 * marked closed to booking.
 */
export default async function QurooshGuestSlotsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');
  const header = (
    <PageHeader
      title={t('guests.slots.title')}
      description={localized(access.project, 'name', locale)}
      back={{ href: `/projects/${id}/quroosh/guests`, label: t('guests.title') }}
    />
  );
  if (!isQurooshConfigured()) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('applications.notConfigured')}</Alert>
      </>
    );
  }

  const { ready, slots } = await loadSlots(createQurooshClient(), id);
  if (!ready) {
    return (
      <>
        {header}
        <Alert tone="warn">{t('guests.notReady')}</Alert>
      </>
    );
  }

  const hidden = (
    <>
      <input type="hidden" name="project_id" value={id} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );

  return (
    <div className="space-y-6">
      {header}
      <Alert tone="info">{t('guests.slots.intro')}</Alert>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">{t('guests.slots.addTitle')}</h2>
        <ActionForm action={addSlotAction} submitLabel={t('guests.slots.add')}>
          {hidden}
          <div className="max-w-xs">
            <Label htmlFor="slot-day">{t('guests.slots.day')}</Label>
            <Input id="slot-day" name="day" type="date" dir="ltr" required />
          </div>
        </ActionForm>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">{t('guests.slots.count', { count: slots.length })}</h2>
        {slots.length === 0 ? (
          <EmptyState>{t('guests.slots.empty')}</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
            {slots.map((slot) => {
              const status = slot.guest ? 'booked' : slot.active ? 'free' : 'off';
              return (
                <li key={slot.id} className={cx('space-y-3 p-4', slot.past && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-ink">{slotDay(slot.starts_at, locale)}</span>
                    <Badge tone={status === 'booked' ? 'brand' : status === 'free' ? 'ok' : 'neutral'}>
                      {t(`guests.slots.status.${status}`)}
                    </Badge>
                    {slot.past ? <Badge>{t('guests.slots.past')}</Badge> : null}
                    {slot.guest ? (
                      <span className="text-sm text-ink">{t('guests.slots.bookedBy', { name: slot.guest.name })}</span>
                    ) : null}
                  </div>

                  {slot.guest ? (
                    <p className="text-xs text-ink-muted">{t('guests.slots.bookedLocked')}</p>
                  ) : (
                    <div className="flex flex-wrap items-start gap-3">
                      <ActionForm
                        action={setSlotActiveAction}
                        submitLabel={slot.active ? t('guests.slots.turnOff') : t('guests.slots.turnOn')}
                        variant="secondary"
                      >
                        {hidden}
                        <input type="hidden" name="slot_id" value={slot.id} />
                        <input type="hidden" name="active" value={slot.active ? 'false' : 'true'} />
                      </ActionForm>

                      <details className="min-w-0 flex-1">
                        <summary className="cursor-pointer py-2 text-sm font-medium text-brand-700">
                          {t('guests.slots.edit')}
                        </summary>
                        <ActionForm action={editSlotAction} submitLabel={t('guests.slots.save')} className="mt-2">
                          {hidden}
                          <input type="hidden" name="slot_id" value={slot.id} />
                          <div className="max-w-xs">
                            <Label htmlFor={`day-${slot.id}`}>{t('guests.slots.day')}</Label>
                            <Input
                              id={`day-${slot.id}`}
                              name="day"
                              type="date"
                              dir="ltr"
                              required
                              defaultValue={toDateInput(new Date(slot.starts_at))}
                            />
                          </div>
                        </ActionForm>
                      </details>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
