import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Card, EmptyState, Label, PageHeader, Select } from '@/components/ui';
import { localized } from '@/lib/format';
import { addTeamOverrideAction, removeTeamOverrideAction } from '../actions';
import { PermissionMatrix, type PermissionRow, type RoleColumn } from './PermissionMatrix';

const SCOPES = ['all', 'own_team', 'own_projects', 'assigned', 'own', 'none'] as const;

export default async function AdminPermissionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');
  const tMembers = await getTranslations('members');
  const supabase = await createClient();

  const [
    { data: roles },
    { data: permissions },
    { data: rolePermissions },
    { data: overrides },
    { data: teams },
  ] = await Promise.all([
    supabase.from('roles').select('id, key, name_en, name_ar').order('sort_order'),
    supabase.from('permissions').select('key, description_en, description_ar').order('key'),
    supabase.from('role_permissions').select('role_id, permission_key, scope'),
    supabase
      .from('role_permission_team_overrides')
      .select('role_id, permission_key, team_id, scope'),
    supabase.from('teams').select('id, key, name_en, name_ar').order('name_en'),
  ]);

  const roleColumns: RoleColumn[] = (roles ?? []).map((role) => ({
    id: role.id,
    label: localized(role, 'name', locale),
  }));

  const permissionRows: PermissionRow[] = (permissions ?? []).map((permission) => ({
    key: permission.key,
    description: localized(permission, 'description', locale),
  }));

  const initial: Record<string, string> = {};
  for (const row of rolePermissions ?? []) {
    initial[`${row.role_id}:${row.permission_key}`] = row.scope;
  }

  const roleName = (id: string) =>
    roleColumns.find((role) => role.id === id)?.label ?? id;
  const teamName = (id: string) =>
    localized(
      (teams ?? []).find((team) => team.id === id) as Record<string, string> | undefined,
      'name',
      locale,
    ) || id;

  const scopeLabel = (scope: string) =>
    t(`scope${scope.charAt(0).toUpperCase()}${scope.slice(1)}` as 'scopeAll');

  return (
    <>
      <PageHeader title={t('permissions')} description={t('permissionsHint')} />

      <PermissionMatrix
        locale={locale}
        roles={roleColumns}
        permissions={permissionRows}
        initial={initial}
      />

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">{t('overrides')}</h2>
        <p className="mt-1 mb-4 text-sm text-ink-muted">{t('overridesHint')}</p>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-2">
            {overrides?.length ? (
              overrides.map((override) => (
                <Card
                  key={`${override.role_id}:${override.permission_key}:${override.team_id}`}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <span className="font-medium text-ink">{roleName(override.role_id)}</span>
                  <Badge tone="brand">{override.permission_key}</Badge>
                  <span className="text-sm text-ink-muted">{teamName(override.team_id)}</span>
                  <Badge tone={override.scope === 'none' ? 'neutral' : 'ok'}>
                    {scopeLabel(override.scope)}
                  </Badge>

                  <div className="ms-auto">
                    <ActionForm
                      action={removeTeamOverrideAction}
                      submitLabel={tCommon('delete')}
                      variant="secondary"
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="role_id" value={override.role_id} />
                      <input
                        type="hidden"
                        name="permission_key"
                        value={override.permission_key}
                      />
                      <input type="hidden" name="team_id" value={override.team_id} />
                    </ActionForm>
                  </div>
                </Card>
              ))
            ) : (
              <EmptyState>{tCommon('nothingHere')}</EmptyState>
            )}
          </div>

          <Card>
            <h3 className="mb-3 font-semibold">{t('addOverride')}</h3>
            <ActionForm action={addTeamOverrideAction} submitLabel={tCommon('create')}>
              <input type="hidden" name="locale" value={locale} />
              <div>
                <Label htmlFor="role_id">{tMembers('role')}</Label>
                <Select id="role_id" name="role_id" required>
                  {roleColumns.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="permission_key">{t('permission')}</Label>
                <Select id="permission_key" name="permission_key" required>
                  {permissionRows.map((permission) => (
                    <option key={permission.key} value={permission.key}>
                      {permission.key}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="team_id">{tMembers('team')}</Label>
                <Select id="team_id" name="team_id" required>
                  {(teams ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {localized(team, 'name', locale)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="scope">{t('scope')}</Label>
                <Select id="scope" name="scope" defaultValue="all" required>
                  {SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {scopeLabel(scope)}
                    </option>
                  ))}
                </Select>
              </div>
            </ActionForm>
          </Card>
        </div>
      </section>
    </>
  );
}
