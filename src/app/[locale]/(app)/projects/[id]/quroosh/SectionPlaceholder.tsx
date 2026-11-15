import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Badge, Card, PageHeader } from '@/components/ui';
import { localized } from '@/lib/format';
import { can, getQurooshAccess } from '@/lib/quroosh/access';
import type { QurooshSectionKey } from '@/lib/quroosh/sections';

/**
 * The first page of a Quroosh section that has no screens yet: its title,
 * what it will hold, and a "being built" badge. The section's owner replaces
 * the call to this in their own page.tsx with the section's real screen.
 *
 * Managers only, like Applications and Guests, until the club decides who
 * else works each section. Anyone else gets a 404.
 */
export async function SectionPlaceholder({
  locale,
  projectId,
  section,
}: {
  locale: string;
  projectId: string;
  section: QurooshSectionKey;
}) {
  const access = await getQurooshAccess(projectId);
  if (!access || !can.manage(access.role)) notFound();

  const t = await getTranslations('quroosh');

  return (
    <div>
      <PageHeader
        title={t(`${section}.title`)}
        description={localized(access.project, 'name', locale)}
      />
      <Card>
        <Badge tone="brand">{t('sections.comingSoon')}</Badge>
        <p className="mt-3 text-ink-muted">{t(`${section}.body`)}</p>
      </Card>
    </div>
  );
}
