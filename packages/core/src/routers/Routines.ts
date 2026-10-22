import { os } from '@orpc/server';
import { z } from 'zod';
import { ROUTINE_TRUST } from '@/libs/routines/types';
import { guardAuth } from './AuthGuards';

/**
 * A person's hand on routines (`services/routines/`): list them, read one and its batches, read a
 * batch as its queue draws it, approve a version, set the trust level, answer the analyst's open
 * questions, run one for many rows, answer a run waiting on them, and build a batch's report. The
 * pages and the chat pane call these; nothing here starts a browser the person did not ask for.
 */

export const listRoutinesRoute = os.handler(async () => {
  const { orgId } = await guardAuth();
  const { listRoutines } = await import('@/services/routines/routineReads');
  return { routines: await listRoutines(orgId) };
});

export const getRoutineRoute = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const { batchesOf, getRoutine } = await import('@/services/routines/routineReads');
    const routine = await getRoutine(orgId, input.id);
    return { routine, batches: routine ? await batchesOf(orgId, input.id) : [] };
  });

export const getRoutineBatchRoute = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const { getBatch } = await import('@/services/routines/routineReads');
    return { batch: await getBatch(orgId, input.id) };
  });

export const actOnRoutineRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    action: z.enum(['approve', 'trust', 'answer_question', 'expert', 'attach_recording', 'retire']),
    trust: z.enum(ROUTINE_TRUST).optional(),
    questionId: z.string().trim().min(1).max(40).optional(),
    answer: z.string().trim().min(1).max(2_000).optional(),
    expertUserId: z.string().trim().min(1).max(120).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const svc = await import('@/services/routines/RoutineService');
    const { getRoutine } = await import('@/services/routines/routineReads');
    try {
      if (input.action === 'approve') {
        await svc.approveRoutineVersion(orgId, userId, input.id);
      } else if (input.action === 'trust') {
        if (!input.trust) {
          return { routine: await getRoutine(orgId, input.id), error: 'Choose a trust level.' };
        }
        await svc.setRoutineTrust(orgId, userId, input.id, input.trust);
      } else if (input.action === 'answer_question') {
        if (!input.questionId || !input.answer) {
          return { routine: await getRoutine(orgId, input.id), error: 'Write an answer first.' };
        }
        await svc.answerRoutineQuestion(orgId, userId, input.id, input.questionId, input.answer);
      } else if (input.action === 'attach_recording') {
        if (!input.answer) {
          return { routine: await getRoutine(orgId, input.id), error: 'Paste the Slate link first.' };
        }
        await svc.attachRecording(orgId, userId, input.id, input.answer);
      } else if (input.action === 'expert') {
        await svc.setRoutineExpert(orgId, userId, input.id, input.expertUserId ?? userId);
      } else {
        await svc.retireRoutine(orgId, userId, input.id);
      }
    } catch (e) {
      if (e instanceof svc.RoutineError) {
        return { routine: await getRoutine(orgId, input.id), error: e.message };
      }
      throw e;
    }
    return { routine: await getRoutine(orgId, input.id), error: null };
  });

export const runRoutineRoute = os
  .input(z.object({
    id: z.number().int().positive(),
    rows: z.array(z.record(z.string(), z.string().max(2_000))).min(1).max(200),
    /** Inputs every row shares (the campaign, the sign-in); a secret input's value too. */
    shared: z.record(z.string(), z.string().max(2_000)).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const svc = await import('@/services/routines/RoutineService');
    try {
      const batch = await svc.startRoutineBatch({ orgId, userId, routineId: input.id, rows: input.rows, shared: input.shared ?? {}, conversationId: null });
      return { batch, error: null };
    } catch (e) {
      if (e instanceof svc.RoutineError) {
        return { batch: null, error: e.message };
      }
      throw e;
    }
  });

export const answerRoutineRunRoute = os
  .input(z.object({
    runId: z.number().int().positive(),
    action: z.enum(['approve', 'deny', 'answer', 'stop']),
    text: z.string().trim().min(1).max(2_000).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const svc = await import('@/services/routines/RoutineService');
    try {
      const batch = await svc.answerRoutineRun(orgId, userId, input.runId, input.action === 'answer' ? { kind: 'answer', text: input.text ?? '' } : { kind: input.action });
      return { batch, error: null };
    } catch (e) {
      if (e instanceof svc.RoutineError) {
        return { batch: null, error: e.message };
      }
      throw e;
    }
  });

export const routineReportRoute = os
  .input(z.object({ batchId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const svc = await import('@/services/routines/RoutineService');
    try {
      return { report: await svc.buildRoutineReport(orgId, userId, input.batchId), error: null };
    } catch (e) {
      if (e instanceof svc.RoutineError) {
        return { report: null, error: e.message };
      }
      throw e;
    }
  });

/**
 * Teach a routine: file it, and hand back where to record. The page opens the site to teach on in a
 * new tab and the recorder beside it; Vocion picks the finished recording up on its own.
 */
export const teachRoutineRoute = os
  .input(z.object({
    name: z.string().trim().min(3).max(120),
    targetUrl: z.string().trim().url().max(2_000).optional(),
    note: z.string().trim().max(2_000).optional(),
    slateUrl: z.string().trim().url().max(2_000).optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const svc = await import('@/services/routines/RoutineService');
    try {
      const out = await svc.startTeaching({ orgId, userId, name: input.name, targetUrl: input.targetUrl ?? null, note: input.note ?? null, slateUrl: input.slateUrl ?? null, conversationId: null });
      return { routine: out.routine, recordUrl: out.recordUrl, error: null };
    } catch (e) {
      if (e instanceof svc.RoutineError) {
        return { routine: null, recordUrl: null, error: e.message };
      }
      throw e;
    }
  });

/** Answer a batch's finding (deactivate the people not on the list, leave them…). */
export const answerRoutineFindingRoute = os
  .input(z.object({ batchId: z.number().int().positive(), findingId: z.string().trim().min(1).max(40), answer: z.string().trim().min(1).max(500) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const svc = await import('@/services/routines/RoutineService');
    try {
      return { batch: await svc.answerFinding(orgId, userId, input.batchId, input.findingId, input.answer), error: null };
    } catch (e) {
      if (e instanceof svc.RoutineError) {
        return { batch: null, error: e.message };
      }
      throw e;
    }
  });

/** The practice routine (add a user and enroll them, on the practice console), and with `run` its roster as a batch. */
export const practiceRoutineRoute = os
  .input(z.object({ run: z.boolean().optional() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const svc = await import('@/services/routines/RoutineService');
    const routine = await svc.createPracticeRoutine(orgId, userId);
    if (!input.run) {
      return { routine, batch: null, error: null };
    }
    const { practiceRoutineBatch } = await import('@/services/routines/practice');
    const { rows, shared } = practiceRoutineBatch();
    try {
      const batch = await svc.startRoutineBatch({ orgId, userId, routineId: routine.id, rows, shared, conversationId: null });
      return { routine, batch, error: null };
    } catch (e) {
      if (e instanceof svc.RoutineError) {
        return { routine, batch: null, error: e.message };
      }
      throw e;
    }
  });
