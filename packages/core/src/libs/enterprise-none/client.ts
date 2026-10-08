/**
 * What `@vocion/enterprise/client` resolves to when no enterprise package is
 * built in, or when the one built in has no client half: nothing in the
 * sidebar. See `libs/clientExtensions.ts`.
 */

import type { VocionClientExtension } from '@/libs/extensions';

export const clientExtensions: readonly VocionClientExtension[] = [];
