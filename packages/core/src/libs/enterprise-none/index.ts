/**
 * What `@vocion/enterprise` resolves to when no enterprise package is built
 * in: no extensions. See `libs/extensions.ts` and `libs/enterpriseCheckout.ts`.
 */

import type { VocionExtension } from '@/libs/extensions';

export const extensions: readonly VocionExtension[] = [];
