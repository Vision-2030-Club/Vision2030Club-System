import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import {
  Alert,
  Badge,
  Card,
  Input,
  Label,
  Numeric,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import {
  changeRoleAction,
  resetPasswordAction,
  setSkillsAction,
  updateMemberAction,
  updateSensitiveAction,
} from '../actions';

export default async function MemberPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('members');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();
  const me = await getMyMember();

  const { data: member } = await supabase
    .from('members')
    .select(
      'id, name_en, name_ar, email, phone, student_id, status, college, academic_level, graduation_term, join_date, team_id, role_id, auth_user_id, teams(name_en, name_ar), roles(key, name_en, name_ar)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!member) notFound();

  // A separate table with its own policy: this simply returns nothing unless
  // the viewer is the member, an HR Director, or an admin (spec §5).
  const [{ data: sensitive }, { data: memberSkills }, { data: skills }] =
    await Promise.all([
      supabase.from('member_sensitive').select('national_id').eq('member_id', id).maybeSingle(),
      supabase.from('member_skills').select('skill_id').eq('member_id', id),
      supabase.from('skills').select('id, name_en, name_ar').order('name_en'),
    ]);

  const canManage = await hasPermission('members.manage');
  const canConfigureRoles = await hasPermission('roles.configure');
  const canSeeSensitive = await hasPermission('members.view_sensitive');
  const isSelf = me?.id === member.id;
  const canEdit = canManage || isSelf;

  const [{ data: teams }, { data: roles }] = await Promise.all([
    canManage
      ? supabase.from('teams').select('id, name_en, name_ar').order('name_en')
      : Promise.resolve({ data: null }),
    canConfigureRoles
      ? supabase.from('roles').select('id, name_en, name_ar').order('sort_order')
      : Promise.resolve({ data: null }),
  ]);

  const role = member.roles as unknown as Record<string, string>;
  const team = member.teams as unknown as Record<string, string>;
  const selectedSkills = new Set((memberSkills ?? []).map((s) => s.skill_id as string));

  return (
    <>
      <PageHeader
        title={locale === 'ar' ? member.name_ar : member.name_en}
        description={
          role?.key === 'team_director'
            ? `${localized(role, 'name', locale)} — ${localized(team, 'name', locale)}`
            : `${localized(role, 'name', locale)} · ${localized(team, 'name', locale)}`
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">{t('profile')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-muted">{t('email')}</dt>
            <dd dir="ltr" className="text-start">
              {member.email}
            </dd>
            <dt className="text-ink-muted">{t('studentId')}</dt>
            <dd>
              <Numeric>{member.student_id}</Numeric>
            </dd>
            <dt className="text-ink-muted">{t('phone')}</dt>
            <dd>{member.phone ? <Numeric>{member.phone}</Numeric> : '—'}</dd>
            <dt className="text-ink-muted">{t('college')}</dt>
            <dd>{member.college ?? '—'}</dd>
            <dt className="text-ink-muted">{t('academicLevel')}</dt>
            <dd>{member.academic_level ?? '—'}</dd>
            <dt className="text-ink-muted">{t('graduationTerm')}</dt>
            <dd>{member.graduation_term ?? '—'}</dd>
            <dt className="text-ink-muted">{t('joinDate')}</dt>
            <dd>{formatDate(member.join_date, locale)}</dd>
            <dt className="text-ink-muted">{t('status')}</dt>
            <dd>
              <Badge tone={member.status === 'active' ? 'ok' : 'neutral'}>
                {t(`status${member.status.charAt(0).toUpperCase()}${member.status.slice(1)}`)}
              </Badge>
            </dd>
          </dl>

          {!member.auth_user_id ? (
            <div className="mt-3">
              <Alert tone="warn">{t('noPasswordYet')}</Alert>
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('sensitive')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('sensitiveHidden')}</p>

          {canSeeSensitive || isSelf ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">{t('nationalId')}</dt>
              <dd>
                {sensitive?.national_id ? (
                  <Numeric>{sensitive.national_id}</Numeric>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">{tCommon('notPermitted')}</p>
          )}

          {canSeeSensitive ? (
            <div className="mt-4 border-t border-line pt-4">
              <ActionForm action={updateSensitiveAction} submitLabel={tCommon('save')}>
                <input type="hidden" name="id" value={member.id} />
                <input type="hidden" name="locale" value={locale} />
                <div>
                  <Label htmlFor="national_id">{t('nationalId')}</Label>
                  <Input
                    id="national_id"
                    name="national_id"
                    dir="ltr"
                    inputMode="numeric"
                    pattern="[12][0-9]{9}"
                    defaultValue={sensitive?.national_id ?? ''}
                    required
                  />
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Card>

        {canEdit ? (
          <Card>
            <h2 className="mb-3 font-semibold">{t('editProfile')}</h2>
            <ActionForm action={updateMemberAction} submitLabel={tCommon('save')}>
              <input type="hidden" name="id" value={member.id} />
              <input type="hidden" name="locale" value={locale} />

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="name_en">{t('name')} (EN)</Label>
                  <Input id="name_en" name="name_en" defaultValue={member.name_en} required />
                </div>
                <div>
                  <Label htmlFor="name_ar">{t('name')} (AR)</Label>
                  <Input id="name_ar" name="name_ar" defaultValue={member.name_ar} required />
                </div>
                <div>
                  <Label htmlFor="phone">{t('phone')}</Label>
                  <Input id="phone" name="phone" dir="ltr" defaultValue={member.phone ?? ''} />
                </div>
                <div>
                  <Label htmlFor="college">{t('college')}</Label>
                  <Input id="college" name="college" defaultValue={member.college ?? ''} />
                </div>
                <div>
                  <Label htmlFor="academic_level">{t('academicLevel')}</Label>
                  <Input
                    id="academic_level"
                    name="academic_level"
                    defaultValue={member.academic_level ?? ''}
                  />
                </div>
                <div>
                  <Label htmlFor="graduation_term">{t('graduationTerm')}</Label>
                  <Input
                    id="graduation_term"
                    name="graduation_term"
                    defaultValue={member.graduation_term ?? ''}
                  />
                </div>

                {/* Moving someone between teams is not a general Director
                    power — only HR Directors and leadership see these. */}
                {canManage ? (
                  <>
                    <div>
                      <Label htmlFor="team_id">{t('team')}</Label>
                      <Select id="team_id" name="team_id" defaultValue={member.team_id}>
                        {(teams ?? []).map((option) => (
                          <option key={option.id} value={option.id}>
                            {localized(option, 'name', locale)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="status">{t('status')}</Label>
                      <Select id="status" name="status" defaultValue={member.status}>
                        <option value="active">{t('statusActive')}</option>
                        <option value="inactive">{t('statusInactive')}</option>
                        <option value="alumni">{t('statusAlumni')}</option>
                      </Select>
                    </div>
                  </>
                ) : null}
              </div>
            </ActionForm>
          </Card>
        ) : null}

        {canManage ? (
          <Card>
            <h2 className="mb-3 font-semibold">{t('skills')}</h2>
            <ActionForm action={setSkillsAction} submitLabel={tCommon('save')}>
              <input type="hidden" name="id" value={member.id} />
              <input type="hidden" name="locale" value={locale} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(skills ?? []).map((skill) => (
                  <label key={skill.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="skill_id"
                      value={skill.id}
                      defaultChecked={selectedSkills.has(skill.id as string)}
                      className="size-4 accent-brand-600"
                    />
                    {localized(skill, 'name', locale)}
                  </label>
                ))}
              </div>
            </ActionForm>
          </Card>
        ) : null}

        {canConfigureRoles ? (
          <Card>
            <h2 className="mb-1 font-semibold">{t('changeRole')}</h2>
            <p className="mb-3 text-xs text-ink-muted">{t('roleChangeNote')}</p>
            <ActionForm action={changeRoleAction} submitLabel={tCommon('save')}>
              <input type="hidden" name="id" value={member.id} />
              <input type="hidden" name="locale" value={locale} />
              <Select name="role_id" defaultValue={member.role_id} aria-label={t('role')}>
                {(roles ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {localized(option, 'name', locale)}
                  </option>
                ))}
              </Select>
            </ActionForm>

            <div className="mt-5 border-t border-line pt-4">
              <h2 className="mb-1 font-semibold">{t('resetPassword')}</h2>
              <p className="mb-3 text-xs text-ink-muted">{t('resetPasswordHint')}</p>
              <ActionForm
                action={resetPasswordAction}
                submitLabel={t('resetPassword')}
                successText={t('passwordReset')}
                variant="secondary"
              >
                <input type="hidden" name="id" value={member.id} />
                <input type="hidden" name="locale" value={locale} />
                <div>
                  <Label htmlFor="password">{t('newPassword')}</Label>
                  <Input
                    id="password"
                    name="password"
                    type="text"
                    dir="ltr"
                    minLength={8}
                    required
                  />
                </div>
              </ActionForm>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
