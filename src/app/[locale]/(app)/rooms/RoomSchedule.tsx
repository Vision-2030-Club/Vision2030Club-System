'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label, Select, cx } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import type { Cell, Identity, Slot } from '@/lib/rooms';
import { createBookingAction, cancelBookingAction } from './actions';

export type RoomColumn = {
  id: string;
  name: string;
  cells: Cell[];
};

/**
 * The room schedule: one day, every room side by side, half-hour rows.
 *
 * This is §6's view and §4's booking screen in one place, on purpose — §6 says
 * clicking a free block "starts a direct room booking ... not a separate
 * booking mechanism", so building two screens would have meant two places to
 * keep the same grid correct.
 *
 * Rooms are columns and slots are rows, both placed explicitly on a CSS grid.
 * That is what lets an hour-long booking be ONE block spanning two rows rather
 * than two boxes stacked up — the same trick the month calendar uses for
 * multi-day entries. Columns are logical, so this lays out correctly in Arabic
 * with no mirroring here.
 */
export function RoomSchedule({
  locale,
  day,
  slots,
  columns,
  identities,
  defaultIdentity,
  meId,
  canRemoveAny,
  elapsedUntil,
}: {
  locale: string;
  day: string;
  slots: Slot[];
  columns: RoomColumn[];
  identities: Identity[];
  defaultIdentity: string;
  meId: string;
  /** True for IT, who may clear anyone's booking (§4). */
  canRemoveAny: boolean;
  /**
   * Minutes from midnight on the club's clock, as of the page being served —
   * for today only; -1 for a later day. Half-hours that ended before this are
   * drawn greyed out and are not offered, so the morning's empty slots stop
   * reading as bookable at four in the afternoon.
   */
  elapsedUntil: number;
}) {
  /*
   * A Project Manager with no project yet has nothing to book AS. They can
   * still see the schedule, so free slots are shown but not offered — better
   * than a dialog whose only outcome is an error.
   */
  const canBook = identities.length > 0;
  const t = useTranslations('rooms');
  const tCommon = useTranslations('common');

  const [picked, setPicked] = useState<{ roomId: string; roomName: string; minute: number; canBookHour: boolean } | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
        {/* As wide as the rooms need and no wider: two rooms fit a phone
            without scrolling, and a third scrolls sideways inside the frame. */}
        <div style={{ minWidth: `calc(3.5rem + ${columns.length} * 8rem)` }}>
          {/* Header: one cell per room. */}
          <div
            className="grid border-b border-line bg-surface-muted"
            style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(8rem, 1fr))` }}
          >
            <div className="px-2 py-2 text-center text-xs font-medium text-ink-muted">
              {t('time')}
            </div>
            {columns.map((room) => (
              <div
                key={room.id}
                className="border-s border-line px-2 py-2 text-center text-sm font-semibold text-ink"
              >
                {room.name}
              </div>
            ))}
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(8rem, 1fr))`,
              // A floor, not a fixed height: a booking's three lines and its
              // cancel link grow the row instead of being cut off at 44px.
              gridTemplateRows: `repeat(${slots.length}, minmax(2.75rem, auto))`,
            }}
          >
            {/* Time labels down the side. */}
            {slots.map((slot, row) => (
              <div
                key={slot.minute}
                style={{ gridColumn: 1, gridRow: row + 1 }}
                className={cx(
                  'ltr-nums border-b border-line px-2 py-1 text-xs text-ink-muted',
                  slot.minute + 30 <= elapsedUntil && 'opacity-50',
                )}
              >
                {slot.label}
              </div>
            ))}

            {columns.flatMap((room, roomIndex) =>
              room.cells.map((cell, row) => {
                const gridColumn = roomIndex + 2;
                const gridRow = row + 1;

                // The second half of an hour-long booking: the block above
                // already spans this row, so nothing is drawn here.
                if (cell.kind === 'covered') return null;

                if (cell.kind === 'busy') {
                  const { booking } = cell;
                  const mine = booking.bookedById === meId;
                  const over = booking.endMinute <= elapsedUntil;

                  return (
                    <div
                      key={`${room.id}-${row}`}
                      style={{ gridColumn, gridRow: `${gridRow} / span ${cell.span}` }}
                      className={cx('border-b border-s border-line p-1', over && 'bg-surface-muted')}
                    >
                      <div
                        className={cx(
                          'flex h-full flex-col gap-0.5 rounded p-1.5 text-xs leading-tight',
                          booking.status === 'blocked'
                            ? 'bg-danger/10 text-danger'
                            : booking.status === 'held'
                              ? 'bg-warn/10 text-warn'
                              : 'bg-brand-50 text-brand-700',
                          // Already happened: still on the record, but grey.
                          over && 'opacity-50 grayscale',
                        )}
                      >
                        <div className="break-words font-semibold">{booking.title}</div>
                        {/* §4: everyone sees the group and who booked it. */}
                        <div className="break-words opacity-80">{booking.partyLabel}</div>
                        <div className="break-words opacity-70">{booking.bookedByName}</div>

                        {(mine || canRemoveAny) && !over ? (
                          <CancelButton
                            locale={locale}
                            bookingId={booking.id}
                            label={mine ? tCommon('cancel') : tCommon('delete')}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                }

                // Gone by: greyed and not offered. The half-hour under way is
                // still open — somebody standing at the door can take it.
                if (cell.minute + 30 <= elapsedUntil) {
                  return (
                    <div
                      key={`${room.id}-${row}`}
                      style={{ gridColumn, gridRow }}
                      className="border-b border-s border-line bg-surface-muted p-1"
                    >
                      <span className="flex h-full items-center justify-center text-xs text-ink-muted opacity-50">
                        {t('elapsed')}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={`${room.id}-${row}`}
                    style={{ gridColumn, gridRow }}
                    className="border-b border-s border-line p-1"
                  >
                    {canBook ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPicked({
                            roomId: room.id,
                            roomName: room.name,
                            minute: cell.minute,
                            canBookHour: cell.canBookHour,
                          })
                        }
                        className="h-full w-full rounded text-xs text-ink-muted transition hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500"
                      >
                        {t('free')}
                      </button>
                    ) : (
                      <span className="flex h-full items-center justify-center text-xs text-ink-muted">
                        {t('free')}
                      </span>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </div>

      {picked ? (
        <BookingDialog
          locale={locale}
          day={day}
          picked={picked}
          identities={identities}
          defaultIdentity={defaultIdentity}
          onClose={() => setPicked(null)}
        />
      ) : null}
    </>
  );
}

/** Cancelling is one click from the schedule itself — §4 asks for no approval. */
function CancelButton({
  locale,
  bookingId,
  label,
}: {
  locale: string;
  bookingId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    cancelBookingAction,
    { ok: false },
  );

  return (
    <form action={formAction} className="mt-auto">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="booking_id" value={bookingId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded px-1 py-0.5 text-[0.7rem] underline underline-offset-2 opacity-80 hover:opacity-100 disabled:opacity-50"
      >
        {state.error ? state.error : label}
      </button>
    </form>
  );
}

function BookingDialog({
  locale,
  day,
  picked,
  identities,
  defaultIdentity,
  onClose,
}: {
  locale: string;
  day: string;
  picked: { roomId: string; roomName: string; minute: number; canBookHour: boolean };
  identities: Identity[];
  defaultIdentity: string;
  onClose: () => void;
}) {
  const t = useTranslations('rooms');
  const tCommon = useTranslations('common');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    createBookingAction,
    { ok: false },
  );

  // A booked slot is no longer bookable, so the dialog closes itself once the
  // action reports success rather than sitting on a stale slot.
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const startLabel = minuteText(picked.minute);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cx(
        // `m-auto` is load-bearing: Tailwind's preflight zeroes the margin a
        // modal <dialog> relies on to centre itself.
        'm-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0',
        'text-ink shadow-lg backdrop:bg-ink/40',
      )}
    >
      <form action={formAction} className="space-y-3 p-5">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="day" value={day} />
        <input type="hidden" name="room_id" value={picked.roomId} />
        <input type="hidden" name="start_minute" value={picked.minute} />

        <div>
          <h2 className="text-base font-semibold">{t('bookSlot')}</h2>
          <p className="ltr-nums mt-1 text-sm text-ink-muted">
            {picked.roomName} · {startLabel}
          </p>
        </div>

        {/* §4: "booking as ___ — change". One option means no choice to make. */}
        <div>
          <Label htmlFor="identity">{t('bookingAs')}</Label>
          {identities.length === 1 ? (
            <>
              <input type="hidden" name="identity" value={identities[0].value} />
              <p className="text-sm font-medium text-ink">{identities[0].label}</p>
            </>
          ) : (
            <Select id="identity" name="identity" defaultValue={defaultIdentity} required>
              {identities.map((identity) => (
                <option key={identity.value} value={identity.value}>
                  {identity.label}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div>
          <Label htmlFor="title">{t('meetingTitle')}</Label>
          <Input id="title" name="title" required maxLength={80} />
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-ink">{t('howLong')}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="minutes" value="30" defaultChecked className="accent-brand-600" />
              {t('halfHour')}
            </label>
            <label
              className={cx('flex items-center gap-2', !picked.canBookHour && 'text-ink-muted')}
            >
              <input
                type="radio"
                name="minutes"
                value="60"
                disabled={!picked.canBookHour}
                className="accent-brand-600"
              />
              {t('fullHour')}
            </label>
          </div>
          {/* §4: unavailable WITH a reason, never just missing. */}
          {!picked.canBookHour ? (
            <p className="mt-1 text-xs text-ink-muted">{t('hourUnavailable')}</p>
          ) : null}
        </fieldset>

        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {t('book')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function minuteText(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
