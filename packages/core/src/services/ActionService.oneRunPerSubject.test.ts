/**
 * ONE RUN PER SUBJECT — against PGlite.
 *
 * Request #224 (2026-09-29) got three build runs in 35 seconds: the intake's
 * card (5015, keyed on the request) and two cards the PM put up in chat (5016,
 * 5018, keyed on their labels' hashes), two of which executed. An action that
 * `ownsDedupKey` keys every proposal on its subject, whoever brings a key; the
 * second proposal refreshes the open run and is judged by the ladder as the
 * new proposal would have been. `internalInput` is core's alone: a model's
 * card cannot claim to be the factory's automatic start.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, trustRuleSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { DEFAULT_RISK_TIER } = await import('@/services/autonomy/rungs');
const { proposeAction } = await import('@/services/ActionService');
const { cardDedupKey } = await import('@/libs/actions/cardDedupKey');
const { eq } = await import('drizzle-orm');

const ORG = 'org_one_run_per_subject';
let executed: Array<Record<string, unknown>> = [];

registerAction({
  id: 'test.build-subject',
  name: 'Test build',
  description: 'test',
  inputSchema: z.object({ requestId: z.number(), reason: z.string().optional(), trigger: z.enum(['request']).optional() }),
  grant: 'test_write',
  external: true,
  ownsDedupKey: true,
  internalInput: ['trigger'],
  dedupKeyFor: (input) => {
    const i = input as { requestId: number; trigger?: string };
    return `test.build-subject:request-${i.requestId}${i.trigger ? ':from-request' : ''}`;
  },
  execute: async (_ctx, input) => {
    executed.push(input as Record<string, unknown>);
    return { started: true };
  },
  undo: async () => ({ ok: true }),
});
DEFAULT_RISK_TIER['test.build-subject'] = 'low';

function agent(): Principal {
  return { kind: 'agent', id: 'agent:product-manager', grants: ['test_write'], autonomy: 2, scope: { orgId: ORG } };
}

function card(input: Record<string, unknown>, label: string, confidence: number) {
  return proposeAction({
    orgId: ORG,
    actionId: 'test.build-subject',
    input,
    principal: agent(),
    invokedBy: 'usr_owner',
    proposal: { confidence, rationale: 'test', suggestedDecision: 'approve', suggestedDecisionReason: 'ready' },
    // What a chat card sends: its own label hash.
    dedupKey: cardDedupKey({ actionId: 'test.build-subject', label, input }),
  });
}

beforeEach(async () => {
  executed = [];
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('one open run per subject', () => {
  it('two cards for one request are one run: the second refreshes the first, whatever its label', async () => {
    const first = await card({ requestId: 224, reason: 'Start the build' }, 'Start the build — copy-link', 0.5);
    const second = await card({ requestId: 224, reason: 'Approve build' }, 'Approve build — copy-link on rows', 0.5);

    expect(first.status).toBe('pending');
    expect(second.runId).toBe(first.runId);
    expect(second.outcome).toBe('refreshed');

    const rows = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupKey).toBe('test.build-subject:request-224');
    expect(rows[0]!.input).toMatchObject({ reason: 'Approve build' });
  });

  it('a refreshed run the ladder would have released executes once, as the merged proposal', async () => {
    const intake = await card({ requestId: 225 }, 'Build it', 0.5);
    const pm = await card({ requestId: 225, reason: 'Patch-sized' }, 'Start the build', 0.9);

    expect(pm.runId).toBe(intake.runId);
    expect(pm.status).toBe('done');
    expect(executed).toHaveLength(1);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, intake.runId));

    expect(row!.approvedByAgent).toBe(true);
    expect(row!.proposal).toMatchObject({ autoApproved: true });
  });

  it('strips the fields only core may set from a card, so a model cannot pick the automatic trust key', async () => {
    const res = await card({ requestId: 226, trigger: 'request' }, 'Build', 0.5);
    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, res.runId));

    expect(row!.input).not.toHaveProperty('trigger');
    expect(row!.dedupKey).toBe('test.build-subject:request-226');
  });

  it('keeps them for core\'s own step', async () => {
    const res = await proposeAction({
      orgId: ORG,
      actionId: 'test.build-subject',
      input: { requestId: 227, trigger: 'request' },
      principal: agent(),
      invokedBy: 'factory:product-manager',
      internal: true,
      proposal: { confidence: 0.5, rationale: 'test', suggestedDecision: 'approve', suggestedDecisionReason: 'ready' },
    });
    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, res.runId));

    expect(row!.input).toMatchObject({ trigger: 'request' });
    expect(row!.dedupKey).toBe('test.build-subject:request-227:from-request');
  });
});
