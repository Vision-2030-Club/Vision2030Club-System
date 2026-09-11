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

/**
 * One "Send to" list instead of a kind picker plus a list per kind: the teams
 * under a Teams heading, the projects under Projects, then the Presidency and
 * "a specific person". Only that last choice opens a second field. The value
 * encodes kind and id together; hidden inputs hand the action the columns it
 * already reads, so the routing rules did not move.
 */
type Target =
  | { kind: 'team'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'presidency' }
  | { kind: 'individual' };

function encode(target: Target): string {
  return 'id' in target ? `${target.kind}:${target.id}` : target.kind;
}

function decode(value: string): Target {
  const [kind, id] = value.split(':');
  if ((kind === 'team' || kind === 'project') && id) return { kind, id };
  if (kind === 'individual') return { kind };
  return { kind: 'presidency' };
}

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
  const [target, setTarget] = useState<Target>(
    teams[0] ? { kind: 'team', id: teams[0].id } : { kind: 'presidency' },
  );
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
            <input type="hidden" name="target_kind" value={target.kind} />
            {target.kind === 'team' ? (
              <input type="hidden" name="target_team_id" value={target.id} />
            ) : null}
            {target.kind === 'project' ? (
              <input type="hidden" name="target_project_id" value={target.id} />
            ) : null}

            <div>
              <Label htmlFor="target">{t('target')}</Label>
              <Select
                id="target"
                value={encode(target)}
                onChange={(event) => setTarget(decode(event.target.value))}
              >
                <optgroup label={t('targetTeams')}>
                  {teams.map((team) => (
                    <option key={team.id} value={`team:${team.id}`}>
                      {name(team)}
                    </option>
                  ))}
                </optgroup>
                {projects.length ? (
                  <optgroup label={t('targetProjects')}>
                    {projects.map((project) => (
                      <option key={project.id} value={`project:${project.id}`}>
                        {name(project)}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <option value="presidency">{t('targetPresidency')}</option>
                <option value="individual">{t('targetIndividual')}</option>
              </Select>
            </div>

            {/* §2: a meeting's target can be one specific person — the one
                choice that needs a second question. */}
            {target.kind === 'individual' ? (
              <div>
                <Label htmlFor="target_member_id">{t('targetIndividual')}</Label>
                <Select id="target_member_id" name="target_member_id" required>
                  <option value="">—</option>
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

        {/* Keyed by type so answers (and what they reveal) reset with it. */}
        {type ? (
          <RequestFields key={type.id} fields={type.field_schema ?? []} options={fieldOptions} />
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
