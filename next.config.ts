import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack ignores unrelated lockfiles that
  // happen to sit in parent directories on a developer's machine.
  turbopack: { root: import.meta.dirname },
};

export default withNextIntl(nextConfig);
