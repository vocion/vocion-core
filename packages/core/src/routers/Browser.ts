import { os } from '@orpc/server';
import { z } from 'zod';
import { guardAuth } from './AuthGuards';

/**
 * A person's hand on their browser runs (`services/browser/BrowserRunService.ts`): read one, start
 * a suggested one, stop it, approve or decline the step it holds, answer its question, and start
 * the practice task. On the RPC route, which already reaches the server, so no page or route that
 * only shows a run has to (CI.yml "Build memory"). Only the run's own person may act on it.
 */

export const getBrowserRunRoute = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const { getBrowserRun } = await import('@/services/browser/BrowserRunService');
    return { run: await getBrowserRun(orgId, input.id) };
  });

export const actOnBrowserRunRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    action: z.enum(['start', 'stop', 'approve', 'deny', 'answer']),
    note: z.string().trim().max(500).optional(),
    text: z.string().trim().min(1).max(500).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const svc = await import('@/services/browser/BrowserRunService');
    try {
      if (input.action === 'start') {
        await svc.startBrowserRun(orgId, userId, input.id);
      } else if (input.action === 'stop') {
        await svc.stopBrowserRun(orgId, userId, input.id);
      } else if (input.action === 'approve') {
        await svc.answerBrowserRun(orgId, userId, input.id, { kind: 'approve' });
      } else if (input.action === 'deny') {
        await svc.answerBrowserRun(orgId, userId, input.id, { kind: 'deny', note: input.note });
      } else {
        if (!input.text) {
          return { run: await svc.getBrowserRun(orgId, input.id), error: 'Write an answer first.' };
        }
        await svc.answerBrowserRun(orgId, userId, input.id, { kind: 'answer', text: input.text });
      }
    } catch (e) {
      if (e instanceof svc.BrowserRunBusyError || e instanceof svc.BrowserRunError) {
        return { run: await svc.getBrowserRun(orgId, input.id), error: e.message };
      }
      throw e;
    }
    return { run: await svc.getBrowserRun(orgId, input.id), error: null };
  });

export const practiceBrowserRunRoute = os.handler(async () => {
  const { orgId, userId } = await guardAuth();
  const svc = await import('@/services/browser/BrowserRunService');
  const { PRACTICE_EXAMPLE } = await import('@/services/browser/practiceSite');
  try {
    const run = await svc.createBrowserRun({
      orgId,
      userId,
      task: PRACTICE_EXAMPLE.task,
      startUrl: PRACTICE_EXAMPLE.startUrl,
      inputs: { ...PRACTICE_EXAMPLE.inputs },
      secretNames: [...PRACTICE_EXAMPLE.secretInputs],
      outputs: PRACTICE_EXAMPLE.outputs.map(o => ({ ...o })),
      proposedBy: 'person',
      start: true,
    });
    return { run, error: null };
  } catch (e) {
    if (e instanceof svc.BrowserRunBusyError) {
      return { run: null, error: `Not started: ${e.message}` };
    }
    throw e;
  }
});
