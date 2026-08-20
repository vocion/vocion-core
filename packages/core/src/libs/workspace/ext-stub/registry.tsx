/**
 * Default (empty) workspace component registry.
 *
 * The `@wsx/registry` alias resolves here unless the running workspace ships
 * its own `pages/components/registry.tsx`, in which case next.config.ts
 * points the alias at the tenant file instead. Tenant registries export the
 * same shape: a `components` map of name → React component. Workspace page
 * manifests reference these by name in their `widgets:` blocks.
 */
import type { ComponentType } from 'react';

export const components: Record<string, ComponentType<any>> = {};
