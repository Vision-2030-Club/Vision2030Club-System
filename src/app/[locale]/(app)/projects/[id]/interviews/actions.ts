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
import { kickFloorSheetSync, pullFloorSheetStages, syncFloorSheet } from '@/lib/interviews/floorSheet';
import { takeExport } from '@/lib/interviews/export';
import { removeCv, uploadCv } from '@/lib/interviews/cv';
import { kickRegistrationAppend, syncRegistrationSheet } from '@/lib/interviews/registrationSheet';
import { APPLY_FIELDS, FIELD_LABELS, FIELD_MODES, resolveApplyFields, type FieldMode } from '@/lib/interviews/applyFields';
import { applicationPayload } from '@/lib/interviews/applyPayload';
import { choosesFullCompany, fullCompanyIds } from '@/lib/interviews/fullCompanies';
import { normalisePhone } from '@/lib/interviews/phone';
import type { EditionSettings, Stage } from '@/lib/interviews/types';
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

/** Settings → Rebuild: the registrations sheet rewritten from the database (registrationSheet.ts). */
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
    const { updated, skipped } = await pullFloorSheetStages(g.access.edition.id, g.access.actor);
    await syncFloorSheet(g.access.edition.id);
    revalidate(g.locale, g.projectId);
    return ok('saved', { updated: String(updated), skipped: String(skipped) });
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
 * Edits a room created by createRoomAction: the room's own booth label
 * (`name`), and the company sitting in it — its display name and logo —
 * kept as two separate fields now rather than one shared value. The pair
 * is found through any session already scheduled for the company — the only
 * place the two are linked — rather than a new column, since createRoomAction
 * always creates both at once.
 */
export async function renameRoomAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const companyId = requiredText(formData, 'company_id');
  const name = requiredText(formData, 'name');
  const companyName = text(formData, 'company_name') || name;
  // The Arabic name falls back to the English one, never the other way: the
  // candidate pages show whichever matches their language.
  const companyNameAr = text(formData, 'company_name_ar') || companyName;
  const logoUrl = text(formData, 'logo_url') ?? '';

  const db = createInterviewsClient();
  const { error: companyError } = await db.rpc('upsert_company', {
    p_edition: g.access.edition.id,
    p_company: companyId,
    p_payload: { name_en: companyName, name_ar: companyNameAr, logo_url: logoUrl },
    p_actor: g.access.actor,
  });
  if (companyError) return fromPostgrest(companyError);

  const { data: session } = await db
    .from('sessions')
    .select('room_id')
    .eq('company_id', companyId)
    .limit(1)
    .maybeSingle();

  if (session?.room_id) {
    const { error: roomError } = await db.rpc('upsert_room', {
      p_edition: g.access.edition.id,
      p_room: session.room_id,
      p_payload: { name },
      p_actor: g.access.actor,
    });
    if (roomError) return fromPostgrest(roomError);
  }

  revalidate(g.locale, g.projectId);
  return ok();
}

/**
 * "Delete" a room — a soft delete, on purpose. It hides the company from
 * this grid and marks the room inactive (so its candidate link stops
 * working, per room/[token]/page.tsx), but touches nothing else: the
 * sessions, slots and bookings stay exactly as they are. The floor sheet
 * reads that same live data, so a deleted room's history keeps showing
 * there — nothing to resync or preserve specially, because nothing about
 * the underlying data changed. `deleted: 'false'` reverses it.
 */
