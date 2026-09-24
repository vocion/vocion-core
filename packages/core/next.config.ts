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
  // `build:next` and `next dev` both run on Turbopack, which reads the alias
  // above. This one only applies to `next build --webpack`. It stays so that
  // going back is one edit, putting `--webpack` back on `build:next` in
  // package.json, if a Turbopack build ever breaks (#670). Nothing in CI
  // builds with webpack any more, so that path is untested until someone
  // takes it. Next turns off its webpack build worker whenever this function
  // exists; that no longer costs anything.
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
  // CI type-checks core once, in the `static` job's `check:types`, and fails
  // the pull request there. Without this, `next build` ran the same check
  // again inside every build job (#629). Only CI skips it: a deploy or a
  // local build still refuses to produce an app with a type error in it.
  typescript: { ignoreBuildErrors: !!process.env.CI },
  // Temporal's client can't be webpack-bundled: its gRPC/proto data files
  // don't ride into the bundle, so Connection.connect() throws at runtime
  // (the dashboard then shows "not scheduled yet" for every schedule).
  // Externalizing keeps it a real node_modules dependency, which `output:
  // standalone` traces into the runtime image.
  serverExternalPackages: ['@temporalio/client', '@temporalio/common', '@temporalio/proto', '@electric-sql/pglite', 'playwright', 'playwright-core', 'pdf-parse'],
  reactCompiler: process.env.NODE_ENV === 'production', // Keep the development environment fast
  outputFileTracingIncludes: {
    // demo/**: the hosted demo sandbox's baked PGlite seed, recorded LLM
    // fixtures, and workspace — inert unless VOCION_LLM_MODE/pglite:// are set.
    // Keyed broadly: the DB (and thus the seed copy) boots in every function.
    // The pglite wasm bundle + extensions load via computed fs paths the
    // tracer cannot see; include them explicitly (hoisted at the repo root).
    // templates/**: the base pack and the plugins are read from disk at
    // request time by directory walk (plugin.yaml, pages/, teams/, trust.yaml,
    // README.md), which the tracer cannot follow — on 2026-09-18 the image
    // shipped each plugin's agents/ and skills/ only, so the Plugins page and
    // the chat saw an empty catalogue in production.
    '/': ['./migrations/**/*', './demo/**/*', './templates/**/*', '../../node_modules/@electric-sql/pglite/dist/**/*'],
    '/**': ['./migrations/**/*', './demo/**/*', './templates/**/*', '../../node_modules/@electric-sql/pglite/dist/**/*'],
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

    // Webpack-only: Turbopack builds (#670) ignore both options below, so a
    // Sentry-on build loses component names on breadcrumbs and replays. The
    // source-map upload still runs, through Sentry's after-compile hook.
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

/**
 * Hosts allowed to load `/_next/*` in dev.
 *
 * Next dev refuses cross-origin requests for its own assets, and refuses them
 * SILENTLY as far as the page is concerned: the server still renders, so a
 * reader gets HTML — the `loading.tsx` shimmer, a chat shell — and then the
 * client bundle never arrives, nothing hydrates, and the page sits on its
 * loading state forever. Every button is dead, because the handler that would
 * have run was never downloaded.
 *
 * That is what a tunnelled preview looks like from outside: the app appears
 * to hang on a skeleton. So any host the dev server is reached through has to
 * be named here. `VOCION_DEV_ORIGINS` (comma separated) covers a one-off
 * tunnel; the permanent preview host is listed by default so reconnecting it
 * needs no config at all.
 */
const devOrigins = [
  'dev.agents.metacto.com',
  ...(process.env.VOCION_DEV_ORIGINS ?? '')
    .split(',')
    .map(h => h.trim())
    .filter(Boolean),
];

const nextConfig = { ...configWithPlugins, allowedDevOrigins: devOrigins };
export default nextConfig;
