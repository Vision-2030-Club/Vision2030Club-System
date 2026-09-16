import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Card, EmptyState, Input, Label, Select, Textarea } from '@/components/ui';
import { formatDateTime, toDateTimeInput } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { siteUrl } from '@/lib/interviews/email';
import { createInterviewsClient } from '@/lib/supabase/interviews';
import { CopyField } from '../CopyField';
import {
  exportNowAction,
  releaseFeedbackAction,
  rotateTvTokenAction,
  updateEditionAction,
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
  const [{ count: held }, { data: lastExport }] = await Promise.all([
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
  ]);

  const whenInput = (iso: string | null) => (iso ? toDateTimeInput(new Date(iso)) : '');
  const tvUrl = edition.tv_token ? `${siteUrl()}/${locale}/interviews/tv/${edition.tv_token}` : null;
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
