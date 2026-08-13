import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import {
  Badge,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui';
import { formatDate, localized } from '@/lib/format';
import { createProjectAction } from './actions';

const STATUS_TONES = {
  planned: 'neutral',
  active: 'ok',
  completed: 'brand',
  cancelled: 'danger',
} as const;

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('projects');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();

  const [{ data: projects }, { data: teams }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name_en, name_ar, status, starts_on, ends_on, teams(name_en, name_ar)')
      .order('created_at', { ascending: false }),
    supabase.from('teams').select('id, name_en, name_ar').order('name_en'),
  ]);

  const canCreate = await hasPermission('projects.manage');

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {projects?.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {projects.map((project) => (
                <Card key={project.id}>
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {localized(project, 'name', locale)}
                    </Link>
                    <Badge
                      tone={
                        STATUS_TONES[project.status as keyof typeof STATUS_TONES] ?? 'neutral'
                      }
                    >
                      {t(
                        `status${String(project.status).charAt(0).toUpperCase()}${String(
                          project.status,
                        ).slice(1)}`,
                      )}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {localized(
                      project.teams as unknown as Record<string, string>,
                      'name',
                      locale,
                    )}
                  </p>
                  <p className="mt-2 text-xs text-ink-muted">
                    {formatDate(project.starts_on, locale)} –{' '}
                    {formatDate(project.ends_on, locale)}
                  </p>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState>{t('empty')}</EmptyState>
          )}
        </div>

        {canCreate ? (
          <Card>
            <h2 className="mb-3 font-semibold">{t('newProject')}</h2>
            <ActionForm action={createProjectAction} submitLabel={tCommon('create')}>
              <input type="hidden" name="locale" value={locale} />
              <div>
                <Label htmlFor="name_en">{t('nameEn')}</Label>
                <Input id="name_en" name="name_en" required />
              </div>
              <div>
                <Label htmlFor="name_ar">{t('nameAr')}</Label>
                <Input id="name_ar" name="name_ar" required />
              </div>
              <div>
                <Label htmlFor="owning_team_id">{t('owningTeam')}</Label>
                <Select id="owning_team_id" name="owning_team_id" required>
                  {(teams ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {localized(team, 'name', locale)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="description">{t('description')}</Label>
                <Textarea id="description" name="description" rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="starts_on">{t('startsOn')}</Label>
                  <Input id="starts_on" name="starts_on" type="date" />
                </div>
                <div>
                  <Label htmlFor="ends_on">{t('endsOn')}</Label>
                  <Input id="ends_on" name="ends_on" type="date" />
                </div>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
