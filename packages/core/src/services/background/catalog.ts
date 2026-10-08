import { defineJob } from '@/libs/durable/jobs';

/**
 * EVERY BACKGROUND JOB THIS BUILD RUNS (v0.6.0): what the durable executor used
 * to run, by name, with the retry each had. Schedules and one-off starts name
 * these (`libs/durable/jobs.ts`). Each handler imports its work lazily.
 */

export const JOB = {
  sourceSync: 'source.sync',
  workflowTrigger: 'workflow.trigger',
  missionCheck: 'mission.check',
  automationFire: 'automation.fire',
  langfuseRetention: 'langfuse.retention',
  workerRunReaper: 'worker-run.reap',
  missionRunReaper: 'mission-run.reap',
  artifactImageSweep: 'artifact-image.sweep',
  evalRefresh: 'eval.refresh',
  bulkBriefRegenerate: 'brief.bulk-regenerate',
  durablePrune: 'durable.prune',
  recordingNarrate: 'recording.narrate',
  needsYouSweep: 'needs-you.sweep',
  missionRunResume: 'mission-run.resume',
  orgReview: 'org.review',
} as const;

const twice = { attempts: 2, intervalSeconds: 10, backoff: 2 };

defineJob<{ orgId: string; sourceId: number; incremental?: boolean }>(JOB.sourceSync, async (input) => {
  const { syncSourceActivity } = await import('./sourceSync');
  return syncSourceActivity({ orgId: input.orgId, sourceId: input.sourceId, incremental: input.incremental ?? true });
}, { retry: { attempts: 3, intervalSeconds: 5, backoff: 2 } });

defineJob<{ orgId: string; workflowSlug: string; input?: Record<string, unknown> }>(JOB.workflowTrigger, async (input) => {
  const { startWorkflowRunActivity } = await import('./startWorkflowRun');
  return startWorkflowRunActivity({ orgId: input.orgId, workflowSlug: input.workflowSlug, input: input.input ?? {} });
}, { retry: twice });

defineJob<{ orgId: string; missionSlug: string }>(JOB.missionCheck, async (input) => {
  const { startMissionRunActivity } = await import('./startMissionRun');
  return startMissionRunActivity({ orgId: input.orgId, missionSlug: input.missionSlug });
}, { retry: twice });

defineJob<import('./fireAutomation').FireAutomationActivityInput>(JOB.automationFire, async (input) => {
  const { fireAutomationActivity } = await import('./fireAutomation');
  return fireAutomationActivity(input);
}, { retry: twice });

defineJob(JOB.langfuseRetention, async () => {
  const { pruneLangfuseTracesActivity } = await import('./langfuseRetention');
  return pruneLangfuseTracesActivity();
}, { retry: { attempts: 3, intervalSeconds: 10, backoff: 2 } });

defineJob(JOB.workerRunReaper, async () => {
  const { reapWorkerRunsActivity } = await import('./reapWorkerRuns');
  return reapWorkerRunsActivity();
}, { retry: twice });

defineJob(JOB.missionRunReaper, async () => {
  const { reapMissionRunsActivity } = await import('./reapMissionRuns');
  return reapMissionRunsActivity();
}, { retry: twice });

defineJob(JOB.artifactImageSweep, async () => {
  const { sweepArtifactImagesActivity } = await import('./sweepArtifactImages');
  return sweepArtifactImagesActivity();
});

/** How long an eval batch is polled, and how often. */
const EVAL_POLL_MS = 60_000;
const EVAL_POLL_ATTEMPTS = 30;

defineJob<{ orgId: string; datasetSlug: string; concurrency?: number }>(JOB.evalRefresh, async (input, ctx) => {
  const { advanceEvalBatchActivity, runEvalDatasetActivity } = await import('./runEvalDataset');
  // The run's own id groups the results, so every retry of the step writes the same group.
  const result = await ctx.step('run', () => runEvalDatasetActivity({ orgId: input.orgId, datasetSlug: input.datasetSlug, runGroupId: ctx.runId, concurrency: input.concurrency }), { attempts: 3, intervalSeconds: 10, backoff: 2 });
  if (result.batchJobId === null) {
    return result;
  }
  for (let attempt = 0; attempt < EVAL_POLL_ATTEMPTS; attempt++) {
    await ctx.sleep(EVAL_POLL_MS);
    if (await ctx.step(`poll-${attempt}`, () => advanceEvalBatchActivity(result.batchJobId!), { attempts: 3, intervalSeconds: 10, backoff: 2 })) {
      return result;
    }
  }
  return result;
}, { whole: true });

