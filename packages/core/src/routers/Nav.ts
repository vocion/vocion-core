import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { MAX_PINS, PIN_KINDS } from '@/libs/pins/pinTarget';
import { dismissNavPrompt, getNavPrefs, setNavPins } from '@/services/NavPrefService';
import { guardAuth } from './AuthGuards';

/**
 * Per-user sidebar prefs — pins (ordered) and dismissed shell prompts — with
 * every object pin read live (`objects`): title and link as this person sees
 * them now, deleted or unreachable ones left out (`services/pins/PinService.ts`).
 */
export const getPrefs = os.handler(async () => {
  const { orgId, userId } = await guardAuth();
  const prefs = await getNavPrefs({ orgId, userId });
  const { resolvePins } = await import('@/services/pins/PinService');
  return { ...prefs, objects: await resolvePins({ orgId, userId }, prefs.pins) };
});

const target = z.object({ kind: z.enum(PIN_KINDS), id: z.string().min(1).max(200) });

/**
 * Pin one thing to this person's sidebar in this workspace: by target, or by
 * the path of the page they are on (⌘⇧P, the palette's "Pin this").
 */
export const pin = os
  .input(z.union([z.object({ target }), z.object({ path: z.string().min(1).max(500) })]))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { PinError, pinObject, resolvePins, targetForPath } = await import('@/services/pins/PinService');
    const chosen = 'target' in input ? input.target : await targetForPath(orgId, input.path);
    if (!chosen) {
      throw new ORPCError('BAD_REQUEST', { message: 'There is nothing on this page to pin.' });
    }
    try {
      const res = await pinObject({ orgId, userId }, chosen);
      return { ...res, objects: await resolvePins({ orgId, userId }, res.pins) };
    } catch (error) {
      if (error instanceof PinError) {
        throw new ORPCError('BAD_REQUEST', { message: error.message });
      }
      throw error;
    }
  });

/** Unpin by the stored key (`pinKey`). */
export const unpin = os
  .input(z.object({ key: z.string().min(1).max(300) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { resolvePins, unpinKey } = await import('@/services/pins/PinService');
    const res = await unpinKey({ orgId, userId }, input.key);
    return { ...res, objects: await resolvePins({ orgId, userId }, res.pins) };
  });

export const setPins = os
  .input(z.object({ pins: z.array(z.string().min(1).max(300)).max(MAX_PINS) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return setNavPins({ orgId, userId, pins: input.pins });
  });

export const dismiss = os
  .input(z.object({ id: z.string().min(1).max(60) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return dismissNavPrompt({ orgId, userId, id: input.id });
  });

/**
 * Where this workspace stands on its four first steps — the sidebar's
 * Getting started checklist, read from what is really there
 * (`services/workspace/gettingStarted.ts`). Null for a personal workspace.
 */
export const gettingStarted = os.handler(async () => {
  const { orgId } = await guardAuth();
  const { gettingStartedFor } = await import('@/services/workspace/gettingStarted');
  const state = await gettingStartedFor(orgId);
  return state ? { steps: state.steps, done: state.done, total: state.total, fresh: state.fresh } : null;
});
