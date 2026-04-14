import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Files to exclude from Knip analysis
  ignore: [
    'checkly.config.ts',
    'src/components/ui/*',
    'src/libs/I18n.ts',
    'src/libs/onyx/client.ts',
    'src/libs/gamma/client.ts',
    'src/types/Auth.ts',
    'src/types/Table.ts',
    'src/services/**/*.ts',
    'src/scripts/**/*.ts',
    'src/features/dashboard/ApprovalCard.tsx',
    'src/features/dashboard/DraftCard.tsx',
    'src/features/landing/CenteredHero.tsx',
    'src/features/landing/LogoCloud.tsx',
    'src/features/sponsors/SponsorLogos.tsx',
    'src/templates/Sponsors.tsx',
    'src/components/DemoBadge.tsx',
    'src/features/dashboard/ComingSoon.tsx',
    'tests/**/*.ts',
    'infra/onyx/onyx-repo/**',
  ],
  // Dependencies to ignore during analysis
  ignoreDependencies: [
    '@commitlint/types',
    '@clerk/types',
    '@swc/helpers', // Avoid error in CI: "`npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync."
    'conventional-changelog-conventionalcommits',
    'vite',
  ],
  // Binaries to ignore during analysis
  ignoreBinaries: [
    'production', // False positive raised with dotenv-cli
    'stripe', // False positive
  ],
  compilers: {
    css: (text: string) => [...text.matchAll(/(?<=@)import[^;]+/g)].join('\n'),
  },
};

export default config;
