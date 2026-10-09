/**
 * The client half of the extensions built into this app (`libs/extensions.ts`
 * holds the server half and every type). Safe to import from a client
 * component: `@vocion/enterprise/client` must export client-safe code only.
 */

import type { ComponentType } from 'react';
import type { NavSlotName, NavSlotPropsByName, VocionClientExtension } from '@/libs/extensions';
import { clientExtensions as built } from '@vocion/enterprise/client';

/** Every client extension, in the order the package lists them. Empty without one. */
export function clientExtensions(): readonly VocionClientExtension[] {
  return built;
}

/**
 * The components extensions put in one sidebar slot, in extension order.
 * @param name - The slot.
 */
export function navSlotComponents<K extends NavSlotName>(name: K): ComponentType<NavSlotPropsByName[K]>[] {
  return clientExtensions().flatMap(e => (e.navSlots?.[name] ?? []) as ComponentType<NavSlotPropsByName[K]>[]);
}
