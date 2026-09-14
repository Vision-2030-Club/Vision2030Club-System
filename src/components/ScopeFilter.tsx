'use client';

import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Select } from '@/components/ui';

type Named = { id: string; name_en: string; name_ar: string };

/**
 * One list — the teams under a heading, the projects under another — for
 * whoever sees the whole club's tasks or requests and wants one slice of
 * it. The same shape as the request form's "Send to" list, so it reads as
 * the same idea. The choice lives in the URL (`scope=team:…` /
 * `scope=project:…`), so it survives a refresh and the tab links keep it.
 */
export function ScopeFilter({
  teams,
  projects,
  value,
  labels,
}: {
  teams: Named[];
  projects: Named[];
  value: string;
  labels: { all: string; teams: string; projects: string };
}) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const name = (row: Named) => (locale === 'ar' ? row.name_ar : row.name_en);

  function choose(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next) query.set('scope', next);
    else query.delete('scope');
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname);
  }

  return (
    <Select
      aria-label={labels.all}
      value={value}
      onChange={(event) => choose(event.target.value)}
      className="w-auto max-w-64"
    >
      <option value="">{labels.all}</option>
      {teams.length ? (
        <optgroup label={labels.teams}>
          {teams.map((team) => (
            <option key={team.id} value={`team:${team.id}`}>
              {name(team)}
            </option>
          ))}
        </optgroup>
      ) : null}
      {projects.length ? (
        <optgroup label={labels.projects}>
          {projects.map((project) => (
            <option key={project.id} value={`project:${project.id}`}>
              {name(project)}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}
