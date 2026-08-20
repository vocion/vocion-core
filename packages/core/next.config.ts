import type { NextConfig } from 'next';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';
import './src/libs/Env';

// Workspace component registry (workspace pages, docs/workspace-pages.md):
// if the running workspace ships pages/components/registry.tsx, alias
// `@wsx/registry` at it so tenant React widgets compile into the app;
// otherwise fall back to the empty in-repo stub.
//
// Turbopack only compiles files under the project root and refuses both
// absolute alias paths and symlinks that escape the root, so the tenant
// components are SNAPSHOTTED into the gitignored src/wsx-ext/ at config
// load. Restart dev after editing a workspace registry.
const wsxCandidate = process.env.WORKSPACE_PATH
  ? join(process.env.WORKSPACE_PATH, 'pages/components')
  : null;
const wsxDir = join(__dirname, 'src/wsx-ext');
rmSync(wsxDir, { recursive: true, force: true });
// Alias values must be project-relative specifiers.
let wsxRegistry = './src/libs/workspace/ext-stub/registry.tsx';
if (wsxCandidate && existsSync(join(wsxCandidate, 'registry.tsx'))) {
  cpSync(wsxCandidate, wsxDir, { recursive: true, dereference: true });
  wsxRegistry = './src/wsx-ext/registry.tsx';
}

// Define the base Next.js configuration
const baseConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      '@wsx/registry': wsxRegistry,
    },
  },
  webpack: (config) => {
    config.resolve.alias['@wsx/registry'] = join(__dirname, wsxRegistry);
    return config;
  },
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
