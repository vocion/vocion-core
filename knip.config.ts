import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Files to exclude from Knip analysis
  ignore: [
    'packages/core/checkly.config.ts',
    'packages/core/src/components/ui/*',
    'packages/core/src/libs/I18n.ts',
    'packages/core/src/libs/onyx/client.ts',
    'packages/core/src/libs/gamma/client.ts',
    'packages/core/src/types/Auth.ts',
    'packages/core/src/types/Table.ts',
    'packages/core/src/services/**/*.ts',
    'packages/core/src/scripts/**/*.ts',
    'packages/core/src/libs/context/**',
    'packages/core/src/libs/plugins/**',
    'packages/core/src/libs/llm/**',
    'packages/core/src/features/dashboard/ApprovalCard.tsx',
    'packages/core/src/features/dashboard/DraftCard.tsx',
    'packages/core/src/features/landing/CenteredHero.tsx',
    'packages/core/src/features/landing/LogoCloud.tsx',
    'packages/core/src/features/sponsors/SponsorLogos.tsx',
    'packages/core/src/templates/Sponsors.tsx',
    'packages/core/src/components/DemoBadge.tsx',
    'packages/core/src/features/dashboard/ComingSoon.tsx',
    'packages/core/tests/**/*.ts',
    'packages/plugins/**/src/index.ts',
    'infra/onyx/onyx-repo/**',
  ],
  // Dependencies to ignore during analysis
  ignoreDependencies: [
    '@commitlint/types',
    '@clerk/types',
    '@hookform/resolvers', // used by ignored shadcn ui file
    '@radix-ui/react-accordion', // used by ignored shadcn ui file
    '@radix-ui/react-icons', // used by ignored shadcn ui file
    '@radix-ui/react-label', // used by ignored shadcn ui file
    '@tanstack/react-table', // used by ignored shadcn ui file
    'radix-ui', // used by ignored shadcn ui file
    'react-hook-form', // used by ignored shadcn ui file
    '@swc/helpers', // Avoid error in CI: "`npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync."
    'checkly', // used in .github/workflows/checkly.yml
    '@tailwindcss/typography', // loaded via `@plugin` in global.css
    'conventional-changelog-conventionalcommits',
    'vite',
  ],
  // Binaries to ignore during analysis
  ignoreBinaries: [
    'production', // False positive raised with dotenv-cli
    'stripe', // False positive
    'dotenv', // used in .github/workflows/checkly.yml
    'checkly', // used in .github/workflows/checkly.yml
  ],
  compilers: {
    css: (text: string) => [...text.matchAll(/(?<=@)import[^;]+/g)].join('\n'),
  },
};

export default config;
