/**
 * THE FACTORY FLOW'S OWN STEPS (backlog 054). The software-factory plugin's
 * request flow (`templates/plugins/software-factory/workflows/request.yaml`)
 * is data; what it needs to know about the factory's world — how a worker run
 * ended and what recovery would do with it, the release's recorded live
 * check, and how to stop a request for a person — is here, as actions the
 * flow calls with `do:`. Only a flow calls them (`invokedBy` starts
 * `workflow:`); they are the factory's meaning, kept out of the engine.
 */

import type { Action } from './types';
import { z } from 'zod';

const onlyAFlow = (invokedBy: string | undefined, id: string): string | undefined =>
  String(invokedBy ?? '').startsWith('workflow:') ? undefined : `${id} is a step of the request flow; nothing else calls it.`;

const readAttemptInput = z.object({
  workerRunId: z.coerce.number().int().positive(),
  /** Automatic attempts in a row so far, for the recovery decision. */
  automatic: z.coerce.number().int().min(0).default(0),
});

export const factoryReadAttemptAction: Action<typeof readAttemptInput> = {
  id: 'factory.read_attempt',
  name: 'Read an attempt',
  description: 'How a build attempt\'s worker run ended: its status, the branch it kept, its pull request, the failure in a sentence and what recovery would do next. A step of the request flow.',
  inputSchema: readAttemptInput,
  grant: 'factory_write',
  external: false,
  dedupKeyFor: input => `factory.read_attempt:${input.workerRunId}:${Date.now()}`,
  ownsDedupKey: true,
  async precheck(ctx) {
    return onlyAFlow(ctx.invokedBy, 'factory.read_attempt');
  },
  async execute(ctx, input) {
    const { getWorkerRun } = await import('@/services/WorkerRunService');
    const { classifyFailure, recoveryDecision } = await import('@/services/factory/recovery');
    const run = await getWorkerRun(ctx.orgId, input.workerRunId);
    const result = (run?.result ?? {}) as Record<string, unknown>;
    const branch = typeof result.keptBranch === 'string' ? result.keptBranch : typeof result.branch === 'string' ? result.branch : null;
    const prUrl = typeof result.prUrl === 'string' ? result.prUrl : typeof result.pr_url === 'string' ? result.pr_url : null;
    const status = run?.status ?? 'unknown';
    if (status === 'completed' && prUrl) {
      return { status, branch, prUrl, failure: null, decision: { do: 'none', why: '' } };
    }
    const failure = classifyFailure({ status, error: run?.error ?? null, failures: (run?.failures ?? []) as never, result });
    const d = recoveryDecision({ failure, attempts: input.automatic });
    return { status, branch, prUrl, failure: failure.sentence, decision: { do: d.do, why: 'why' in d ? String(d.why) : failure.sentence } };
  },
};

const stopInput = z.object({
  requestId: z.coerce.number().int().positive(),
  why: z.string().min(1).max(1000),
});

export const factoryStopRequestAction: Action<typeof stopInput> = {
  id: 'factory.stop_request',
  name: 'Stop a request for a person',
  description: 'Stop a request\'s automatic work and ask a person once, with the reason and what would unblock it. A step of the request flow.',
  inputSchema: stopInput,
  grant: 'factory_write',
  external: false,
  dedupKeyFor: input => `factory.stop_request:${input.requestId}:${Date.now()}`,
  ownsDedupKey: true,
  async precheck(ctx) {
    return onlyAFlow(ctx.invokedBy, 'factory.stop_request');
  },
  async execute(ctx, input) {
    const { stopRequestForPerson } = await import('@/services/factory/carry');
    await stopRequestForPerson(ctx.orgId, input.requestId, input.why);
    return { requestId: input.requestId, stopped: true, why: input.why };
  },
};

const readLiveInput = z.object({ releaseId: z.coerce.number().int().positive() });

export const factoryReadReleaseLiveAction: Action<typeof readLiveInput> = {
  id: 'factory.read_release_live',
  name: 'Read a release\'s live check',
  description: 'What the live check recorded on a release (`liveState`, its line), or no state when none was recorded. A step of the request flow.',
  inputSchema: readLiveInput,
  grant: 'factory_write',
  external: false,
  dedupKeyFor: input => `factory.read_release_live:${input.releaseId}:${Date.now()}`,
  ownsDedupKey: true,
  async precheck(ctx) {
    return onlyAFlow(ctx.invokedBy, 'factory.read_release_live');
  },
  async execute(ctx, input) {
    const { readRecord } = await import('./factory-dispatch');
    const release = await readRecord(ctx.orgId, input.releaseId);
    const state = release?.meta.liveState;
    return typeof state === 'string' && state
      ? { releaseId: input.releaseId, state, line: String(release!.meta.liveSummary ?? release!.meta.liveWhy ?? state) }
      : { releaseId: input.releaseId, state: null, line: null };
  },
};
