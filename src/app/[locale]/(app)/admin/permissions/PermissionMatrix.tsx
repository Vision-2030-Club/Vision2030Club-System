'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Select } from '@/components/ui';
import { setRolePermissionScopeAction } from '../actions';

export type RoleColumn = { id: string; label: string };
export type PermissionRow = { key: string; description: string };

const SCOPES = ['all', 'own_team', 'own_projects', 'assigned', 'own', 'none'] as const;

/**
 * The permission matrix — roles across, permissions down, a scope in each cell.
 *
 * This screen is what makes "configuration over code" real for the club: every
 * policy in the database reads these rows through app.can, so changing a cell
 * changes what a role can do on the next request. No deploy, no code change.
 *
 * Cells save on change rather than behind a Save button, because a half-saved
 * matrix is a confusing thing to leave behind.
 */
export function PermissionMatrix({
  locale,
  roles,
  permissions,
  initial,
}: {
  locale: string;
  roles: RoleColumn[];
  permissions: PermissionRow[];
  /** `${roleId}:${permissionKey}` -> scope */
  initial: Record<string, string>;
}) {
  const t = useTranslations('admin');
  const [scopes, setScopes] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const scopeLabel = (scope: string) =>
    t(`scope${scope.charAt(0).toUpperCase()}${scope.slice(1)}` as 'scopeAll');

  const change = (roleId: string, permissionKey: string, scope: string) => {
    const cell = `${roleId}:${permissionKey}`;
    const previous = scopes[cell];

    setScopes((current) => ({ ...current, [cell]: scope }));
    setError(null);

    startSaving(async () => {
      const result = await setRolePermissionScopeAction(
        locale,
        roleId,
        permissionKey,
        scope,
      );

      // Put the cell back if the database refused — the screen must never show
      // a permission that is not actually in effect.
      if (!result.ok) {
        setScopes((current) => ({ ...current, [cell]: previous }));
        setError(result.error ?? null);
      }
    });
  };

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-muted">
              <th className="sticky start-0 z-10 bg-surface-muted px-4 py-2 text-start text-xs font-medium text-ink-muted">
                {t('permission')}
              </th>
              {roles.map((role) => (
                <th
                  key={role.id}
                  className="px-3 py-2 text-start text-xs font-medium text-ink-muted"
                >
                  {role.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={saving ? 'opacity-70' : undefined}>
            {permissions.map((permission) => (
              <tr key={permission.key} className="border-b border-line last:border-b-0">
                <th className="sticky start-0 z-10 bg-surface px-4 py-2 text-start font-normal">
                  <span className="block font-medium text-ink">{permission.key}</span>
                  <span className="block text-xs text-ink-muted">
                    {permission.description}
                  </span>
                </th>

                {roles.map((role) => {
                  const cell = `${role.id}:${permission.key}`;
                  const value = scopes[cell] ?? 'none';

                  return (
                    <td key={role.id} className="px-2 py-1.5">
                      <Select
                        aria-label={`${permission.key} — ${role.label}`}
                        value={value}
                        onChange={(event) =>
                          change(role.id, permission.key, event.target.value)
                        }
                        className={value === 'none' ? 'text-ink-muted' : undefined}
                      >
                        {SCOPES.map((scope) => (
                          <option key={scope} value={scope}>
                            {scopeLabel(scope)}
                          </option>
                        ))}
                      </Select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
