import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { MemberLink } from '@/components/MemberLink';
import { Card, EmptyState, PageHeader, Select } from '@/components/ui';
import { scopeFor } from '@/lib/auth/session';
import { localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import { createClient } from '@/lib/supabase/server';
import { addReceptionistAction, removeReceptionistAction } from './actions';

type PersonRow = {
  member_id: string;
  members: { id: string; name_en: string; name_ar: string } | null;
};

/**
 * The reception team (club 0078): the members who may open Quroosh's
 * Reception page and work the event's gate, besides the project's managers
 * and the HR team, who always can. The same list Mock Interviews keeps for
 * its own reception (0069), and the same people choose it: the project's
 * managers and HR's Directors.
 *
 * This page reads and writes the CLUB database only, as the person
 * themselves; the policy on `project_component_people` is the rule.
 */
export default async function QurooshReceptionTeamPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getQurooshAccess(id);
  if (!access) notFound();

  const t = await getTranslations('quroosh.receptionTeam');
  const tCommon = await getTranslations('common');
  const header = <PageHeader title={t('title')} description={localized(access.project, 'name', locale)} />;

  const [membersScope, directoryScope] = await Promise.all([scopeFor('members.manage'), scopeFor('members.directory')]);
  if (!(can.manage(access.role) || membersScope === 'all')) {
    return (
      <>
        {header}
        <EmptyState>{tCommon('notPermitted')}</EmptyState>
      </>
    );
  }

  const supabase = await createClient();
  const [{ data: people }, { data: allMembers }] = await Promise.all([
    // `member_id` is named because `added_by` is a second FK to members.
    supabase
      .from('project_component_people')
      .select('member_id, members:member_id(id, name_en, name_ar)')
      .eq('project_id', id)
      .eq('role', 'reception'),
    supabase.from('members').select('id, name_en, name_ar').eq('status', 'active').order('name_en'),
  ]);
  const team = (people ?? []) as unknown as PersonRow[];
  const candidates = (allMembers ?? []).filter((m) => !team.some((row) => row.member_id === m.id));

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 font-semibold text-ink">{t('team')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('teamHint')}</p>

          {team.length ? (
            <ul className="mb-3 divide-y divide-line text-sm">
              {team.map((row) => (
                <li key={row.member_id} className="flex items-center justify-between gap-2 py-2">
                  <MemberLink id={row.member_id} viewerId={access.me.id} canOpenAny={directoryScope === 'all'}>
                    {localized(row.members, 'name', locale)}
                  </MemberLink>
                  <ActionForm
                    action={removeReceptionistAction}
                    submitLabel={t('remove')}
                    variant="secondary"
                    className="space-y-0"
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="project_id" value={id} />
                    <input type="hidden" name="member_id" value={row.member_id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-ink-muted">{t('none')}</p>
          )}

          <ActionForm action={addReceptionistAction} submitLabel={t('add')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="project_id" value={id} />
            <Select name="member_id" aria-label={t('add')} required>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {localized(m, 'name', locale)}
                </option>
              ))}
            </Select>
          </ActionForm>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold text-ink">{t('automatic')}</h2>
          <p className="text-sm text-ink-muted">{t('automaticHint')}</p>
        </Card>
      </div>
    </div>
  );
}
