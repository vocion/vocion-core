/**
 * Ambient types for the `@wsx/registry` alias (workspace pages, see
 * docs/workspace-pages.md). The alias resolves at build time to either the
 * running workspace's pages/components/registry.tsx snapshot or the empty
 * ext-stub — both export this shape.
 */
declare module '@wsx/registry' {
  import type { ComponentType } from 'react';

  export const components: Record<string, ComponentType<any>>;
}
