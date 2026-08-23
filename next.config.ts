import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack ignores unrelated lockfiles that
  // happen to sit in parent directories on a developer's machine.
  turbopack: { root: import.meta.dirname },

  experimental: {
    serverActions: {
      /*
       * Uploads go through server actions: profile photos (2 MB bucket limit)
       * and design deliverables (10 MB). The limit here applies to the whole
       * multipart body, so it has to clear the largest of those plus the
       * boundaries and part headers around it — hence 12 MB rather than 10.
       */
      bodySizeLimit: '12mb',
    },
  },
};

export default withNextIntl(nextConfig);
