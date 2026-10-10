'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { getMyMember } from '@/lib/auth/session';
import { all, fail, fromPostgrest, ok, requiredText, text, type ActionResult } from '@/lib/actions';
import {
  can,
  requireInterviewAccess,
  type ComponentRole,
  type InterviewAccess,
} from '@/lib/interviews/access';
import { newPin, newToken } from '@/lib/interviews/tokens';
import { deliverPendingEmails, kickEmailDelivery } from '@/lib/interviews/email';
import { syncFloorSheet } from '@/lib/interviews/floorSheet';
import { kickSheetsSync } from '@/lib/interviews/sheetsSync';
import { syncCompanySheet } from '@/lib/interviews/companySheets';
import { takeExport } from '@/lib/interviews/export';
import { removeCv, uploadCv } from '@/lib/interviews/cv';
import { kickRegistrationAppend, syncRegistrationSheet } from '@/lib/interviews/registrationSheet';
import { APPLY_FIELDS, FIELD_LABELS, FIELD_MODES, resolveApplyFields, type FieldMode } from '@/lib/interviews/applyFields';
import { applicationPayload } from '@/lib/interviews/applyPayload';
import {
  daysBetween,
  layoutProblem,
  MAX_LAYOUT_DAYS,
  roomDays,
  roomDaysProblem,
  type FloorLayout,
  type RoomDays,
} from '@/lib/interviews/floorLayout';
import { SLOT_MINUTES } from '@/lib/interviews/slotRules';
import { choosesFullCompany, fullCompanyIds } from '@/lib/interviews/fullCompanies';
import { normalisePhone } from '@/lib/interviews/phone';
import { applicationsByPhone } from '@/lib/interviews/queries';
import { saveSessionLink } from '@/lib/interviews/roomLinks';
import type { EditionSettings, Stage } from '@/lib/interviews/types';
import { formatDate, localized } from '@/lib/format';
import { fromClubWallClock } from '@/lib/time';

/**
 * Every write the signed-in pages make to the interviews database.
 *
 * The shape is the same each time: the club database says whether this
 * person may act (`requireInterviewAccess`), then a Postgres function in the
 * interviews database does the one thing asked and refuses with a sentence
 * if it cannot. Nothing here decides a rule; it carries form fields to the
 * function and the function's answer back to the form.
 */

type Guarded =
  | { access: InterviewAccess & { edition: NonNullable<InterviewAccess['edition']> }; projectId: string; locale: string }
  | { error: string };

async function guard(
  formData: FormData,
  allowed: (role: ComponentRole) => boolean,
): Promise<Guarded> {
  const projectId = requiredText(formData, 'project_id');
  const locale = requiredText(formData, 'locale');
  try {
    const access = await requireInterviewAccess(projectId, allowed);
    return { access, projectId, locale };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Not allowed.' };
  }
}

/** Everything under /projects/<id>/interviews reads the second database live. */
function revalidate(locale: string, projectId: string) {
  revalidatePath(`/${locale}/projects/${projectId}/interviews`, 'layout');
}

