import type { Action } from './types';
import { z } from 'zod';
import { PIN_KINDS } from '@/libs/pins/pinTarget';

/**
 * nav.pin — keep one thing in the asker's own sidebar, or take it out
 * (founder, 2026-10-09: "pin this page", said to the agent).
 *
 * The same pin the sidebar, a header's "Pin to sidebar" and ⌘⇧P make
 * (`services/pins/PinService.ts`), so an agent's pin is not a second kind of
 * favourite: it lands in the same list, in the same order, and the person can
 * drag it or unpin it like any other. Always the asker's own sidebar in this
 * workspace; never anyone else's. Reversible: Undo takes back exactly what
 * the run changed, and a pin that was already there is left alone.
 */

const NAV_PIN = 'nav.pin';

const input = z.object({
  /** What it is: conversation, artifact, wiki, room, view, record or page. */
  kind: z.enum(PIN_KINDS),
  /** Its id: a row id, a view's or page's slug, or a wiki page's `<page>/<slug>`. */
  id: z.string().min(1).max(200),
  /** Take it out of the sidebar instead. */
  unpin: z.boolean().optional(),
  reason: z.string().min(1).max(300).optional(),
});

export const navPinAction: Action<typeof input> = {
  id: NAV_PIN,
  name: 'Pin to sidebar',
  description: 'Pin one thing — a conversation, an artifact, a wiki page, a data room, a saved view, a record or an app page — to the asker\'s own sidebar in this workspace, or unpin it (`unpin: true`). Only ever the asker\'s own sidebar. Reversible.',
  inputSchema: input,
  grant: 'update_profile',
  external: false,
  dedupKeyFor: i => `nav.pin:${i.kind}:${i.id}:${i.unpin ? 'out' : 'in'}`,
  async precheck(ctx) {
    const { personBehind } = await import('@/services/chat/conversationChannel');
    const person = await personBehind(ctx.orgId, ctx.invokedBy);
    return person ? undefined : 'A sidebar belongs to a person, and this turn has none behind it. Ask them to sign in to Vocion.';
  },
  async reviewCard(_ctx, i) {
    return {
      title: i.unpin ? 'Unpin from the sidebar' : 'Pin to the sidebar',
      system: 'Sidebar',
      ...(i.reason ? { summary: i.reason } : {}),
      fields: [{ label: 'What', value: `${i.kind} ${i.id}` }],
      nextAction: 'Only your own sidebar changes. Undo puts it back.',
      verbs: { approve: i.unpin ? 'Unpin' : 'Pin it', reject: 'Leave it' },
    };
  },
  async execute(ctx, i) {
    const { personBehind } = await import('@/services/chat/conversationChannel');
    const person = await personBehind(ctx.orgId, ctx.invokedBy);
    if (!person) {
      throw new Error('No Vocion person behind this turn.');
    }
    const who = { orgId: ctx.orgId, userId: person.userId };
    const { pinKey } = await import('@/libs/pins/pinTarget');
    const { pinObject, resolvePins, unpinKey } = await import('@/services/pins/PinService');
    const target = { kind: i.kind, id: i.id };
    const key = pinKey(target);
    if (i.unpin) {
      const [was] = await resolvePins(who, [key]);
      const { changed } = await unpinKey(who, key);
      const title = was?.title ?? `${i.kind} ${i.id}`;
      return { userId: person.userId, key, changed, title, line: changed ? `Unpinned "${title}" from ${person.name}'s sidebar.` : `"${title}" was not pinned.` };
    }
    const { pin, changed } = await pinObject(who, target);
    const title = pin?.title ?? i.id;
    return {
      userId: person.userId,
      key,
      changed,
      title,
      ...(pin ? { href: pin.href } : {}),
      line: changed ? `Pinned "${title}" to ${person.name}'s sidebar.` : `"${title}" was already pinned.`,
    };
  },
  async undo(ctx, i, result) {
    const userId = typeof result?.userId === 'string' ? result.userId : null;
    if (!userId) {
      throw new Error('This run recorded no person, so there is nothing to undo.');
    }
    if (result?.changed !== true) {
      return { line: 'Nothing to put back: the sidebar was already that way.' };
    }
    const who = { orgId: ctx.orgId, userId };
    const { pinKey } = await import('@/libs/pins/pinTarget');
    const { pinObject, unpinKey } = await import('@/services/pins/PinService');
    if (i.unpin) {
      await pinObject(who, { kind: i.kind, id: i.id });
      return { line: 'Pinned it back.' };
    }
    await unpinKey(who, pinKey({ kind: i.kind, id: i.id }));
    return { line: 'Unpinned it.' };
  },
};
