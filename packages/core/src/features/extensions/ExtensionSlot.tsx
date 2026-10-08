import type { ExtensionSlotContext, ExtensionSlotName } from '@/libs/extensions';
import { clerkAuth as auth } from '@/libs/Auth';
import { slotComponents } from '@/libs/extensions';

/**
 * Renders what extensions put in one server-rendered slot (`libs/extensions.ts`),
 * in extension order. Nothing at all when none did, so a page without an
 * extension renders exactly as before.
 *
 * Slots: `system.actions` (the System page's title-bar actions) and
 * `spend.stats` (the spend page's figure row).
 * @param props - The slot.
 * @param props.name - Which slot.
 * @param props.locale - The page's locale.
 */
export async function ExtensionSlot(props: { name: ExtensionSlotName; locale: string }) {
  const components = slotComponents(props.name);
  if (components.length === 0) {
    return null;
  }
  const session = await auth();
  const ctx: ExtensionSlotContext = {
    locale: props.locale,
    userId: session.userId,
    orgId: session.orgId,
    accountId: session.accountId,
    role: session.role,
  };
  // A slot's list is fixed at build time, so its position is a stable key.
  return components.map((Component, index) => <Component key={`${props.name}-${String(index)}`} ctx={ctx} />);
}
