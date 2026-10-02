import type { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Disclosure } from '@/components/Disclosure';
import { Badge, Card, Label, Select } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { APPLY_FIELDS, FIELD_LABELS, FIELD_MODES, type ApplyFields } from '@/lib/interviews/applyFields';
import { siteUrl } from '@/lib/interviews/email';
import type { Edition } from '@/lib/interviews/types';
import { CopyField } from './CopyField';
import { syncRegistrationSheetAction, updateApplyFieldsAction } from './actions';

type T = Awaited<ReturnType<typeof getTranslations<'interviews'>>>;
type TCommon = Awaited<ReturnType<typeof getTranslations<'common'>>>;

/**
 * The public application link, whether it is taking applications right now,
 * the registrations Google Sheet every application lands in (with Sync now
 * for managers, the same button as in Settings), and (for managers) which
 * questions it asks (lib/interviews/applyFields.ts). The Register tab asks
 * the same questions.
 */
/** Asked on every form, whatever the settings say; shown so nobody goes looking for them. */
const ALWAYS_ASKED = ['applicants.name', 'applicants.email', 'apply.cv', 'apply.companies'] as const;

export function ApplicationFormCard({
  locale,
  projectId,
  edition,
  fields,
  sheetUrl,
  manage,
  now,
  t,
  tCommon,
}: {
  locale: string;
  projectId: string;
  edition: Edition;
  fields: ApplyFields;
  /** The registrations sheet, once created (kept in the edition's settings). */
  sheetUrl: string | null;
  manage: boolean;
  /** Read once by the page; a component that reads the clock is not pure. */
  now: number;
  t: T;
  tCommon: TCommon;
}) {
  const opens = edition.apply_opens_at ? new Date(edition.apply_opens_at).getTime() : null;
  const closes = edition.apply_closes_at ? new Date(edition.apply_closes_at).getTime() : null;
  const active = edition.status === 'active' && opens !== null && closes !== null;
  const state =
    active && now >= opens && now < closes
      ? t('applyForm.open', { when: formatDateTime(edition.apply_closes_at, locale) })
      : active && now < opens
        ? t('applyForm.notYet', { when: formatDateTime(edition.apply_opens_at, locale) })
        : t('applyForm.closed');
  const isOpen = active && now >= opens && now < closes;
  const asked = APPLY_FIELDS.filter((field) => fields[field] !== 'off');

  return (
    <Card>
      <h2 className="mb-1 font-semibold">{t('applyForm.title')}</h2>
      <p className="mb-3 text-xs text-ink-muted">{t('applyForm.hint')}</p>
      <CopyField label={t('register.publicLink')} value={`${siteUrl()}/${locale}/interviews/apply/${edition.public_slug}`} />
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={isOpen ? 'ok' : 'warn'}>{isOpen ? t('applyForm.openBadge') : t('applyForm.closedBadge')}</Badge>
        <span className="text-ink-muted">{state}</span>
        {manage && !isOpen ? (
          <Link href={`/projects/${projectId}/interviews/settings`} className="font-medium text-brand-700 hover:underline">
            {t('applyForm.openSettings')}
          </Link>
        ) : null}
      </div>

      {/* The registrations sheet (registrationSheet.ts): every application, one row each. */}
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="mb-1 text-sm font-semibold">{t('settings.registrationsSheet')}</h3>
        <p className="mb-2 text-xs text-ink-muted">{t('applyForm.sheetHint')}</p>
        {sheetUrl ? (
          <a
            href={sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-2 inline-block text-sm font-medium text-brand-700 hover:underline"
          >
            {t('applyForm.openSheet')}
          </a>
        ) : (
          <p className="mb-2 text-sm text-ink-muted">{t('settings.registrationsSheetNone')}</p>
        )}
        {manage ? (
          <ActionForm
            action={syncRegistrationSheetAction}
            submitLabel={t('settings.registrationsSheetSync')}
            variant="secondary"
            className="space-y-2"
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={projectId} />
          </ActionForm>
        ) : null}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <h3 className="mb-1 text-sm font-semibold">{t('applyForm.questions')}</h3>
        <p className="mb-2 text-xs text-ink-muted">{t('applyForm.alwaysAsked')}</p>
        <div className="mb-3 flex flex-wrap gap-1">
          {ALWAYS_ASKED.map((key) => (
            <Badge key={key} tone="brand">
              {t(key)}
            </Badge>
          ))}
          {asked.map((field) => (
            <Badge key={field} tone={fields[field] === 'required' ? 'brand' : 'neutral'}>
              {t(FIELD_LABELS[field])}
              {fields[field] === 'optional' ? ` · ${t('applyForm.mode.optional')}` : ''}
            </Badge>
          ))}
        </div>
        {manage ? (
          <Disclosure label={t('applyForm.editQuestions')} title={t('applyForm.questions')}>
            <ActionForm action={updateApplyFieldsAction} submitLabel={tCommon('save')}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="project_id" value={projectId} />
              <div className="space-y-2">
                {/* Not settings: the database needs these four (applyFields.ts). */}
                {ALWAYS_ASKED.map((key) => (
                  <div key={key} className="grid grid-cols-2 items-center gap-3">
                    <span className="text-sm font-medium text-ink">{t(key)}</span>
                    <span className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-ink-muted">
                      {t('applyForm.mode.always')}
                    </span>
                  </div>
                ))}
                {APPLY_FIELDS.map((field) => (
                  <div key={field} className="grid grid-cols-2 items-center gap-3">
                    <Label htmlFor={`field_${field}`}>{t(FIELD_LABELS[field])}</Label>
                    <Select id={`field_${field}`} name={`field_${field}`} defaultValue={fields[field]}>
                      {FIELD_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {t(`applyForm.mode.${mode}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </ActionForm>
          </Disclosure>
        ) : null}
      </div>
    </Card>
  );
}
