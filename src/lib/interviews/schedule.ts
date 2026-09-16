/**
 * Geometry for the day grid on the schedule page: rooms across, time down,
 * one block per session. The same explicit-placement trick as the club's room
 * schedule (src/lib/rooms.ts): a session is ONE block spanning its rows, so a
 * three-hour session is not 36 five-minute boxes.
 *
 * Rows are five-minute steps, the finest slot length allowed, so any session
 * lands exactly on the grid.
 */

export const GRID_STEP = 5;

export type GridSessionInput = {
  id: string;
  room_id: string;
  company_id: string;
  startMinute: number;
  endMinute: number;
  slot_minutes: number;
};

export type GridBlock<T extends GridSessionInput> = {
  session: T;
  /** 1-based CSS grid rows. */
  row: number;
  span: number;
};

export type GridColumn<T extends GridSessionInput> = {
  room_id: string;
  blocks: GridBlock<T>[];
};

export type DayGrid<T extends GridSessionInput> = {
  firstMinute: number;
  lastMinute: number;
  rows: number;
  /** Labels for the time gutter, one per half hour. */
  labels: { row: number; span: number; label: string }[];
  columns: GridColumn<T>[];
};

export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function buildDayGrid<T extends GridSessionInput>(
  sessions: T[],
  roomIds: string[],
): DayGrid<T> {
  if (sessions.length === 0) {
    return { firstMinute: 0, lastMinute: 0, rows: 0, labels: [], columns: [] };
  }

  // Snap the frame to the half hour around the day's sessions.
  const firstMinute = Math.floor(Math.min(...sessions.map((s) => s.startMinute)) / 30) * 30;
  const lastMinute = Math.ceil(Math.max(...sessions.map((s) => s.endMinute)) / 30) * 30;
  const rows = Math.max(1, (lastMinute - firstMinute) / GRID_STEP);

  const labels: DayGrid<T>['labels'] = [];
  for (let minute = firstMinute; minute < lastMinute; minute += 30) {
    labels.push({
      row: (minute - firstMinute) / GRID_STEP + 1,
      span: 30 / GRID_STEP,
      label: minuteLabel(minute),
    });
  }

  const columns: GridColumn<T>[] = roomIds.map((room_id) => ({
    room_id,
    blocks: sessions
      .filter((s) => s.room_id === room_id)
      .sort((a, b) => a.startMinute - b.startMinute)
      .map((session) => ({
        session,
        row: (session.startMinute - firstMinute) / GRID_STEP + 1,
        span: Math.max(1, (session.endMinute - session.startMinute) / GRID_STEP),
      })),
  }));

  return { firstMinute, lastMinute, rows, labels, columns };
}

/** Minutes from midnight of an instant on a given clock. */
export function minuteOfDayIn(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
  const [hours, minutes] = parts.split(':').map(Number);
  return (hours % 24) * 60 + minutes;
}
