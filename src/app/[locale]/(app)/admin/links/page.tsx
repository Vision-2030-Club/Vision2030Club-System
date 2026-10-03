import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Disclosure } from '@/components/Disclosure';
import { Card, EmptyState, Input, Label, PageHeader } from '@/components/ui';
import { qrDataUrls, shortLinkUrl, type ShortLink } from '@/lib/links';
import { createShortLinkAction, deleteShortLinkAction, updateShortLinkAction } from './actions';

export default async function AdminLinksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  /*
   * Every policy on `short_links` asks `app.can('links.manage')`, so this
   * check adds no security — it gives a readable page instead of a list of
   * forms that all fail on save.
   */
  if (!(await hasPermission('links.manage'))) {
    return (
      <>
        <PageHeader title={t('links')} description={t('linksHint')} />
        <EmptyState>{tCommon('notPermitted')}</EmptyState>
      </>
    );
  }

  const supabase = await createClient();
  // Absent until migration 0068 is applied; the page then shows no links and
  // the first save reports what the database said.
  const { data } = await supabase
    .from('short_links')
    .select('slug, label, target_url, visits, updated_at')
    .order('created_at');

  const links = await Promise.all(
    ((data ?? []) as ShortLink[]).map(async (link) => {
      const url = shortLinkUrl(link.slug);
      return { ...link, url, qr: await qrDataUrls(url) };
    }),
  );

  return (
    <>
      <PageHeader title={t('links')} description={t('linksHint')} />

      <Card className="mb-4 max-w-2xl">
        <Disclosure label={t('newLink')}>
          <ActionForm action={createShortLinkAction} submitLabel={tCommon('create')}>
            <input type="hidden" name="locale" value={locale} />
            <div className="grid gap-3">
              <div>
                <Label htmlFor="label">{t('linkLabel')}</Label>
                <Input id="label" name="label" maxLength={120} required />
              </div>
              <div>
                <Label htmlFor="slug">{t('linkSlug')}</Label>
                <Input
                  id="slug"
                  name="slug"
                  dir="ltr"
                  pattern="[a-z0-9][a-z0-9-]{0,39}"
                  placeholder="apply"
                  required
                />
                <p className="mt-1 text-xs text-ink-muted">{t('linkSlugHint')}</p>
              </div>
              <div>
                <Label htmlFor="target_url">{t('linkTarget')}</Label>
                <Input
                  id="target_url"
                  name="target_url"
                  type="url"
                  dir="ltr"
                  placeholder="https://"
                  required
                />
                <p className="mt-1 text-xs text-ink-muted">{t('linkTargetHint')}</p>
              </div>
            </div>
          </ActionForm>
        </Disclosure>
      </Card>

      {links.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {links.map((link) => (
            <Card key={link.slug}>
              <div className="flex flex-wrap gap-4">
                {/*
                  A plain <img> on purpose: the QR is a data URL made on the
                  server, so there is nothing for next/image to optimise.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={link.qr.svg}
                  alt={t('qrAlt', { label: link.label })}
                  width={160}
                  height={160}
                  className="size-40 shrink-0 rounded-lg border border-line bg-white"
                />

                <div className="min-w-0 flex-1 space-y-2">
                  <h2 className="font-semibold text-ink">{link.label}</h2>

                  <div>
                    <p className="text-xs text-ink-muted">{t('linkAddress')}</p>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                      className="block break-all font-mono text-sm text-brand-700 underline"
                    >
                      {link.url}
                    </a>
                  </div>

                  <div>
                    <p className="text-xs text-ink-muted">{t('linkTarget')}</p>
                    <p dir="ltr" className="break-all text-sm text-ink">
                      {link.target_url}
                    </p>
                  </div>

                  <p className="text-xs text-ink-muted">{t('linkVisits', { count: link.visits })}</p>

                  <div className="flex flex-wrap gap-2 text-sm">
                    <a
                      href={link.qr.png}
                      download={`${link.slug}-qr.png`}
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-ink hover:bg-surface-muted"
                    >
                      {t('downloadPng')}
                    </a>
                    <a
                      href={link.qr.svg}
                      download={`${link.slug}-qr.svg`}
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-ink hover:bg-surface-muted"
                    >
                      {t('downloadSvg')}
                    </a>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Disclosure label={tCommon('edit')} title={link.label}>
                    <ActionForm action={updateShortLinkAction} submitLabel={tCommon('save')}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="slug" value={link.slug} />
                      <div className="grid gap-3">
                        <div>
                          <Label htmlFor={`label-${link.slug}`}>{t('linkLabel')}</Label>
                          <Input
                            id={`label-${link.slug}`}
                            name="label"
                            defaultValue={link.label}
                            maxLength={120}
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor={`target-${link.slug}`}>{t('linkTarget')}</Label>
                          <Input
                            id={`target-${link.slug}`}
                            name="target_url"
                            type="url"
                            dir="ltr"
                            defaultValue={link.target_url}
                            required
                          />
                          <p className="mt-1 text-xs text-ink-muted">{t('linkTargetHint')}</p>
                        </div>
                      </div>
                    </ActionForm>
                  </Disclosure>
                </div>

                <ConfirmForm
                  action={deleteShortLinkAction}
                  trigger={tCommon('delete')}
                  title={t('deleteLinkTitle')}
                  body={t('deleteLinkBody')}
                  confirmLabel={tCommon('delete')}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="slug" value={link.slug} />
                </ConfirmForm>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState>{t('noLinks')}</EmptyState>
      )}
    </>
  );
}