export async function setRoomDeletedAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const companyId = requiredText(formData, 'company_id');
  const deleted = text(formData, 'deleted') !== 'false';

  const db = createInterviewsClient();
  const { error: companyError } = await db.rpc('upsert_company', {
    p_edition: g.access.edition.id,
    p_company: companyId,
    p_payload: { is_hidden: deleted },
    p_actor: g.access.actor,
  });
  if (companyError) return fromPostgrest(companyError);

  const { data: session } = await db
    .from('sessions')
    .select('room_id')
    .eq('company_id', companyId)
    .limit(1)
    .maybeSingle();

  if (session?.room_id) {
    const { error: roomError } = await db.rpc('upsert_room', {
      p_edition: g.access.edition.id,
      p_room: session.room_id,
      p_payload: { is_active: !deleted },
      p_actor: g.access.actor,
    });
    if (roomError) return fromPostgrest(roomError);
  }

  revalidate(g.locale, g.projectId);
  return ok();
}

export async function upsertRoomAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const db = createInterviewsClient();
  const { error } = await db.rpc('upsert_room', {
    p_edition: g.access.edition.id,
    p_room: text(formData, 'room_id'),
    p_payload: {
      name: text(formData, 'name'),
      note: text(formData, 'note') ?? '',
      sort_order: text(formData, 'sort_order'),
      is_active: text(formData, 'is_active'),
    },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

  revalidate(g.locale, g.projectId);
  return ok();
}

/**
 * Adds or edits a company from the Applicants tab (a plain company, no room or
 * session: the apply-form flow). Only the fields the form sends are changed,
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
 * The simplified "room" flow (0005): one button creates the room, the
 * company behind it (with its own candidate-facing link), and that one
 * day's 15-minute-slot session for the chosen hours, so nothing further
 * needs scheduling by hand. One room per day is the intended use (hence a
 * day picker rather than a fixed range): the candidate booking page shows
 * a room's slots flat, with no day tabs, on the assumption there is only
 * ever one day to show. Each step is its own transaction; if a later step
 * fails the earlier ones stand, same as every other admin form here that
 * is not meant to be re-run under load.
 */
const ROOM_SLOT_MINUTES = 15;

export async function createRoomAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.manage);
  if ('error' in g) return fail(g.error);

  const name = requiredText(formData, 'name');
  const companyName = text(formData, 'company_name') || name;
  const companyNameAr = text(formData, 'company_name_ar') || companyName;
  const logoUrl = text(formData, 'logo_url') ?? '';
  const day = requiredText(formData, 'day');
  const startTime = requiredText(formData, 'start_time');
  const endTime = requiredText(formData, 'end_time');
  const db = createInterviewsClient();

  const { data: room, error: roomError } = await db.rpc('upsert_room', {
    p_edition: g.access.edition.id,
    p_room: null,
    p_payload: { name },
    p_actor: g.access.actor,
  });
  if (roomError) return fromPostgrest(roomError);

  const { data: company, error: companyError } = await db.rpc('upsert_company', {
    p_edition: g.access.edition.id,
    p_company: null,
    p_payload: {
      name_en: companyName,
      name_ar: companyNameAr,
      logo_url: logoUrl,
      access_token: newToken(),
      candidate_token: newToken(),
    },
    p_actor: g.access.actor,
  });
  if (companyError) return fromPostgrest(companyError);

  const { error: sessionError } = await db.rpc('create_session', {
    p_edition: g.access.edition.id,
    p_payload: {
      company_id: company.id,
      room_id: room.id,
      day,
      start_time: startTime,
      end_time: endTime,
      slot_minutes: ROOM_SLOT_MINUTES,
    },
    p_actor: g.access.actor,
  });
  if (sessionError) return fromPostgrest(sessionError);

  revalidate(g.locale, g.projectId);
  return ok('created');
}

/**
 * HR's accepted list for one room, pasted as phone numbers (one per line, or
 * separated by commas). Nothing is added automatically: only the numbers HR
 * types are used. Each is matched to the applicant who applied with it
 * (normalised, so +966 5… and 05… are the same number; an application with an
 * email first, then the newest) and accepted for this room's company with
 * `decide_preference`, the same function as the Accept button on an
 * applicant's page, which needs no migration after 0001. That also queues the
 * student's acceptance email with their personal booking link, delivered once
 * email is configured.
 *
 * A number that matches nobody, or a student who did not choose this
 * company, is listed back rather than accepted.
 */
