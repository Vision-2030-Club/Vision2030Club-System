import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Badge, Button, Card, EmptyState, Input, Label, Select } from '@/components/ui';
import { formatDateTime, formatTime, localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { loadApplicants, loadCompanies, loadFreeSlots, loadRooms } from '@/lib/interviews/queries';
import type { Booking, SlotStatus } from '@/lib/interviews/types';
import { STAGE_TONES } from '@/lib/interviews/ui';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { staffBookAction, staffCancelAction, staffMoveAction } from '../actions';

/**
 * Any booking, by a manager: book a slot for a student who cannot, move one
 * to another free slot of the same company, or cancel it with a reason. The
 * same functions the student's own page calls, minus the window and cutoff.
 */
export default async function InterviewsBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, id } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition) notFound();
  const { edition, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  if (!can.manage(role)) return <EmptyState>{tCommon('notPermitted')}</EmptyState>;

  const db = createInterviewsClient();
  const [companies, rooms] = await Promise.all([loadCompanies(db, edition.id), loadRooms(db, edition.id)]);
  const companyName = new Map(companies.map((c) => [c.id, localized(c, 'name', locale)]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  const term = q?.trim() ?? '';
  const { applications, preferences } = term
    ? await loadApplicants(db, edition.id, { q: term })
    : { applications: [], preferences: [] };
  const shown = applications.slice(0, 20);

  const { data: bookingRows } = shown.length
    ? await db
        .from('bookings')
        .select('*, slots(room_id)')
        .in('application_id', shown.map((a) => a.id))
        .is('cancelled_at', null)
        .order('starts_at')
    : { data: [] };
  const bookings = (bookingRows ?? []) as (Booking & { slots: { room_id: string } | null })[];

  // Free slots of every company involved, fetched once each.
  const companyIds = new Set<string>();
  for (const p of preferences) if (p.decision === 'accepted') companyIds.add(p.company_id);
  const freeByCompany = new Map<string, SlotStatus[]>();
  await Promise.all(
    [...companyIds].map(async (companyId) => {
      freeByCompany.set(companyId, await loadFreeSlots(db, companyId));
    }),
  );

  const slotLabel = (slot: SlotStatus) =>
    `${formatDateTime(slot.starts_at, locale)} – ${formatTime(slot.ends_at, locale)} · ${roomName.get(slot.room_id) ?? ''}`;

  return (
    <div className="space-y-4">
      <Card>
        <form className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor="q">{t('bookings.find')}</Label>
            <Input id="q" name="q" defaultValue={term} placeholder={t('applicants.searchPlaceholder')} />
          </div>
          <Button type="submit" variant="secondary">
            {tCommon('search')}
          </Button>
        </form>
      </Card>

      {term && shown.length === 0 ? <EmptyState>{t('applicants.empty')}</EmptyState> : null}

      {shown.map((a) => {
        const mine = bookings.filter((b) => b.application_id === a.id);
        const accepted = preferences.filter((p) => p.application_id === a.id && p.decision === 'accepted');
        const unbooked = accepted.filter((p) => !mine.some((b) => b.company_id === p.company_id));

        return (
          <Card key={a.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Link href={`/projects/${id}/interviews/applicants/${a.id}`} className="font-semibold text-brand-700 hover:underline">
                {a.name}
              </Link>
              <span className="text-xs text-ink-muted" dir="ltr">
                {a.email} · {a.phone ?? ''}
              </span>
            </div>

            {mine.length ? (
              <ul className="divide-y divide-line">
                {mine.map((b) => {
                  const free = freeByCompany.get(b.company_id) ?? [];
                  return (
                    <li key={b.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{companyName.get(b.company_id)}</span>
                        <span className="ltr-nums text-ink-muted">
                          {formatDateTime(b.starts_at, locale)} – {formatTime(b.ends_at, locale)}
                        </span>
                        <span className="text-ink-muted">{roomName.get(b.slots?.room_id ?? '') ?? ''}</span>
                        <Badge tone={STAGE_TONES[b.stage]}>{t(`stage.${b.stage}`)}</Badge>
                      </div>
                      <div className="flex flex-wrap items-end gap-3">
                        {b.stage === 'scheduled' && free.length ? (
                          <ActionForm action={staffMoveAction} submitLabel={t('bookings.move')} variant="secondary" className="flex flex-wrap items-end gap-2 space-y-0">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="booking_id" value={b.id} />
                            <Select name="slot_id" aria-label={t('bookings.move')} required className="max-w-sm">
                              {free.map((slot) => (
                                <option key={slot.id} value={slot.id}>
                                  {slotLabel(slot)}
                                </option>
                              ))}
                            </Select>
                          </ActionForm>
                        ) : null}
                        {b.stage !== 'done' && b.stage !== 'in_interview' ? (
                          <ConfirmForm
                            action={staffCancelAction}
                            trigger={tCommon('cancel')}
                            title={t('bookings.cancelTitle')}
                            body={t('bookings.cancelBody')}
                            confirmLabel={t('bookings.cancelConfirm')}
                            variant="secondary"
                          >
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="booking_id" value={b.id} />
                            <Input name="reason" placeholder={t('bookings.reason')} aria-label={t('bookings.reason')} />
                          </ConfirmForm>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">{t('bookings.none')}</p>
            )}

            {unbooked.length ? (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                {unbooked.map((p) => {
                  const free = freeByCompany.get(p.company_id) ?? [];
                  return (
                    <ActionForm key={p.id} action={staffBookAction} submitLabel={t('bookings.book')} variant="secondary" className="flex flex-wrap items-end gap-2 space-y-0">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="project_id" value={id} />
                      <input type="hidden" name="application_id" value={a.id} />
                      <span className="text-sm font-medium">{companyName.get(p.company_id)}</span>
                      {free.length ? (
                        <Select name="slot_id" aria-label={t('bookings.book')} required className="max-w-sm">
                          {free.map((slot) => (
                            <option key={slot.id} value={slot.id}>
                              {slotLabel(slot)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-xs text-ink-muted">{t('bookings.noFreeSlots')}</span>
                      )}
                    </ActionForm>
                  );
                })}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
