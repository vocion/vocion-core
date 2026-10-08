'use client';

import type { NavSlotName, NavSlotProps } from '@/libs/extensions';
import { navSlotComponents } from '@/libs/clientExtensions';

/**
 * Renders what client extensions put in one sidebar slot
 * (`libs/clientExtensions.ts`), in extension order, each given the same
 * inputs. Nothing at all when none did.
 *
 * Slot: `nav.aboveWorkspaceSwitcher`, directly above the workspace switcher
 * at the head of every app's nav.
 * @param props - The slot and what its components receive.
 * @param props.name - Which slot.
 */
export function NavSlot({ name, ...slot }: NavSlotProps & { name: NavSlotName }) {
  // A slot's list is fixed at build time, so its position is a stable key.
  return navSlotComponents(name).map((Component, index) => <Component key={`${name}-${String(index)}`} {...slot} />);
}