export async function acceptPhonesAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const g = await guard(formData, can.decide);
  if ('error' in g) return fail(g.error);
  const t = await getTranslations({ locale: g.locale, namespace: 'interviews' });

  const companyId = requiredText(formData, 'company_id');
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

  type Candidate = { id: string; phone: string | null; email: string | null; submitted_at: string };
  const byPhone = new Map<string, Candidate>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from('applications')
      .select('id, phone, email, submitted_at')
      .eq('edition_id', editionId)
      .not('phone', 'is', null)
      .range(from, from + 999);
    const rows = (data ?? []) as Candidate[];
    for (const row of rows) {
      const key = normalisePhone(row.phone);
      if (!key) continue;
      const held = byPhone.get(key);
      const better =
        !held ||
        (row.email !== null && held.email === null) ||
        ((row.email !== null) === (held.email !== null) && row.submitted_at > held.submitted_at);
      if (better) byPhone.set(key, row);
    }
    if (rows.length < 1000) break;
  }

  const notFound: string[] = [];
  const notChosen: string[] = [];
  for (const phone of typed) {
    const match = byPhone.get(normalisePhone(phone) ?? '');
    if (!match) {
      notFound.push(phone);
      continue;
    }
    const { error } = await db.rpc('decide_preference', {
      p_application: match.id,
      p_company: companyId,
      p_decision: 'accepted',
      p_note: '',
      p_actor: g.access.actor,
    });
    if (error?.hint === 'not_found') notChosen.push(phone);
    else if (error) return fromPostgrest(error);
  }

  revalidate(g.locale, g.projectId);
  if (notFound.length || notChosen.length) {
    const parts = [t('companies.phonesAccepted', { count: typed.length - notFound.length - notChosen.length })];
    if (notFound.length) parts.push(t('companies.phonesNotFound', { phones: notFound.join(', ') }));
    if (notChosen.length) parts.push(t('companies.phonesNotChosen', { phones: notChosen.join(', ') }));
    return fail(parts.join(' '));
  }
  return ok('saved', { count: String(typed.length) });
}

/**
 * A plain form action (no useActionState, no per-row error UI) — same shape
 * as signOutAction in the app layout. Removing someone from an "accepted"
 * list is low-stakes and reversible by pasting their number back in, so it
 * does not need a confirmation dialog or its own feedback state. Puts their
 * preference for this company back to pending (decide_preference again).
 */
export async function unacceptPhoneAction(formData: FormData): Promise<void> {
  const g = await guard(formData, can.decide);
  if ('error' in g) return;

  const db = createInterviewsClient();
  await db.rpc('decide_preference', {
    p_application: requiredText(formData, 'application_id'),
    p_company: requiredText(formData, 'company_id'),
    p_decision: 'pending',
    p_note: '',
    p_actor: g.access.actor,
  });

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

  const db = createInterviewsClient();
  const { error } = await db.rpc('create_session', {
    p_edition: g.access.edition.id,
    p_payload: {
      company_id: requiredText(formData, 'company_id'),
      room_id: requiredText(formData, 'room_id'),
      day: requiredText(formData, 'day'),
      start_time: requiredText(formData, 'start_time'),
      end_time: requiredText(formData, 'end_time'),
      slot_minutes: Number(requiredText(formData, 'slot_minutes')),
    },
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

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
  const { error } = await db.rpc('delete_session', {
    p_session: requiredText(formData, 'session_id'),
    p_actor: g.access.actor,
  });
  if (error) return fromPostgrest(error);

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

  if (access.edition) kickFloorSheetSync(access.edition.id);
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
  kickFloorSheetSync(g.access.edition.id);
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
  kickFloorSheetSync(g.access.edition.id);
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
  kickFloorSheetSync(g.access.edition.id);
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
