import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MemberLink } from '@/components/MemberLink';
import { getMyMember, hasPermission } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { scopeFor } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Card, EmptyState, Input, Label, PageHeader, Textarea } from '@/components/ui';
import { formatDateTime, localized } from '@/lib/format';
import { createTeamPostAction } from '../actions';

export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('teams');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();
  const me = await getMyMember();
  // Whose name is a link and whose is plain text. The profile page enforces
  // this itself; this only avoids offering a link that leads to a refusal.
  const canOpenProfiles = await hasPermission('members.directory');

  const { data: team } = await supabase
    .from('teams')
    .select('id, key, name_en, name_ar')
    .eq('id', id)
    .maybeSingle();

  if (!team) notFound();

  const [{ data: members }, { data: posts }] = await Promise.all([
    supabase
      .from('members')
      .select('id, name_en, name_ar, roles(key, name_en, name_ar)')
      .eq('team_id', id)
      .order('name_en'),
    // Returns nothing unless the viewer's team_posts.view scope covers this
    // team — a member of another team simply sees an empty list.
    supabase
      .from('team_posts')
      .select('id, title, body, created_at, members(name_en, name_ar)')
      .eq('team_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const postScope = await scopeFor('team_posts.manage');
  const canPost = postScope === 'all' || postScope === 'own_team';

  return (
    <>
      <PageHeader title={localized(team, 'name', locale)} description={t('subtitle')} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">{t('members')}</h2>
          {members?.length ? (
            <ul className="divide-y divide-line text-sm">
              {members.map((member) => (
                <li key={member.id} className="flex items-center justify-between py-2">
                  <MemberLink
                    id={member.id as string}
                    viewerId={me?.id}
                    canOpenAny={canOpenProfiles}
                    className="font-medium"
                  >
                    {locale === 'ar' ? member.name_ar : member.name_en}
                  </MemberLink>
                  <span className="text-xs text-ink-muted">
                    {localized(
                      member.roles as unknown as Record<string, string>,
                      'name',
                      locale,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{tCommon('nothingHere')}</EmptyState>
          )}
        </Card>

        <div className="space-y-4">
          {canPost ? (
            <Card>
              <h2 className="mb-3 font-semibold">{t('newPost')}</h2>
              <ActionForm action={createTeamPostAction} submitLabel={tCommon('create')}>
                <input type="hidden" name="team_id" value={team.id} />
                <input type="hidden" name="locale" value={locale} />
                <div>
                  <Label htmlFor="title">{t('postTitle')}</Label>
                  <Input id="title" name="title" required />
                </div>
                <div>
                  <Label htmlFor="body">{t('postBody')}</Label>
                  <Textarea id="body" name="body" required />
                </div>
              </ActionForm>
            </Card>
          ) : null}

          <Card>
            <h2 className="mb-3 font-semibold">{t('posts')}</h2>
            {posts?.length ? (
              <ul className="divide-y divide-line">
                {posts.map((post) => {
                  const author = post.members as unknown as Record<string, string>;
                  return (
                    <li key={post.id} className="py-3">
                      <div className="font-medium">{post.title}</div>
                      <p className="mt-1 whitespace-pre-line text-sm text-ink">{post.body}</p>
                      <div className="mt-1 text-xs text-ink-muted">
                        {formatDateTime(post.created_at, locale)}
                        {author
                          ? ` · ${t('postedBy', { name: localized(author, 'name', locale) })}`
                          : ''}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState>{t('noPosts')}</EmptyState>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
