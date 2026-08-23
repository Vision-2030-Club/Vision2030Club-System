import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Disclosure } from '@/components/Disclosure';
import {
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
import { checkInAssetAction, checkOutAssetAction, createAssetAction } from './actions';

const STATUS_TONES = {
  available: 'ok',
  checked_out: 'warn',
  maintenance: 'neutral',
  retired: 'danger',
} as const;

type ActiveCheckout = {
  id: string;
  asset_id: string;
  due_back_on: string | null;
  members: { name_en: string; name_ar: string } | null;
};

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('assets');
  const tCommon = await getTranslations('common');
  const supabase = await createClient();

  /*
   * 0023 moved custody of the register to Finance and the Presidency. RLS
   * would already return nothing to anyone else, but "no assets" and "not
   * yours to see" are different answers and the page should not blur them —
   * everybody else gets an asset by filing an Asset Request instead.
   */
  const canView = await hasPermission('assets.view');
  if (!canView) {
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState>{t('restricted')}</EmptyState>
      </>
    );
  }

  const [{ data: assets }, { data: checkouts }, { data: members }] = await Promise.all([
    supabase
      .from('assets')
      .select('id, tag, name_en, name_ar, description, status')
      .order('name_en'),
    supabase
      .from('asset_checkouts')
      .select('id, asset_id, due_back_on, members(name_en, name_ar)')
      .is('returned_at', null),
    supabase.from('members').select('id, name_en, name_ar').order('name_en'),
  ]);

  const canManage = await hasPermission('assets.manage');
  const canCheckout = await hasPermission('assets.checkout');

  const activeByAsset = new Map<string, ActiveCheckout>();
  for (const row of (checkouts ?? []) as unknown as ActiveCheckout[]) {
    activeByAsset.set(row.asset_id, row);
  }

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />

      {canManage ? (
        <div className="mb-4">
          <Disclosure label={t('newAsset')}>
            <ActionForm action={createAssetAction} submitLabel={tCommon('create')}>
              <input type="hidden" name="locale" value={locale} />
              <div>
                <Label htmlFor="tag">{t('tag')}</Label>
                <Input id="tag" name="tag" />
              </div>
              <div>
                <Label htmlFor="name_en">{t('nameEn')}</Label>
                <Input id="name_en" name="name_en" required />
              </div>
              <div>
                <Label htmlFor="name_ar">{t('nameAr')}</Label>
                <Input id="name_ar" name="name_ar" required />
              </div>
              <div>
                <Label htmlFor="description">{t('description')}</Label>
                <Textarea id="description" name="description" rows={2} />
              </div>
              <div>
                <Label htmlFor="status">{t('status')}</Label>
                <Select id="status" name="status" defaultValue="available">
                  <option value="available">{t('statusAvailable')}</option>
                  <option value="maintenance">{t('statusMaintenance')}</option>
                  <option value="retired">{t('statusRetired')}</option>
                </Select>
              </div>
            </ActionForm>
          </Disclosure>
        </div>
      ) : null}

      <div className="space-y-3">
          {assets?.length ? (
            assets.map((asset) => {
              const active = activeByAsset.get(asset.id);

              return (
                <Card key={asset.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">
                          {localized(asset, 'name', locale)}
                        </span>
                        {asset.tag ? (
                          <Badge>
                            <Numeric>{asset.tag}</Numeric>
                          </Badge>
                        ) : null}
                      </div>
                      {asset.description ? (
                        <p className="mt-1 text-sm text-ink-muted">{asset.description}</p>
                      ) : null}
                    </div>

                    <Badge
                      tone={STATUS_TONES[asset.status as keyof typeof STATUS_TONES] ?? 'neutral'}
                    >
                      {t(
                        `status${String(asset.status).charAt(0).toUpperCase()}${String(
                          asset.status,
                        ).slice(1)}`,
                      )}
                    </Badge>
                  </div>

                  {active ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                      <span className="text-sm text-ink-muted">
                        {t('heldBy')}:{' '}
                        <span className="font-medium text-ink">
                          {localized(
                            active.members as unknown as Record<string, string>,
                            'name',
                            locale,
                          )}
                        </span>
                      </span>
                      {active.due_back_on ? (
                        <span className="text-sm text-ink-muted">
                          {t('dueBack')}: {formatDate(active.due_back_on, locale)}
                        </span>
                      ) : null}

                      <div className="ms-auto">
                        <ActionForm
                          action={checkInAssetAction}
                          submitLabel={t('checkIn')}
                          variant="secondary"
                        >
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="checkout_id" value={active.id} />
                        </ActionForm>
                      </div>
                    </div>
                  ) : canManage || canCheckout ? (
                    <div className="mt-3 border-t border-line pt-3">
                      <ActionForm action={checkOutAssetAction} submitLabel={t('checkOut')}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="asset_id" value={asset.id} />

                        <div className="grid gap-3 sm:grid-cols-2">
                          {canManage ? (
                            <div>
                              <Label htmlFor={`member-${asset.id}`}>{t('heldBy')}</Label>
                              <Select id={`member-${asset.id}`} name="member_id">
                                {(members ?? []).map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {localized(member, 'name', locale)}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          ) : null}
                          <div>
                            <Label htmlFor={`due-${asset.id}`}>{t('dueBack')}</Label>
                            <Input id={`due-${asset.id}`} name="due_back_on" type="date" />
                          </div>
                        </div>
                      </ActionForm>
                    </div>
                  ) : null}
                </Card>
              );
            })
          ) : (
            <EmptyState>{t('empty')}</EmptyState>
          )}
      </div>
    </>
  );
}