/** Leads regenerated at once. */
export const BULK_BRIEF_REGENERATE_CONCURRENCY = 2;

defineJob<{ orgId: string; jobId: number; leadIds: number[]; note: string; by: string }>(JOB.bulkBriefRegenerate, async (input, ctx) => {
  const { finishBulkJobActivity, regenerateLeadBriefActivity } = await import('./bulkRegenerate');
  let landed = 0;
  let failed = 0;
  for (let i = 0; i < input.leadIds.length; i += BULK_BRIEF_REGENERATE_CONCURRENCY) {
    const chunk = input.leadIds.slice(i, i + BULK_BRIEF_REGENERATE_CONCURRENCY);
    const results = await Promise.all(chunk.map(leadId => ctx.step(`lead-${leadId}`, () => regenerateLeadBriefActivity({ orgId: input.orgId, jobId: input.jobId, leadId, note: input.note, by: input.by }), twice).catch(() => ({ state: 'failed' as const }))));
    for (const r of results) {
      if (r.state === 'landed') {
        landed += 1;
      } else {
        failed += 1;
      }
    }
  }
  await ctx.step('finish', () => finishBulkJobActivity({ orgId: input.orgId, jobId: input.jobId }));
  return { landed, failed };
}, { whole: true });

/** Finished background runs older than this are pruned from the durable tables. */
const PRUNE_AFTER_DAYS = 7;

defineJob(JOB.durablePrune, async () => {
  const { pruneFinishedJobRuns } = await import('@/libs/durable/prune');
  return pruneFinishedJobRuns(PRUNE_AFTER_DAYS);
});

// A recording narrated in its seat's voice (`services/jobs/narrateRecording.ts`): a
// model call, a few voice calls and one ffmpeg pass — minutes, off the event's path.
// Never retried: a refusal is written where the person reads the request.
defineJob<{ orgId: string; artifactId: number; narrator: string }>(JOB.recordingNarrate, async (input) => {
  const { narrateRecordingActivity } = await import('@/services/jobs/narrateRecording');
  return narrateRecordingActivity(input);
});

// The clock on Needs you (`services/needsYou/`): open clocks, escalate, apply
// or hold defaults at their deadlines, then resume any parked run whose
// questions were answered. Every row it cannot process says why and is retried
// on the next pass, so a failure here never needs a retry of the whole job.
defineJob(JOB.needsYouSweep, async () => {
  const { sweepDecisionClocks } = await import('@/services/needsYou/DecisionClockService');
  const { healParkedGates } = await import('@/services/needsYou/ResumeGateService');
  const clocks = await sweepDecisionClocks();
  const gates = await healParkedGates();
  return { ...clocks, gates };
});

// A mission run parked on its questions, picked up again once they are answered
// (`ResumeGateService.resumeGate`). The claim is the run's own conditional write,
// so a second start of the same resume finds nothing to do.
defineJob<{ orgId: string; runId: number; gateId: number }>(JOB.missionRunResume, async (input) => {
  const { resumeParkedMissionRun } = await import('@/services/needsYou/ResumeGateService');
  return resumeParkedMissionRun(input);
});

// The weekly org review (`services/orgReview`): reads the workspace's evidence,
// files `org.change` proposals on Needs you, and runs the learning compaction
// when it is due. Retried once — a re-run refreshes the cards it already
// filed rather than doubling them (each proposal has a dedup key).
defineJob<{ orgId: string }>(JOB.orgReview, async (input) => {
  const { orgReviewLine, runOrgReview } = await import('@/services/orgReview/OrgReviewService');
  const result = await runOrgReview(input.orgId);
  console.warn(`[durable] ${orgReviewLine(result)}`);
  return result;
}, { retry: twice });
