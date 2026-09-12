import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getMyMember, hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { ActionsMenu, type MenuPanel } from '@/components/ActionsMenu';
import { Avatar } from '@/components/Avatar';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { PushSettings } from '@/components/PushSettings';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  Numeric,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import { toDateInput } from '@/lib/time';
import { signAvatar } from '@/lib/avatars';
import { PHONE_PATTERN, PHONE_PLACEHOLDER } from '@/lib/phone';
import { HEALTH_TONES, formatScore, healthKey, type MemberKpi } from '@/lib/kpi';
import {
  addExperienceAction,
  changeRoleAction,
  deleteExperienceAction,
  resetPasswordAction,
  updateMemberAction,
  updateSensitiveAction,
  uploadAvatarAction,
} from '../actions';

type Experience = {
  id: string;
  title: string;
  organization: string;
  description: string | null;
  started_on: string;
  ended_on: string | null;
};

export default async function MemberPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('members');
  const tCommon = await getTranslations('common');
  const tKpi = await getTranslations('kpi');
  const tPush = await getTranslations('push');
  const supabase = await createClient();
  const me = await getMyMember();

  /*
   * A profile shows someone's email, phone, student ID and college, so it is
   * the directory by another route — and it is reached by clicking a name on a
   * team page, a project, or the KPI table. It follows the same permission the
   * directory does (0048).
   *
   * Your own profile is always yours: this is where Edit Profile and Reset
   * Password live, and the header avatar links straight here. Checked before
   * any query runs, so a refusal costs nothing.
   */
  const isSelf = me?.id === id;
  if (!isSelf && !(await hasPermission('members.directory'))) {
    return (
      <>
        <PageHeader title={t('profile')} />
        <EmptyState>{t('restricted')}</EmptyState>
      </>
    );
  }

  const { data: member } = await supabase
    .from('members')
    .select(
      'id, name_en, name_ar, email, phone, student_id, status, college, academic_level, graduation_term, team_id, role_id, auth_user_id, avatar_path, teams(name_en, name_ar), roles(key, name_en, name_ar)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!member) notFound();

  // A separate table with its own policy: this simply returns nothing unless
  // the viewer is the member, an HR Director, or an admin (spec §5).
  /*
   * member_kpi already enforces §8: it has no row for the caller themselves,
   * whatever their role, and no row for anyone their kpi.view scope does not
   * reach. So "did we get a row back?" IS the permission answer — this page
   * needs no check of its own.
   */
  const [{ data: sensitive }, { data: experienceRows }, { data: kpiRow }, photoUrl] =
    await Promise.all([
      supabase.from('member_sensitive').select('national_id').eq('member_id', id).maybeSingle(),
      supabase
        .from('member_experience')
        .select('id, title, organization, description, started_on, ended_on')
        .eq('member_id', id)
        // Current roles first, then most recent — the order a CV is read in.
        .order('ended_on', { ascending: false, nullsFirst: true })
        .order('started_on', { ascending: false }),
      supabase.from('member_kpi').select('*').eq('member_id', id).maybeSingle(),
      signAvatar(supabase, member.avatar_path as string | null),
    ]);

  const kpi = kpiRow as MemberKpi | null;
  const experience = (experienceRows ?? []) as Experience[];
  const canSeeKpi = await hasPermission('kpi.view');

  const canManage = await hasPermission('members.manage');
  const canConfigureRoles = await hasPermission('roles.configure');
  const canSeeSensitive = await hasPermission('members.view_sensitive');
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
  const displayName = locale === 'ar' ? member.name_ar : member.name_en;

  /*
   * "Actions" rather than a page of forms parked open. Each panel is built
   * here, on the server, and only for someone allowed to use it — the menu is
   * empty (and so not rendered) for a member looking at a colleague.
   */
  const panels: MenuPanel[] = [];

  if (canEdit) {
    panels.push({
      key: 'edit',
      label: t('editProfile'),
      content: (
        <Card>
          <h2 className="mb-3 font-semibold">{t('photo')}</h2>
          <ActionForm action={uploadAvatarAction} submitLabel={t('uploadPhoto')}>
            <input type="hidden" name="id" value={member.id} />
            <input type="hidden" name="locale" value={locale} />
            <div className="flex flex-wrap items-center gap-4">
              <Avatar src={photoUrl} name={displayName} size={64} />
              <div className="min-w-0 flex-1">
                <Label htmlFor="photo">{t('photo')}</Label>
                <Input
                  id="photo"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                />
                <p className="mt-1 text-xs text-ink-muted">{t('photoHint')}</p>
              </div>
            </div>
          </ActionForm>

          <div className="mt-5 border-t border-line pt-4">
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
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    dir="ltr"
                    inputMode="tel"
                    pattern={PHONE_PATTERN}
                    placeholder={PHONE_PLACEHOLDER}
                    defaultValue={member.phone ?? ''}
                  />
                  <p className="mt-1 text-xs text-ink-muted">{t('phoneHint')}</p>
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
          </div>

          {canSeeSensitive ? (
            <div className="mt-5 border-t border-line pt-4">
              <h2 className="mb-1 font-semibold">{t('nationalId')}</h2>
              <p className="mb-3 text-xs text-ink-muted">{t('sensitiveHidden')}</p>
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

          {canConfigureRoles ? (
            <div className="mt-5 border-t border-line pt-4">
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
            </div>
          ) : null}
        </Card>
      ),
    });
  }

  if (canConfigureRoles) {
    panels.push({
      key: 'password',
      label: t('resetPassword'),
      content: (
        <Card>
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
              <Input id="password" name="password" type="text" dir="ltr" minLength={8} required />
            </div>
          </ActionForm>
        </Card>
      ),
    });
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar src={photoUrl} name={displayName} size={72} />
        <PageHeader
          title={displayName}
          description={
            role?.key === 'team_director'
              ? `${localized(role, 'name', locale)} — ${localized(team, 'name', locale)}`
              : `${localized(role, 'name', locale)} · ${localized(team, 'name', locale)}`
          }
        />
      </div>

      {panels.length ? <ActionsMenu label={tCommon('actions')} panels={panels} /> : null}

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

        {/* Push is per DEVICE, so it lives on the profile of the person
            holding the phone and nowhere else. */}
        {isSelf ? (
          <Card>
            <h2 className="mb-3 font-semibold">{tPush('title')}</h2>
            <PushSettings />
          </Card>
        ) : null}

        {/* §9: a member's profile shows their Team-internal and Project-wide
            KPI to anyone holding View KPI who is looking at SOMEONE ELSE. */}
        <Card>
          <h2 className="mb-3 font-semibold">{t('kpi')}</h2>

          {isSelf ? (
            <p className="text-sm text-ink-muted">{t('kpiOwnHidden')}</p>
          ) : !canSeeKpi || !kpi ? (
            <p className="text-sm text-ink-muted">
              {canSeeKpi ? t('kpiNoTasks') : t('kpiNoAccess')}
            </p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-baseline gap-4">
                <div>
                  <div className="text-3xl font-semibold tabular-nums text-ink">
                    {formatScore(kpi.performance)}
                  </div>
                  <div className="text-xs text-ink-muted">{tKpi('performance')}</div>
                </div>
                <Badge tone={HEALTH_TONES[kpi.health]}>{tKpi(healthKey(kpi.health))}</Badge>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-muted">{t('kpiTeamInternal')}</dt>
                <dd className="tabular-nums">{formatScore(kpi.team_performance)}</dd>
                <dt className="text-ink-muted">{t('kpiProjectWide')}</dt>
                <dd className="tabular-nums">{formatScore(kpi.project_performance)}</dd>
                <dt className="text-ink-muted">{tKpi('scored')}</dt>
                <dd className="tabular-nums">{kpi.scored_tasks}</dd>
                <dt className="text-ink-muted">{tKpi('completed')}</dt>
                <dd className="tabular-nums">{kpi.completed_tasks}</dd>
                <dt className="text-ink-muted">{tKpi('notDone')}</dt>
                <dd className="tabular-nums">{kpi.not_done_tasks}</dd>
                <dt className="text-ink-muted">{tKpi('delayed')}</dt>
                <dd className="tabular-nums">{kpi.delayed_tasks}</dd>
                <dt className="text-ink-muted">{tKpi('overdue')}</dt>
                <dd className="tabular-nums">{kpi.overdue_tasks}</dd>
              </dl>
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('sensitive')}</h2>
          <p className="mb-3 text-xs text-ink-muted">{t('sensitiveHidden')}</p>

          {canSeeSensitive || isSelf ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">{t('nationalId')}</dt>
              <dd>
                {sensitive?.national_id ? <Numeric>{sensitive.national_id}</Numeric> : '—'}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">{tCommon('notPermitted')}</p>
          )}
        </Card>

        {/*
          Experience history. Ordering puts anything still current at the top,
          which is why an empty `ended_on` reads as "Present" rather than as a
          missing value.
        */}
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">{t('experience')}</h2>

          {canEdit ? (
            <div className="mb-4">
              <Disclosure label={t('addExperience')}>
                <ActionForm action={addExperienceAction} submitLabel={tCommon('save')}>
                  <input type="hidden" name="id" value={member.id} />
                  <input type="hidden" name="locale" value={locale} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="exp_title">{t('experienceTitle')}</Label>
                      <Input id="exp_title" name="title" required />
                    </div>
                    <div>
                      <Label htmlFor="exp_org">{t('organization')}</Label>
                      <Input id="exp_org" name="organization" required />
                    </div>
                    <div>
                      <Label htmlFor="exp_start">{t('startedOn')}</Label>
                      <Input
                        id="exp_start"
                        name="started_on"
                        type="date"
                        max={toDateInput(new Date())}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="exp_end">{t('endedOn')}</Label>
                      <Input id="exp_end" name="ended_on" type="date" max={toDateInput(new Date())} />
                      <p className="mt-1 text-xs text-ink-muted">{t('endedOnHint')}</p>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="exp_description">{t('experienceDescription')}</Label>
                    <Textarea id="exp_description" name="description" rows={3} />
                  </div>
                </ActionForm>
              </Disclosure>
            </div>
          ) : null}

          {experience.length ? (
            <ul className="divide-y divide-line">
              {experience.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">{entry.title}</div>
                    <div className="text-sm text-ink-muted">{entry.organization}</div>
                    <div className="text-xs text-ink-muted">
                      {formatDate(entry.started_on, locale)} —{' '}
                      {entry.ended_on ? formatDate(entry.ended_on, locale) : t('present')}
                    </div>
                    {entry.description ? (
                      <p className="mt-1.5 text-sm whitespace-pre-line text-ink">
                        {entry.description}
                      </p>
                    ) : null}
                  </div>

                  {canEdit ? (
                    <ConfirmForm
                      action={deleteExperienceAction}
                      trigger={tCommon('delete')}
                      title={t('deleteExperienceTitle')}
                      body={t('deleteExperienceBody')}
                      confirmLabel={tCommon('delete')}
                    >
                      <input type="hidden" name="id" value={member.id} />
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="entry_id" value={entry.id} />
                    </ConfirmForm>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t('noExperience')}</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
