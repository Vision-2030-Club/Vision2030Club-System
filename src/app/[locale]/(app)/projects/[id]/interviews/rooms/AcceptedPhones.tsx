import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { Label, Textarea } from '@/components/ui';
import type { AcceptedPhone } from '@/lib/interviews/queries';
import { acceptSessionPhonesAction, unacceptSessionPhoneAction } from '../actions';

/**
 * Who HR accepted for one assignment (a company in a room on one day), and a
 * box to accept more by phone number (acceptSessionPhonesAction). Starts
 * empty: only numbers HR types are used.
 */
export async function AcceptedPhones({
  locale,
  projectId,
  sessionId,
  phones,
}: {
  locale: string;
  projectId: string;
  sessionId: string;
  phones: AcceptedPhone[];
}) {
  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');
  return (
    <div className="space-y-3">
      {phones.length ? (
        <ul className="space-y-1 text-sm">
          {phones.map((p) => (
            <li key={p.application_id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5">
              <span className="ltr-nums">
                {p.phone}
                {p.name ? ` · ${p.name}` : ''}
              </span>
              <form action={unacceptSessionPhoneAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="session_id" value={sessionId} />
                <input type="hidden" name="application_id" value={p.application_id} />
                <button type="submit" className="text-xs text-ink-muted hover:text-danger-600">
                  {tCommon('delete')}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-muted">{t('companies.noAcceptedPhones')}</p>
      )}

      <ActionForm action={acceptSessionPhonesAction} submitLabel={tCommon('save')}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="session_id" value={sessionId} />
        <div>
          <Label htmlFor={`${sessionId}-phones`}>{t('companies.addPhones')}</Label>
          <Textarea id={`${sessionId}-phones`} name="phones" rows={3} placeholder={'05xxxxxxxx\n05xxxxxxxx'} dir="ltr" />
          <p className="mt-1 text-xs text-ink-muted">{t('companies.addPhonesHint')}</p>
        </div>
      </ActionForm>
    </div>
  );
}
