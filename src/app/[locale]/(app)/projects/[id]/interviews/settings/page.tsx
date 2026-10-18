import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Card, EmptyState, Input, Label, Select, Textarea } from '@/components/ui';
import { formatDateTime, localized, toDateTimeInput } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { companyFinishes } from '@/lib/interviews/companyFinish';
import { siteUrl } from '@/lib/interviews/email';
import { loadCompanies } from '@/lib/interviews/queries';
import { visitorFeedbackOpen, visitorFeedbackUrl } from '@/lib/interviews/visitorFeedback';
import { walkinSettings, walkinUrl } from '@/lib/interviews/walkins';
import { qrDataUrls } from '@/lib/links';
import { DEFAULT_HOURS, floorLayout, LAYOUT_SLOT_LENGTHS } from '@/lib/interviews/floorLayout';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { CopyField } from '../CopyField';
import {
  exportNowAction,
  pullFloorSheetAction,
  releaseFeedbackAction,
  rotateTvTokenAction,
  rotateWalkinLinkAction,
  setCompanyFinishesAction,
  setSheetStatusEditsAction,
  syncFloorSheetAction,
  syncRegistrationSheetAction,
  updateEditionAction,
  updateFloorLayoutAction,
  updateVisitorFeedbackAction,
  updateWalkinsAction,
} from '../actions';

