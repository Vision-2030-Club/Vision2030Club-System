import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionForm } from '@/components/ActionForm';
import { MemberLink } from '@/components/MemberLink';
import { Card, EmptyState, Select } from '@/components/ui';
import { getMyMember, scopeFor } from '@/lib/auth/session';
import { localized } from '@/lib/format';
import { can, getInterviewAccess } from '@/lib/interviews/access';
import { createClient } from '@/lib/supabase/server';
import { addPersonAction, removePersonAction } from '../actions';

type PersonRow = {
  member_id: string;
  role: 'organizer' | 'hr';
  members: { id: string; name_en: string; name_ar: string } | null;
};

/**
 * Who else may enter. This page reads and writes the CLUB database only:
 * organizers are the project's to choose (its managers), HR people are HR's
 * (whoever holds members.manage). The policies in 0062 are the rule; the
 * forms below are offered to the people they will accept.
 */
export default async function InterviewsPeoplePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await getInterviewAccess(id);
  if (!access) notFound();
  const { role } = access;

  const t = await getTranslations('interviews');
  const tCommon = await getTranslations('common');

  if (!can.roster(role)) {
    return <EmptyState>{tCommon('notPermitted')}</EmptyState>;
  }

  const supabase = await createClient();
  const [me, membersScope, canOpenProfiles, { data: people }, { data: allMembers }] =
    await Promise.all([
      getMyMember(),
      scopeFor('members.manage'),
      scopeFor('members.directory').then((s) => s === 'all'),
      // `member_id` is named because `added_by` is a second FK to members.
      supabase
        .from('project_component_people')
        .select('member_id, role, members:member_id(id, name_en, name_ar)')
        .eq('project_id', id),
      supabase
        .from('members')
        .select('id, name_en, name_ar')
        .eq('status', 'active')
        .order('name_en'),
    ]);

  const rows = (people ?? []) as unknown as PersonRow[];
  const organizers = rows.filter((r) => r.role === 'organizer');
  const hrPeople = rows.filter((r) => r.role === 'hr');
  const canAddOrganizers = can.manage(role);
  const canAddHr = membersScope === 'all';

  const roster = (
    list: PersonRow[],
    roleKey: 'organizer' | 'hr',
    canEdit: boolean,
  ) => (
    <>
      {list.length ? (
        <ul className="mb-3 divide-y divide-line text-sm">
          {list.map((row) => (
            <li key={row.member_id} className="flex items-center justify-between gap-2 py-2">
              <MemberLink id={row.member_id} viewerId={me?.id} canOpenAny={canOpenProfiles}>
                {localized(row.members, 'name', locale)}
              </MemberLink>
              {canEdit ? (
                <ActionForm action={removePersonAction} submitLabel={tCommon('delete')} variant="secondary" className="space-y-0">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="member_id" value={row.member_id} />
                  <input type="hidden" name="role" value={roleKey} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-ink-muted">{tCommon('none')}</p>
      )}

      {canEdit ? (
        <ActionForm action={addPersonAction} submitLabel={t('people.add')}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="role" value={roleKey} />
          <Select name="member_id" aria-label={t('people.add')} required>
            {(allMembers ?? [])
              .filter((m) => !list.some((r) => r.member_id === m.id))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {localized(m, 'name', locale)}
                </option>
              ))}
          </Select>
        </ActionForm>
      ) : null}
    </>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-1 font-semibold">{t('people.organizers')}</h2>
        <p className="mb-3 text-xs text-ink-muted">{t('people.organizersHint')}</p>
        {roster(organizers, 'organizer', canAddOrganizers)}
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">{t('people.hr')}</h2>
        <p className="mb-3 text-xs text-ink-muted">{t('people.hrHint')}</p>
        {roster(hrPeople, 'hr', canAddHr)}
      </Card>

      <Card className="lg:col-span-2">
        <h2 className="mb-1 font-semibold">{t('people.automatic')}</h2>
        <p className="text-sm text-ink-muted">{t('people.automaticHint')}</p>
      </Card>
    </div>
  );
}