/** `2026-04-21T14:00` from a datetime-local input, or null when blank. */
function instantOrNull(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value ? fromClubWallClock(value).toISOString() : null;
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export async function updateEditionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const keys = all(formData, 'rating_key');
  const ens = all(formData, 'rating_en');
  const ars = all(formData, 'rating_ar');
  const rating_labels = keys
    .map((key, i) => ({
      key: key.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      en: ens[i] ?? '',
      ar: ars[i] ?? '',
    }))
    .filter((label) => label.key && (label.en || label.ar));

  const numberField = (key: string, fallback: number) => {
    const value = Number(text(formData, key) ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  };

  const db = createInterviewsClient();
  const { error } = await db.rpc('update_edition', {
    p_edition: g.access.edition.id,
    p_patch: {
      name_en: text(formData, 'name_en') ?? undefined,
      name_ar: text(formData, 'name_ar') ?? undefined,
      public_slug: text(formData, 'public_slug') ?? undefined,
      status: text(formData, 'status') ?? undefined,
      apply_opens_at: instantOrNull(formData, 'apply_opens_at'),
      apply_closes_at: instantOrNull(formData, 'apply_closes_at'),
      booking_opens_at: instantOrNull(formData, 'booking_opens_at'),
      booking_closes_at: instantOrNull(formData, 'booking_closes_at'),
      settings: {
        max_preferences: numberField('max_preferences', 4),
        change_cutoff_hours: numberField('change_cutoff_hours', 12),
        tv_call_minutes: numberField('tv_call_minutes', 5),
        feedback_email_mode:
          text(formData, 'feedback_email_mode') === 'immediately' ? 'immediately' : 'on_release',
        ...(rating_labels.length ? { rating_labels } : {}),
      },
    },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

export async function rotateTvTokenAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('rotate_tv_token', {
    p_edition: g.access.edition.id,
    p_token: newToken(),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

/**
 * A manual trigger for the floor sheet (floorSheet.ts): creates it on first
 * use rather than waiting for the next real booking change, and gives the
 * button a moment people can point at when they ask "is it working".
 */
export async function syncFloorSheetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  try {
    await syncFloorSheet(g.access.edition.id);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Sync failed.');
  }

  revalidate(g.locale, g.projectId);
  return ok();
}

/**
 * Settings → Event days and hours (floorLayout.ts): what the floor lays out
 * for every room before companies are assigned. An empty first day clears
 * it, and the floor goes back to showing only rooms with a company.
 */
export async function updateFloorLayoutAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);
  const t = await getTranslations({ locale: g.locale, namespace: 'interviews' });

  const fromDay = text(formData, 'from_day');
  let floor_layout: FloorLayout | null = null;
  if (fromDay) {
    floor_layout = {
      from_day: fromDay,
      to_day: text(formData, 'to_day') ?? fromDay,
      start: text(formData, 'start') ?? '',
      end: text(formData, 'end') ?? '',
      slot_minutes: Number(text(formData, 'slot_minutes')),
    };
    const problem = layoutProblem(floor_layout);
    if (problem) return fail(t(`layout.errors.${problem}`, { max: MAX_LAYOUT_DAYS }));
  }

  const db = createInterviewsClient();
  const { error } = await db.rpc('update_edition', {
    p_edition: g.access.edition.id,
    p_patch: { settings: { floor_layout } },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

/** Settings → Sync now: the registrations sheet rewritten from the database (registrationSheet.ts). */
export async function syncRegistrationSheetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  try {
    await syncRegistrationSheet(g.access.edition.id);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Sync failed.');
  }

  revalidate(g.locale, g.projectId);
  return ok();
}

/** Rooms tab → "Create Google Sheet" / "Sync now": one company's own sheet (companySheets.ts). */
export async function syncCompanySheetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  try {
    await syncCompanySheet(g.access.edition.id, requiredText(formData, 'company_id'));
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Sync failed.');
  }

  revalidate(g.locale, g.projectId);
  return ok();
}

/**
 * The one place a Sheet edit reaches back into the app: reads every day
 * tab's Stage column and applies whatever it finds, then re-syncs so the
 * sheet reflects the result — canonical labels back in cells that had a
 * typo or an unrecognised value, and the just-applied changes confirmed
 * rather than left to the next unrelated booking event to redraw them.
 */
export async function pullFloorSheetAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  try {
    // The rewrite applies the sheet's Status edits first (sheetPull.ts), as
    // this member; then every other sheet catches up in the background.
    const { applied, conflicts, ignored } = await syncFloorSheet(g.access.edition.id, g.access.actor);
    if (applied) kickSheetsSync(g.access.edition.id);
    revalidate(g.locale, g.projectId);
    return ok('saved', { updated: String(applied), skipped: String(conflicts + ignored) });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Pull failed.');
  }
}

export async function releaseFeedbackAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { data, error } = await db.rpc('release_feedback', {
    p_edition: g.access.edition.id,
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidate(g.locale, g.projectId);
  return ok('saved', { released: String(data ?? 0) });
}

export async function exportNowAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  try {
    const result = await takeExport(createInterviewsClient(), g.access.edition.id, g.access.actor);
    revalidate(g.locale, g.projectId);
    return ok('saved', { path: result.path });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Export failed.');
  }
}

// -----------------------------------------------------------------------------
// Rooms and companies
// -----------------------------------------------------------------------------

/**
 * Removes a company (a soft hide, restorable) or brings it back: off the
 * apply form, the Companies tab's main list, the floor sheet and its own
 * sheets. Only the company. Its rooms are the Rooms tab's to retire, and its
 * sessions, slots and bookings stay exactly as they are, so its history
 * survives and restoring it puts everything back.
 */
export async function setCompanyHiddenAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('upsert_company', {
    p_edition: g.access.edition.id,
    p_company: requiredText(formData, 'company_id'),
    p_payload: { is_hidden: text(formData, 'hidden') !== 'false' },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

/**
 * Adds a room, or edits one: its name, its location (`note`: building,
 * floor…), retired or not. A room needs no company: companies are assigned to
 * it later, for a day and hours, as sessions (createSessionAction). Only the
 * fields the form sends are changed, so the Retire button never wipes the
 * location.
 *
 * The add/edit form also sends the room's days (`from_day`, `to_day`): the
 * floor lays the room out on those days only (floorPlan, floorLayout.ts),
 * and companies can be assigned to it on those days only. Empty means every
 * event day, as before. Narrowing them past a company already assigned is
 * refused: remove that assignment first.
 */
export async function upsertRoomAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);
  const t = await getTranslations({ locale: g.locale, namespace: 'interviews' });

  const roomId = text(formData, 'room_id');
  const db = createInterviewsClient();

  // Only the add/edit form has the days; Retire and Bring back leave them be.
  const setsDays = formData.has('from_day');
  const fromDay = text(formData, 'from_day');
  const days: RoomDays | null = fromDay ? { from_day: fromDay, to_day: text(formData, 'to_day') ?? fromDay } : null;
  if (days) {
    const problem = roomDaysProblem(days);
    if (problem) return fail(t(`layout.errors.${problem}`, { max: MAX_LAYOUT_DAYS }));
  }
  if (setsDays && days && roomId) {
    const inUse = new Set(daysBetween(days.from_day, days.to_day));
    const { data: assigned, error: assignedError } = await db
      .from('sessions')
      .select('day, companies(name_en, name_ar)')
      .eq('edition_id', g.access.edition.id)
      .eq('room_id', roomId)
      .order('day');
    if (assignedError) return fromPostgrest(assignedError);
    type Assigned = { day: string; companies: { name_en: string; name_ar: string | null } | null };
    const clash = ((assigned ?? []) as unknown as Assigned[]).find((s) => !inUse.has(s.day));
    if (clash) {
      return fail(
        t('roomsTab.daysClash', {
          company: localized(clash.companies, 'name', g.locale) || '?',
          day: formatDate(`${clash.day}T12:00:00Z`, g.locale),
        }),
      );
    }
  }

  const { data: room, error } = await db.rpc('upsert_room', {
    p_edition: g.access.edition.id,
    p_room: roomId,
    p_payload: {
      name: text(formData, 'name'),
      ...(formData.has('note') ? { note: text(formData, 'note') ?? '' } : {}),
      sort_order: text(formData, 'sort_order'),
      is_active: text(formData, 'is_active'),
    },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  if (setsDays) {
    const savedId = (room as { id: string } | null)?.id ?? roomId;
    if (savedId) {
      const daysError = await saveRoomDays(db, g.access.edition.id, savedId, days, g.access.actor);
      if (daysError) return fail(daysError);
    }
  }

  // Room names head the floor sheet's blocks and the company sheets, and its
  // days decide which day tabs it is laid out on.
  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

/** Saves (or, with null, clears) one room's days, read fresh so two quick saves do not undo each other. */
async function saveRoomDays(
  db: ReturnType<typeof createInterviewsClient>,
  editionId: string,
  roomId: string,
  days: RoomDays | null,
  actor: unknown,
): Promise<string | null> {
  const { data } = await db.rpc('edition_settings', { p_edition: editionId });
  const all = roomDays(data as EditionSettings | null);
  if (days) all[roomId] = days;
  else delete all[roomId];
  const { error } = await db.rpc('update_edition', {
    p_edition: editionId,
    p_patch: { settings: { room_days: all } },
    p_actor: actor,
  });
  return error?.message ?? null;
}

/**
 * Adds or edits a company from the Companies tab (a plain company, no room or
 * session: rooms are assigned to it later, on the Rooms tab). Only the fields the form sends are changed,
 * so an edit never un-hides or re-orders a company by omission. A logo
 * arrives already shrunk by the browser (LogoInput) as a small `data:` image
 * and is stored in `logo_url` itself, so no file storage is involved.
 */
/** A shrunk logo is a few kilobytes; this leaves room and still keeps rows small. */
const MAX_LOGO_DATA = 200_000;

function isLogoDataUrl(value: string): boolean {
  return value.length <= MAX_LOGO_DATA && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value);
}

export async function upsertCompanyAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);
  const t = await getTranslations({ locale: g.locale, namespace: 'interviews' });

  const companyId = text(formData, 'company_id');
  const nameEn = text(formData, 'name_en');
  if (!companyId && !nameEn) return fail(t('errors.missing_company_name'), 'missing_company_name');

  const pinChoice = text(formData, 'pin_choice'); // keep | none | new | typed
  const payload: Record<string, unknown> = {
    name_en: nameEn,
    name_ar: text(formData, 'name_ar') ?? nameEn,
  };
  if (formData.has('desc_en')) payload.desc_en = text(formData, 'desc_en') ?? '';
  if (formData.has('desc_ar')) payload.desc_ar = text(formData, 'desc_ar') ?? '';
  if (formData.has('sort_order')) payload.sort_order = text(formData, 'sort_order');
  if (formData.has('is_hidden')) payload.is_hidden = formData.get('is_hidden') === 'on';
  if (formData.has('logo_url')) payload.logo_url = text(formData, 'logo_url') ?? '';
  if (!companyId) payload.access_token = newToken();
  if (pinChoice === 'none') payload.access_pin = '';
  else if (pinChoice === 'new') payload.access_pin = newPin();
  else if (pinChoice === 'typed') payload.access_pin = text(formData, 'access_pin') ?? '';

  const logoData = text(formData, 'logo_data');
  if (logoData) {
    if (!isLogoDataUrl(logoData)) {
      const hint = logoData.length > MAX_LOGO_DATA ? 'logo_too_large' : 'not_image';
      return fail(t(`errors.${hint}`), hint);
    }
    payload.logo_url = logoData;
  } else if (formData.get('remove_logo') === 'on') {
    payload.logo_url = '';
  }

  const db = createInterviewsClient();
  const { error } = await db.rpc('upsert_company', {
    p_edition: g.access.edition.id,
    p_company: companyId,
    p_payload: payload,
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok(companyId ? 'saved' : 'created');
}

/**
 * Full: the company stays on every list, but the forms grey it out and both
 * submit actions refuse it for anyone who had not already chosen it. Kept in
 * the edition's settings as `full_companies` (fullCompanies.ts), so it works
 * without migration 0010. The list is read fresh here, not from the request
 * cache, so two quick toggles do not undo each other.
 */
export async function setCompanyFullAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);
  const t = await getTranslations({ locale: g.locale, namespace: 'interviews' });
  if (g.access.edition.status === 'archived') return fail(t('errors.archived'), 'archived');

  const companyId = requiredText(formData, 'company_id');
  const full = text(formData, 'full') === 'true';
  const editionId = g.access.edition.id;
  const db = createInterviewsClient();

  const { data: company } = await db
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .eq('edition_id', editionId)
    .maybeSingle();
  if (!company) return fail(t('errors.not_found'), 'not_found');

  const { data: settings } = await db.rpc('edition_settings', { p_edition: editionId });
  const ids = fullCompanyIds(settings as EditionSettings | null);
  if (full) ids.add(companyId);
  else ids.delete(companyId);

  const { error } = await db.rpc('update_edition', {
    p_edition: editionId,
    p_patch: { settings: { full_companies: [...ids] } },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

/**
 * Which questions the application form asks (applyFields.ts), from the
 * Applicants tab. Stored as one `apply_fields` object in the edition's
 * settings; update_edition merges it over the rest, so nothing else moves.
 */
export async function updateApplyFieldsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const apply_fields = Object.fromEntries(
    APPLY_FIELDS.map((field) => {
      const mode = text(formData, `field_${field}`);
      return [field, (FIELD_MODES as readonly string[]).includes(mode ?? '') ? (mode as FieldMode) : 'off'];
    }),
  );

  const db = createInterviewsClient();
  const { error } = await db.rpc('update_edition', {
    p_edition: g.access.edition.id,
    p_patch: { settings: { apply_fields } },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  // The registrations sheet hides the column of a question no longer asked.
  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// Registering a student (the Register tab)
// -----------------------------------------------------------------------------

/**
 * HR or a manager registers a student: the same questions as the public form
 * (applyFields.ts), through the same submit_application, with the staff
 * member as the actor. The
 * database lets staff in outside the public window (0010) and applies every
 * other rule the public form meets: the company limit, full companies, one
 * application per email, the CV. Same CV handling as applyAction.
 */
export async function registerAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.decide);
  if ('error' in g) return fail(g.error);
  const t = await getTranslations({ locale: g.locale, namespace: 'interviews' });
  const refuse = (hint: string, fallback: string) =>
    fail(t.has(`errors.${hint}`) ? t(`errors.${hint}`) : fallback, hint);

  const editionId = g.access.edition.id;
  const db = createInterviewsClient();

  // The same questions the public form asks (applyFields.ts), checked before
  // the CV is uploaded.
  const answers = applicationPayload(
    formData,
    resolveApplyFields(g.access.settings?.apply_fields),
    g.locale === 'en' ? 'en' : 'ar',
  );
  if (answers.missing) {
    return fail(t('errors.missing_answer', { question: t(FIELD_LABELS[answers.missing]) }));
  }
  if (
    await choosesFullCompany(
      db,
      editionId,
      answers.payload.email as string | null,
      answers.payload.preferences as string[],
      fullCompanyIds(g.access.settings),
    )
  ) {
    return refuse('company_full', 'One of the chosen companies is full.');
  }

  let cvPath: string | null = null;
  const file = formData.get('cv');
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadCv(db, editionId, file);
    if ('error' in uploaded) return refuse(uploaded.error, uploaded.error);
    cvPath = uploaded.path;
  }

  const { data, error } = await db.rpc('submit_application', {
    p_edition: editionId,
    p_payload: { ...answers.payload, cv_path: cvPath },
    p_token: newToken(),
    p_actor: g.access.actor,
  });

  if (error) {
    await removeCv(db, cvPath);
    const refused = fromPostgrest(error);
    return refused.hint ? refuse(refused.hint, refused.error ?? '') : refused;
  }

  const result = data as { id: string; replaced: boolean; previous_cv_path: string | null };
  await removeCv(db, result.previous_cv_path);
  kickRegistrationAppend(editionId, result.id, result.replaced);

  revalidate(g.locale, g.projectId);
  return ok('applied', { replaced: String(result.replaced) });
}

/**
 * An assignment's candidate link (roomLinks.ts): made on the Rooms tab, or
 * made again to replace a link that was passed around; the old one stops
 * working at once.
 */
export async function createSessionLinkAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const sessionId = requiredText(formData, 'session_id');
  const db = createInterviewsClient();
  const { data: session } = await db
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('edition_id', g.access.edition.id)
    .maybeSingle();
  if (!session) return fail('No such assignment.', 'not_found');

  const { error } = await saveSessionLink(db, g.access.edition.id, sessionId, newToken(), g.access.actor);
  if (error) return fail(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

/**
 * An assignment's accepted list (Rooms tab), pasted as phone numbers (one
 * per line, or separated by commas). Nothing is added automatically: only
 * the numbers HR types are used. Each is matched to the applicant who applied
 * with it (normalised, so +966 5… and 05… are the same number;
 * applicationsByPhone) and accepted for this assignment with
 * `accept_for_session` (0014): they book only this assignment's times, and
 * are accepted for its company whether or not they chose it on the form. A
 * number that never applied becomes a new applicant with only that phone,
 * who opens the assignment's candidate link, types their name and CV, and
 * picks a time. Accepting queues the acceptance email when they have an
 * email. Before 0014 is applied nothing is accepted and the message says so.
 */
export async function acceptSessionPhonesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.decide);
  if ('error' in g) return fail(g.error);
  const t = await getTranslations({ locale: g.locale, namespace: 'interviews' });

  const sessionId = requiredText(formData, 'session_id');
  const typed = Array.from(
    new Set(
      (text(formData, 'phones') ?? '')
        .split(/[\n,;]+/)
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  );
  if (typed.length === 0) return fail(t('companies.phonesEmpty'));

  const editionId = g.access.edition.id;
  const db = createInterviewsClient();
  const { data: session } = await db.from('sessions').select('id').eq('id', sessionId).eq('edition_id', editionId).maybeSingle();
  if (!session) return fail('No such assignment.', 'not_found');
  const byPhone = await applicationsByPhone(db, editionId);

  const notPhones: string[] = [];
  for (const typedPhone of typed) {
    const phone = normalisePhone(typedPhone);
    if (!phone || phone.length < 9) {
      notPhones.push(typedPhone);
      continue;
    }
    const match = byPhone.get(phone);
    const { data, error } = await db.rpc('accept_for_session', {
      p_session: sessionId,
      p_application: match?.id ?? null,
      p_phone: phone,
      p_token: newToken(),
      p_actor: g.access.actor,
    });
    // PGRST202: the function is not there yet.
    if (error?.code === 'PGRST202') return fail(t('roomsTab.needs0014'));
    if (error) return fromPostgrest(error);
    // A new phone-only applicant: a second copy of the number in this list finds it.
    const created = data as { application_id: string } | null;
    if (!match && created) byPhone.set(phone, { id: created.application_id, phone, email: null, submitted_at: '' });
  }

  kickSheetsSync(editionId);
  revalidate(g.locale, g.projectId);
  if (notPhones.length) {
    return fail(
      [
        t('companies.phonesAccepted', { count: typed.length - notPhones.length }),
        t('companies.phonesInvalid', { phones: notPhones.join(', ') }),
      ].join(' '),
    );
  }
  return ok('saved', { count: String(typed.length) });
}

/**
 * A plain form action (no useActionState, no per-row error UI) — same shape
 * as signOutAction in the app layout. Taking someone off an assignment's
 * list is low-stakes and reversible by pasting their number back in, so it
 * needs no confirmation. unaccept_for_session (0014) also puts the company
 * back to pending when no other list of that company holds them.
 */
export async function unacceptSessionPhoneAction(formData: FormData): Promise<void> {
  const g = await guard(formData, can.decide);
  if ('error' in g) return;

  const db = createInterviewsClient();
  await db.rpc('unaccept_for_session', {
    p_session: requiredText(formData, 'session_id'),
    p_application: requiredText(formData, 'application_id'),
    p_actor: g.access.actor,
  });

  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
}

export async function rotateCompanyTokenAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('rotate_company_token', {
    p_company: requiredText(formData, 'company_id'),
    p_token: newToken(),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  // The company's sheet links its CVs through the interviewer token.
  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// Sessions and slots
// -----------------------------------------------------------------------------

export async function createSessionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  // A room with its own days (Rooms tab) takes companies on those days only.
  const roomId = requiredText(formData, 'room_id');
  const day = requiredText(formData, 'day');
  const own = roomDays(g.access.settings)[roomId];
  if (own && !daysBetween(own.from_day, own.to_day).includes(day)) {
    const t = await getTranslations({ locale: g.locale, namespace: 'interviews' });
    return fail(
      t('roomsTab.outsideDays', {
        from: formatDate(`${own.from_day}T12:00:00Z`, g.locale),
        to: formatDate(`${own.to_day}T12:00:00Z`, g.locale),
      }),
    );
  }

  const db = createInterviewsClient();
  const { error } = await db.rpc('create_session', {
    p_edition: g.access.edition.id,
    p_payload: {
      company_id: requiredText(formData, 'company_id'),
      room_id: roomId,
      day,
      start_time: requiredText(formData, 'start_time'),
      end_time: requiredText(formData, 'end_time'),
      // The database makes 20-minute slots whatever it is sent (0012).
      slot_minutes: SLOT_MINUTES,
    },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok('created');
}

export async function extendSessionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('extend_session', {
    p_session: requiredText(formData, 'session_id'),
    p_end_time: requiredText(formData, 'end_time'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

export async function deleteSessionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const sessionId = requiredText(formData, 'session_id');
  // Its accepted list would go with it (0014), and those students would be
  // left accepted for the company with no day: refuse until it is emptied.
  const { count } = await db
    .from('session_acceptances')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .is('revoked_at', null);
  if (count) {
    const t = await getTranslations({ locale: g.locale, namespace: 'interviews' });
    return fail(t('roomsTab.stillAccepted', { count }));
  }

  const { error } = await db.rpc('delete_session', {
    p_session: sessionId,
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

export async function setSlotClosedAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('set_slot_closed', {
    p_slot: requiredText(formData, 'slot_id'),
    p_closed: formData.get('closed') === 'true',
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// People — the roster lives in the CLUB database, written as the user, so its
// policies (0062) decide: organizers by whoever manages the project, HR
// people by whoever manages members.
// -----------------------------------------------------------------------------

export async function addPersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.roster);
  if ('error' in g) return fail(g.error);

  const role = requiredText(formData, 'role');
  if (role !== 'organizer' && role !== 'hr') return fail('Unknown role.');

  const me = await getMyMember();
  const supabase = await createClient();
  const { error } = await supabase.from('project_component_people').insert({
    project_id: g.projectId,
    member_id: requiredText(formData, 'member_id'),
    role,
    added_by: me?.id ?? null,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

export async function removePersonAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.roster);
  if ('error' in g) return fail(g.error);

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from('project_component_people')
    .delete()
    .eq('project_id', g.projectId)
    .eq('member_id', requiredText(formData, 'member_id'))
    .eq('role', requiredText(formData, 'role'))
    .select('member_id');
  if (error) return fromPostgrest(error);
  if (!deleted?.length) return fail('Nothing removed — that is not yours to change.');

  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// Selection
// -----------------------------------------------------------------------------

export async function decideAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.decide);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('decide_preference', {
    p_application: requiredText(formData, 'application_id'),
    p_company: requiredText(formData, 'company_id'),
    p_decision: requiredText(formData, 'decision'),
    p_note: text(formData, 'note'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  // The first acceptance queued the student's link; send it now, not at the
  // next sweep.
  kickEmailDelivery();
  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// The day: stages, called from the floor board (an object, not a form)
// -----------------------------------------------------------------------------

export async function stageAction(input: {
  projectId: string;
  locale: string;
  bookingId: string;
  to: Stage;
}): Promise<ActionResult> {
  let access: InterviewAccess;
  try {
    access = await requireInterviewAccess(input.projectId, can.stage);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Not allowed.');
  }

  const db = createInterviewsClient();
  const { error } = await db.rpc('advance_stage', {
    p_booking: input.bookingId,
    p_to: input.to,
    p_actor: access.actor,
    p_as_manager: can.manage(access.role),
  });
  if (error) return fromPostgrest(error);

  if (access.edition) kickSheetsSync(access.edition.id);
  revalidate(input.locale, input.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// Bookings, by a manager on a student's behalf
// -----------------------------------------------------------------------------

export async function staffBookAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('staff_book_slot', {
    p_application: requiredText(formData, 'application_id'),
    p_slot: requiredText(formData, 'slot_id'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok('created');
}

export async function staffMoveAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('staff_move_booking', {
    p_booking: requiredText(formData, 'booking_id'),
    p_slot: requiredText(formData, 'slot_id'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

export async function staffCancelAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('staff_cancel_booking', {
    p_booking: requiredText(formData, 'booking_id'),
    p_reason: text(formData, 'reason'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  kickSheetsSync(g.access.edition.id);
  revalidate(g.locale, g.projectId);
  return ok();
}

// -----------------------------------------------------------------------------
// The outbox
// -----------------------------------------------------------------------------

export async function sendPendingEmailsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  try {
    const report = await deliverPendingEmails(100, 25_000);
    revalidate(g.locale, g.projectId);
    return ok('saved', {
      claimed: String(report.claimed),
      sent: String(report.sent),
      failed: String(report.failed),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Sending failed.');
  }
}

export async function retryEmailAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('retry_email', {
    p_id: requiredText(formData, 'email_id'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  kickEmailDelivery();
  revalidate(g.locale, g.projectId);
  return ok();
}
