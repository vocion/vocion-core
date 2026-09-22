/**
 * What a BYOA worker's cache counts do to the budget.
 *
 * An external worker (`packages/agent-runtime`) reports its own usage over
 * HTTP, and the runtime now caches its prompt prefix. Two things had to change
 * together for that to be charged correctly:
 *
 * 1. The heartbeat and checkpoint routes have to READ `cacheWriteTokens`. A
 *    field the route drops is a field the service never sees, however right
 *    `pricing.ts` is.
 * 2. A cache write costs 1.25x input, so a cold turn must charge MORE than the
 *    same tokens with nothing cached — not the same, which is what happened
 *    while writes were folded into plain input.
 *
 * These drive the service directly; the route-level half is covered end to end
 * by `e2e/worker-run-usage`.
 */
import process from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VOCION_TOOL_SIGNING_SECRET ??= 'test-signing-secret';
process.env.VOCION_EXTERNAL_WORKERS = '1';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema, eventLogSchema, workerRunSchema } = await import('@/models/Schema');
const svc = await import('@/services/WorkerRunService');
const { getBudget } = await import('@/services/BudgetService');

const ORG = 'org_prompt_cache';
const AGENT = 'ingestion';
/** Priced in `libs/pricing.ts`, so a charge is non-zero and comparable. */
const MODEL = 'claude-sonnet-4-6';

/**
 * A claimed run, ready to heartbeat against.
 */
async function claimedRun(): Promise<number> {
  const run = await svc.createWorkerRun({ orgId: ORG, agentSlug: AGENT, input: { message: 'go' } });
  await svc.claimWorkerRun({ orgId: ORG, id: run.id, workerId: 'w' });
  return run.id;
}

/** Micro-cents charged to this agent so far today. */
async function spentMicroCents(): Promise<number> {
  const budget = await getBudget({ orgId: ORG, agentSlug: AGENT });
  return budget?.currentMicroCents ?? 0;
}

beforeEach(async () => {
  await db.delete(workerRunSchema);
  await db.delete(eventLogSchema);
  await db.delete(agentBudgetSchema);
});

describe('a worker that reports a cache write', () => {
  it('charges more than the same turn with nothing cached', async () => {
    const cold = await claimedRun();
    await svc.heartbeatWorkerRun({
      orgId: ORG,
      id: cold,
      workerId: 'w',
      usage: { model: MODEL, inputTokens: 10_000, outputTokens: 500, cacheWriteTokens: 8_000 },
    });
    const withWrite = await spentMicroCents();

    await db.delete(agentBudgetSchema);

    const plain = await claimedRun();
    await svc.heartbeatWorkerRun({
      orgId: ORG,
      id: plain,
      workerId: 'w',
      usage: { model: MODEL, inputTokens: 10_000, outputTokens: 500 },
    });
    const withoutWrite = await spentMicroCents();

    expect(withWrite).toBeGreaterThan(withoutWrite);
  });
});

describe('a worker that reports a cache read', () => {
  it('charges less than the same turn with nothing cached — the whole point', async () => {
    const warm = await claimedRun();
    await svc.heartbeatWorkerRun({
      orgId: ORG,
      id: warm,
      workerId: 'w',
      usage: { model: MODEL, inputTokens: 10_000, outputTokens: 500, cacheReadTokens: 8_000 },
    });
    const withRead = await spentMicroCents();

    await db.delete(agentBudgetSchema);

    const plain = await claimedRun();
    await svc.heartbeatWorkerRun({
      orgId: ORG,
      id: plain,
      workerId: 'w',
      usage: { model: MODEL, inputTokens: 10_000, outputTokens: 500 },
    });
    const withoutRead = await spentMicroCents();

    expect(withRead).toBeLessThan(withoutRead);
  });

  it('still counts the cached tokens against the token cap', async () => {
    // A cached token is one the model read, so the simpler token counter has
    // to see it. Only the MONEY changes when a prefix is cached.
    const id = await claimedRun();
    const hb = await svc.heartbeatWorkerRun({
      orgId: ORG,
      id,
      workerId: 'w',
      usage: { model: MODEL, inputTokens: 10_000, outputTokens: 500, cacheReadTokens: 8_000 },
    });

    expect(hb.run.tokens).toBe(10_500);
  });
});
