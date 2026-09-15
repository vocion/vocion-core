import { os } from '@orpc/server';
import { z } from 'zod';
import { dismissNavPrompt, getNavPrefs, setNavPins } from '@/services/NavPrefService';
import { guardAuth } from './AuthGuards';

/** Per-user sidebar prefs — pins (ordered) and dismissed shell prompts. */
export const getPrefs = os.handler(async () => {
  const { orgId, userId } = await guardAuth();
  return getNavPrefs({ orgId, userId });
});

export const setPins = os
  .input(z.object({ pins: z.array(z.string().min(1).max(300)).max(40) }))
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
