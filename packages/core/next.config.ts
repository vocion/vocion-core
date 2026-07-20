import type { NextConfig } from 'next';
import { join } from 'node:path';
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';
import './src/libs/Env';

// Define the base Next.js configuration
const baseConfig: NextConfig = {
  // Standalone output for Docker — produces .next/standalone/ with only
  // the runtime deps the server needs (cuts image size ~1.5GB → ~250MB).
  // Required by the production Dockerfile in this same directory.
  output: 'standalone',
  // Capture monorepo root one level up so node_modules tracing works.
  outputFileTracingRoot: join(__dirname, '../..'),
  // Hide the floating Next.js dev indicator ("N" FAB) — it overlaps the
  // chat composer's thumb zone on a 390px viewport. `false` disables it
  // entirely in Next 16 (the object form only repositions it).
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // Temporal's client can't be webpack-bundled: its gRPC/proto data files
  // don't ride into the bundle, so Connection.connect() throws at runtime
  // (the dashboard then shows "not scheduled yet" for every schedule).
  // Externalizing keeps it a real node_modules dependency, which `output:
  // standalone` traces into the runtime image.
  serverExternalPackages: ['@temporalio/client', '@temporalio/common', '@temporalio/proto'],
  reactCompiler: process.env.NODE_ENV === 'production', // Keep the development environment fast
  outputFileTracingIncludes: {
    '/': ['./migrations/**/*'],
  },
};

// Initialize the Next-Intl plugin
let configWithPlugins = createNextIntlPlugin('./src/libs/I18n.ts')(baseConfig);

// Conditionally enable bundle analysis
if (process.env.ANALYZE === 'true') {
  configWithPlugins = withBundleAnalyzer()(configWithPlugins);
}

// Conditionally enable Sentry configuration
if (!process.env.NEXT_PUBLIC_SENTRY_DISABLED) {
  configWithPlugins = withSentryConfig(configWithPlugins, {
    // For all available options, see:
    // https://www.npmjs.com/package/@sentry/webpack-plugin#options
    org: process.env.SENTRY_ORGANIZATION,
    project: process.env.SENTRY_PROJECT,

    // Only print logs for uploading source maps in CI
    silent: !process.env.CI,

    // For all available options, see:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
    // This can increase your server load as well as your hosting bill.
    // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
    // side errors will fail.
    tunnelRoute: '/monitoring',

    webpack: {
      reactComponentAnnotation: {
        enabled: true,
      },

      // Tree-shake Sentry logger statements to reduce bundle size
      treeshake: {
        removeDebugLogging: true,
      },
    },

    // Disable Sentry telemetry
    telemetry: false,
  });
}

const nextConfig = configWithPlugins;
export default nextConfig;
