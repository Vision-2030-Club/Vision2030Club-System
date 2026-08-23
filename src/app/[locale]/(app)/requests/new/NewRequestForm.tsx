'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Card, Label, Select } from '@/components/ui';
import { RequestFields } from '@/components/RequestFields';
import type { ActionResult } from '@/lib/actions';
import type { FieldOptions, RequestField } from '@/lib/requests';
import { createRequestAction } from '../actions';

export type RequestTypeOption = {
  id: string;
  key: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  owning_team_id: string | null;
  field_schema: RequestField[];
};

type Named = { id: string; name_en: string; name_ar: string };

export function NewRequestForm({
  types,
  teams,
  projects,
  members,
  fieldOptions,
}: {
  types: RequestTypeOption[];
  teams: Named[];
  projects: Named[];
  members: Named[];
  /** Options for selects whose choices come from a table, not the schema. */
  fieldOptions: FieldOptions;
}) {
  const locale = useLocale();
  const t = useTranslations('requests');
  const tCommon = useTranslations('common');
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [targetKind, setTargetKind] =
    useState<'team' | 'project' | 'presidency' | 'individual'>('team');
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    createRequestAction,
    { ok: false },
  );

  const name = (row: { name_en: string; name_ar: string }) =>
    locale === 'ar' ? row.name_ar : row.name_en;

  const type = types.find((option) => option.id === typeId);
  const owningTeam = teams.find((team) => team.id === type?.owning_team_id);

  return (
    <Card className="max-w-2xl">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />

        <div>
          <Label htmlFor="request_type_id">{t('type')}</Label>
          <Select
            id="request_type_id"
            name="request_type_id"
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
            required
          >
            {types.map((option) => (
              <option key={option.id} value={option.id}>
                {name(option)}
              </option>
            ))}
          </Select>
          {type ? (
            <p className="mt-1 text-xs text-ink-muted">
              {locale === 'ar' ? type.description_ar : type.description_en}
            </p>
          ) : null}
        </div>

        {/* A type owned by a team always routes there. Only types without an
            owning team — meeting requests — let the requester choose. */}
        {owningTeam ? (
          <div>
            <Label>{t('target')}</Label>
            <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
              {name(owningTeam)}
            </div>
          </div>
        ) : (
          <>
            <div>
              <Label htmlFor="target_kind">{t('target')}</Label>
              <Select
                id="target_kind"
                name="target_kind"
                value={targetKind}
                onChange={(event) =>
                  setTargetKind(event.target.value as typeof targetKind)
                }
              >
                <option value="team">{t('targetTeam')}</option>
                <option value="project">{t('targetProject')}</option>
                <option value="presidency">{t('targetPresidency')}</option>
                <option value="individual">{t('targetIndividual')}</option>
              </Select>
            </div>

            {targetKind === 'team' ? (
              <div>
                <Label htmlFor="target_team_id">{t('targetTeam')}</Label>
                <Select id="target_team_id" name="target_team_id" required>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {name(team)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            {targetKind === 'project' ? (
              <div>
                <Label htmlFor="target_project_id">{t('targetProject')}</Label>
                <Select id="target_project_id" name="target_project_id" required>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {name(project)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            {/* §2: a meeting's target can be one specific person. */}
            {targetKind === 'individual' ? (
              <div>
                <Label htmlFor="target_member_id">{t('targetIndividual')}</Label>
                <Select id="target_member_id" name="target_member_id" required>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {name(member)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </>
        )}

        {type ? (
          <RequestFields fields={type.field_schema ?? []} options={fieldOptions} />
        ) : null}

        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.ok ? <Alert tone="ok">{t('created')}</Alert> : null}

        <Button type="submit" disabled={pending}>
          {tCommon('submit')}
        </Button>
      </form>
    </Card>
  );
}