export default async function InterviewsSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access?.edition || !access.settings) notFound();
  const { edition, settings, role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');

  if (!can.manage(role)) {
    return <EmptyState>{tCommon('notPermitted')}</EmptyState>;
  }

  const db = createInterviewsClient();
  const walkins = walkinSettings(settings);
  const walkinLink = walkins.token ? walkinUrl(locale, walkins.token) : null;
  const visitorOpen = visitorFeedbackOpen(settings);
  const visitorLink = visitorFeedbackUrl(locale, edition.public_slug);
  const [{ count: held }, { data: lastExport }, companies, walkinQr, visitorQr] = await Promise.all([
    db
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('edition_id', edition.id)
      .is('released_at', null),
    db
      .from('exports')
      .select('taken_on, object_path, created_at')
      .eq('edition_id', edition.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadCompanies(db, edition.id),
    walkinLink ? qrDataUrls(walkinLink) : Promise.resolve(null),
    qrDataUrls(visitorLink),
  ]);
  const offCompanies = new Set(walkins.offCompanies);

  // The floor sheet's link: the settings first (a replacement for a deleted
  // file is saved there), else 0006's column where it exists (floorSheet.ts).
  const floorSheetUrl = settings.floor_sheet_url ?? edition.floor_sheet_url ?? null;
  const whenInput = (iso: string | null) => (iso ? toDateTimeInput(new Date(iso)) : '');
  const tvUrl = edition.tv_token ? `${siteUrl()}/${locale}/interviews/tv/${edition.tv_token}` : null;
  const layout = floorLayout(settings);
  const sheetEdits = settings.sheet_status_edits === true;
  const labelRows = [...settings.rating_labels, ...Array(6).fill(null)].slice(0, 6);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <h2 className="mb-3 font-semibold">{t('settings.edition')}</h2>
        <ActionForm action={updateEditionAction} submitLabel={tCommon('save')}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="project_id" value={id} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="name_en">{t('settings.nameEn')}</Label>
              <Input id="name_en" name="name_en" defaultValue={edition.name_en} required />
            </div>
            <div>
              <Label htmlFor="name_ar">{t('settings.nameAr')}</Label>
              <Input id="name_ar" name="name_ar" defaultValue={edition.name_ar} required />
            </div>
            <div>
              <Label htmlFor="public_slug">{t('settings.slug')}</Label>
              <Input
                id="public_slug"
                name="public_slug"
                dir="ltr"
                pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
                defaultValue={edition.public_slug}
                required
              />
              <p className="mt-1 text-xs text-ink-muted">{t('settings.slugHint')}</p>
            </div>
            <div>
              <Label htmlFor="status">{t('settings.status')}</Label>
              <Select id="status" name="status" defaultValue={edition.status}>
                <option value="draft">{t('status.draft')}</option>
                <option value="active">{t('status.active')}</option>
                <option value="archived">{t('status.archived')}</option>
              </Select>
              <p className="mt-1 text-xs text-ink-muted">{t('settings.statusHint')}</p>
            </div>
          </div>

          <fieldset className="mt-2">
            <legend className="mb-2 text-sm font-medium">{t('settings.gates')}</legend>
            <p className="mb-2 text-xs text-ink-muted">{t('settings.gatesHint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="apply_opens_at">{t('settings.applyOpens')}</Label>
                <Input id="apply_opens_at" name="apply_opens_at" type="datetime-local" dir="ltr" defaultValue={whenInput(edition.apply_opens_at)} />
              </div>
              <div>
                <Label htmlFor="apply_closes_at">{t('settings.applyCloses')}</Label>
                <Input id="apply_closes_at" name="apply_closes_at" type="datetime-local" dir="ltr" defaultValue={whenInput(edition.apply_closes_at)} />
              </div>
              <div>
                <Label htmlFor="booking_opens_at">{t('settings.bookingOpens')}</Label>
                <Input id="booking_opens_at" name="booking_opens_at" type="datetime-local" dir="ltr" defaultValue={whenInput(edition.booking_opens_at)} />
              </div>
              <div>
                <Label htmlFor="booking_closes_at">{t('settings.bookingCloses')}</Label>
                <Input id="booking_closes_at" name="booking_closes_at" type="datetime-local" dir="ltr" defaultValue={whenInput(edition.booking_closes_at)} />
              </div>
            </div>
          </fieldset>

          <fieldset className="mt-2">
            <legend className="mb-2 text-sm font-medium">{t('settings.rules')}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="max_preferences">{t('settings.maxPreferences')}</Label>
                <Input id="max_preferences" name="max_preferences" type="number" min={1} max={10} defaultValue={settings.max_preferences} required />
              </div>
              <div>
                <Label htmlFor="change_cutoff_hours">{t('settings.cutoffHours')}</Label>
                <Input id="change_cutoff_hours" name="change_cutoff_hours" type="number" min={0} max={168} defaultValue={settings.change_cutoff_hours} required />
              </div>
              <div>
                <Label htmlFor="tv_call_minutes">{t('settings.tvMinutes')}</Label>
                <Input id="tv_call_minutes" name="tv_call_minutes" type="number" min={1} max={60} defaultValue={settings.tv_call_minutes} required />
              </div>
              <div>
                <Label htmlFor="feedback_email_mode">{t('settings.feedbackMode')}</Label>
                <Select id="feedback_email_mode" name="feedback_email_mode" defaultValue={settings.feedback_email_mode}>
                  <option value="on_release">{t('settings.feedbackOnRelease')}</option>
                  <option value="immediately">{t('settings.feedbackImmediately')}</option>
                </Select>
              </div>
            </div>
          </fieldset>

          <fieldset className="mt-2">
            <legend className="mb-2 text-sm font-medium">{t('settings.ratingLabels')}</legend>
            <p className="mb-2 text-xs text-ink-muted">{t('settings.ratingLabelsHint')}</p>
            <div className="space-y-2">
              {labelRows.map((label, i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  <Input name="rating_key" dir="ltr" placeholder="key" defaultValue={label?.key ?? ''} aria-label={`key ${i + 1}`} />
                  <Input name="rating_en" placeholder="English" defaultValue={label?.en ?? ''} aria-label={`English ${i + 1}`} />
                  <Input name="rating_ar" placeholder="العربية" defaultValue={label?.ar ?? ''} aria-label={`Arabic ${i + 1}`} />
                </div>
              ))}
            </div>
          </fieldset>
        </ActionForm>
      </Card>

      <div className="space-y-4">
        <Card>
          <h2 className="mb-1 font-semibold">{t('layout.title')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('layout.hint')}</p>
          <ActionForm action={updateFloorLayoutAction} submitLabel={tCommon('save')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={id} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="layout_from">{t('layout.fromDay')}</Label>
                <Input id="layout_from" name="from_day" type="date" dir="ltr" defaultValue={layout?.from_day ?? ''} />
              </div>
              <div>
                <Label htmlFor="layout_to">{t('layout.toDay')}</Label>
                <Input id="layout_to" name="to_day" type="date" dir="ltr" defaultValue={layout?.to_day ?? ''} />
              </div>
              <div>
                <Label htmlFor="layout_start">{t('layout.start')}</Label>
                <Input id="layout_start" name="start" type="time" dir="ltr" step={300} defaultValue={layout?.start ?? DEFAULT_HOURS.start} />
              </div>
              <div>
                <Label htmlFor="layout_end">{t('layout.end')}</Label>
                <Input id="layout_end" name="end" type="time" dir="ltr" step={300} defaultValue={layout?.end ?? DEFAULT_HOURS.end} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="layout_slot">{t('layout.slotMinutes')}</Label>
                <Select id="layout_slot" name="slot_minutes" defaultValue={String(layout?.slot_minutes ?? DEFAULT_HOURS.slot_minutes)}>
                  {LAYOUT_SLOT_LENGTHS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="text-xs text-ink-muted">{t('layout.clearHint')}</p>
          </ActionForm>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('walkinSettings.title')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('walkinSettings.hint')}</p>
          <ActionForm action={updateWalkinsAction} submitLabel={tCommon('save')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={id} />
            <div>
              <Label htmlFor="walkins_open">{t('walkinSettings.status')}</Label>
              <Select id="walkins_open" name="walkins_open" defaultValue={walkins.open ? 'on' : 'off'}>
                <option value="off">{t('walkinSettings.closed')}</option>
                <option value="on">{t('walkinSettings.open')}</option>
              </Select>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t('walkinSettings.companies')}</legend>
              <div className="space-y-1">
                {companies
                  .filter((c) => !c.is_hidden)
                  .map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input type="hidden" name="listed_company" value={c.id} />
                      <input type="checkbox" name="walkin_company" value={c.id} defaultChecked={!offCompanies.has(c.id)} />
                      {localized(c, 'name', locale)}
                    </label>
                  ))}
              </div>
            </fieldset>
          </ActionForm>
          {walkinLink && walkinQr ? (
            <div className="mt-4 space-y-3 border-t border-line pt-3">
              <CopyField label={t('walkinSettings.link')} value={walkinLink} />
              {/* A data URL made on the server: nothing for next/image to optimise. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={walkinQr.svg} alt={t('walkinSettings.qrAlt')} width={160} height={160} className="size-40 rounded-lg border border-line" />
              <div className="flex flex-wrap gap-2 text-sm">
                <a
                  href={walkinQr.png}
                  download="walk-in-qr.png"
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-ink hover:bg-surface-muted"
                >
                  {t('walkinSettings.downloadQr')}
                </a>
              </div>
              <ConfirmForm
                action={rotateWalkinLinkAction}
                trigger={t('walkinSettings.newLink')}
                title={t('walkinSettings.newLinkTitle')}
                body={t('walkinSettings.newLinkBody')}
                confirmLabel={t('walkinSettings.newLink')}
                variant="secondary"
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="project_id" value={id} />
              </ConfirmForm>
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('visitorFeedback.settingsTitle')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('visitorFeedback.settingsHint')}</p>
          <ActionForm action={updateVisitorFeedbackAction} submitLabel={tCommon('save')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={id} />
            <div>
              <Label htmlFor="visitor_feedback_open">{t('walkinSettings.status')}</Label>
              <Select id="visitor_feedback_open" name="visitor_feedback_open" defaultValue={visitorOpen ? 'on' : 'off'}>
                <option value="off">{t('walkinSettings.closed')}</option>
                <option value="on">{t('walkinSettings.open')}</option>
              </Select>
            </div>
          </ActionForm>
          <div className="mt-4 space-y-3 border-t border-line pt-3">
            <CopyField label={t('walkinSettings.link')} value={visitorLink} />
            {/* A data URL made on the server: nothing for next/image to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={visitorQr.svg} alt={t('visitorFeedback.qrAlt')} width={160} height={160} className="size-40 rounded-lg border border-line" />
            <div className="flex flex-wrap gap-2 text-sm">
              <a
                href={visitorQr.png}
                download="visitor-feedback-qr.png"
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-ink hover:bg-surface-muted"
              >
                {t('walkinSettings.downloadQr')}
              </a>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('settings.tv')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('settings.tvHint')}</p>
          {tvUrl ? <CopyField label={t('overview.tvLink')} value={tvUrl} /> : null}
          <div className="mt-3">
            <ConfirmForm
              action={rotateTvTokenAction}
              trigger={t('settings.rotateTv')}
              title={t('settings.rotateTvTitle')}
              body={t('settings.rotateTvBody')}
              confirmLabel={t('settings.rotateTv')}
              variant="secondary"
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="project_id" value={id} />
            </ConfirmForm>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('settings.floorSheet')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('settings.floorSheetHint')}</p>
          {floorSheetUrl ? (
            <a
              href={floorSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-3 block break-all text-sm font-medium text-brand-600 hover:underline"
              dir="ltr"
            >
              {floorSheetUrl}
            </a>
          ) : (
            <p className="mb-3 text-sm text-ink-muted">{t('settings.floorSheetNone')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <ActionForm action={syncFloorSheetAction} submitLabel={t('settings.floorSheetSync')} variant="secondary" className="space-y-0">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="project_id" value={id} />
            </ActionForm>
            {sheetEdits ? (
              <ActionForm
                action={pullFloorSheetAction}
                submitLabel={t('settings.floorSheetPull')}
                successText={t('settings.floorSheetPulled')}
                variant="secondary"
                className="space-y-0"
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="project_id" value={id} />
              </ActionForm>
            ) : null}
          </div>
          {sheetEdits ? <p className="mt-2 text-xs text-ink-muted">{t('settings.floorSheetPullHint')}</p> : null}

          <div className="mt-4 border-t border-line pt-3">
            <ActionForm action={setSheetStatusEditsAction} submitLabel={tCommon('save')}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="project_id" value={id} />
              <div>
                <Label htmlFor="sheet_status_edits">{t('settings.sheetEdits')}</Label>
                <Select id="sheet_status_edits" name="sheet_status_edits" defaultValue={sheetEdits ? 'on' : 'off'}>
                  <option value="off">{t('settings.sheetEditsOff')}</option>
                  <option value="on">{t('settings.sheetEditsOn')}</option>
                </Select>
              </div>
              <p className="text-xs text-ink-muted">{t('settings.sheetEditsHint')}</p>
            </ActionForm>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('settings.registrationsSheet')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('settings.registrationsSheetHint')}</p>
          {settings.registrations_sheet_url ? (
            <a
              href={settings.registrations_sheet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-3 block break-all text-sm font-medium text-brand-600 hover:underline"
              dir="ltr"
            >
              {settings.registrations_sheet_url}
            </a>
          ) : (
            <p className="mb-3 text-sm text-ink-muted">{t('settings.registrationsSheetNone')}</p>
          )}
          <ActionForm
            action={syncRegistrationSheetAction}
            submitLabel={t('settings.registrationsSheetSync')}
            variant="secondary"
            className="space-y-2"
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={id} />
          </ActionForm>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('settings.feedback')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('settings.feedbackHint', { count: held ?? 0 })}</p>
          <ConfirmForm
            action={releaseFeedbackAction}
            trigger={t('settings.releaseFeedback')}
            title={t('settings.releaseFeedbackTitle')}
            body={t('settings.releaseFeedbackBody', { count: held ?? 0 })}
            confirmLabel={t('settings.releaseFeedback')}
            variant="primary"
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={id} />
          </ConfirmForm>

          <div className="mt-4 border-t border-line pt-3">
            <ActionForm action={setCompanyFinishesAction} submitLabel={tCommon('save')}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="project_id" value={id} />
              <div>
                <Label htmlFor="company_finishes">{t('settings.companyFinishes')}</Label>
                <Select id="company_finishes" name="company_finishes" defaultValue={companyFinishes(settings) ? 'on' : 'off'}>
                  <option value="on">{t('settings.companyFinishesOn')}</option>
                  <option value="off">{t('settings.companyFinishesOff')}</option>
                </Select>
              </div>
              <p className="text-xs text-ink-muted">{t('settings.companyFinishesHint')}</p>
            </ActionForm>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('settings.export')}</h2>
          <p className="mb-3 text-xs text-ink-muted">
            {lastExport
              ? t('settings.lastExport', { when: formatDateTime(lastExport.created_at as string, locale) })
              : t('settings.noExport')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ActionForm action={exportNowAction} submitLabel={t('settings.exportNow')} variant="secondary" className="space-y-0">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="project_id" value={id} />
            </ActionForm>
            <a
              href={`/api/interviews/export?project=${id}`}
              className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
            >
              {t('settings.download')}
            </a>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t('settings.notes')}</h2>
          <Textarea readOnly rows={5} className="text-xs" defaultValue={t('settings.notesBody')} />
        </Card>
      </div>
    </div>
  );
}
