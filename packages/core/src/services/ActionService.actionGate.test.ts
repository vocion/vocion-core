import type { Principal } from '@/services/authz';
/**
 * A declared action gate inside `proposeAction`, against PGlite: an agent's
 * draft with a serious finding goes back to it once (nothing queued, the
 * return on the ledger), the revision with the same finding waits for a
 * person whatever the trust ladder says, a clean draft goes on as before, and
 * a person's own word runs with the finding as advice. The critic is
 * scripted; the ledger, the counting and the routing are real.
 */
import type { ActionGateDeps, CriticChoice, DeclaredGate } from '@/services/gates/actionGate';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const GATE: DeclaredGate = { name: 'red-team', label: 'Red team', plugin: 'red-team', actions: ['test.publish'], critic: { vendor: 'different' }, returns: 1 };
const OPENAI: CriticChoice = { provider: 'openai', vendor: 'openai', model: 'gpt-4o' };
const ANTHROPIC: CriticChoice = { provider: 'anthropic', vendor: 'anthropic', model: 'claude-sonnet-5-5' };
const SERIOUS = '{"findings":[{"severity":"serious","rule":"fact","quote":"ships Friday","why":"The release calendar says the 14th.","fix":"Say the 14th."}]}';

const critic = vi.hoisted(() => ({ answer: '{"findings":[]}', asked: [] as Array<{ model: string }> }));

vi.mock('@/libs/DB');
vi.mock('@/services/gates/actionGateRun', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/gates/actionGateRun')>();
  const { gateOutcome, runActionGates } = await import('@/services/gates/actionGate');
  return {
    ...real,
    // The real gate, with a scripted critic and the real ledger behind it.
    gateProposal: async (opts: Parameters<typeof real.gateProposal>[0]) => {
      if (opts.action.id !== 'test.publish') {
        return null;
      }
      const deps: ActionGateDeps = {
        ...real.realActionGateDeps(opts),
        author: async () => 'anthropic',
        candidates: async () => [ANTHROPIC, OPENAI],
        text: async () => String(opts.parsed.text),
        voice: async () => ({ rules: null, text: '' }),
        facts: async () => [],
        rubric: async () => null,
        critique: async (choice) => {
          critic.asked.push({ model: choice.model });
          return critic.answer;
        },
      };
      return gateOutcome(await runActionGates({ gates: [GATE], actionLabel: opts.action.name, onPersonsWord: opts.onPersonsWord }, deps));
    },
  };
});

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, projectSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { ActionError, proposeAction } = await import('@/services/ActionService');
const { gatesForWorkspace, GATE_DECIDER_PREFIX } = await import('@/services/gates/actionGateRun');

let published: string[] = [];
registerAction({
  id: 'test.publish',
  name: 'Publish a note',
  description: 'test',
  inputSchema: z.object({ to: z.string(), text: z.string() }),
  grant: 'test_publish',
  external: true,
  dedupKeyFor: input => `test.publish:${(input as { to: string }).to}`,
  execute: async (_ctx, input) => {
    published.push((input as { text: string }).text);
    return { published: true };
  },
});

const ORG = 'proj_northwind_gate';
const AGENT: Principal = { kind: 'agent', id: 'agent:account-director', grants: ['test_publish'], autonomy: 2, scope: { orgId: ORG } };
const PERSON: Principal = { kind: 'user', id: 'usr-lili', role: 'admin', scope: { orgId: ORG } } as Principal;

const propose = (principal: Principal, text: string, confidence = 0.99) => proposeAction({
  orgId: ORG,
  actionId: 'test.publish',
  input: { to: 'ops@kestrel.example', text },
  principal,
  invokedBy: principal.id,
  proposal: { confidence, rationale: 'client update', agentSlug: 'account-director', suggestedDecision: 'approve', suggestedDecisionReason: 'Weekly update is due.' },
});

/** An earned rule: this kind runs on its own above 0.5. */
async function earned() {
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'test.publish', threshold: 0.5, enabled: 'true' });
  await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: 'test.publish', rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.5, source: 'trust.yaml' });
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  critic.answer = '{"findings":[]}';
  critic.asked = [];
  published = [];
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('a declared gate in proposeAction', () => {
  it('returns an agent\'s draft with a serious finding to it once: nothing queued, nothing sent, the return on the ledger', async () => {
    critic.answer = SERIOUS;

    const refusal = await propose(AGENT, 'The new plan ships Friday.').catch(e => e);

    expect(refusal).toBeInstanceOf(ActionError);
    expect(refusal.code).toBe('RETURNED_FOR_REVISION');
    expect(refusal.message).toContain('"ships Friday"');
    expect(refusal.message).toContain('gpt-4o');
    expect(critic.asked).toEqual([{ model: 'gpt-4o' }]);
    expect(published).toEqual([]);

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'rejected', decidedBy: `${GATE_DECIDER_PREFIX}red-team` });
    expect((runs[0]!.proposal as { gates: Array<{ verdict: string }> }).gates[0]!.verdict).toBe('return');
  });

  it('sends the revision to a person when the finding still stands — the trust ladder cannot release it', async () => {
    await earned();
    critic.answer = SERIOUS;
    await propose(AGENT, 'The new plan ships Friday.').catch(() => undefined);

    const second = await propose(AGENT, 'Reminder: the new plan ships Friday.');

    expect(second.status).toBe('pending');
    expect(published).toEqual([]);

    const [pending] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.status, 'pending')));
    const gates = (pending!.proposal as { gates: Array<{ verdict: string; priorReturns: number }> }).gates;

    expect(gates[0]).toMatchObject({ verdict: 'escalate', priorReturns: 1 });
  });

  it('lets a clean draft go on exactly as it would have, with the reading on its record', async () => {
    const res = await propose(AGENT, 'The new plan ships on the 14th.');

    expect(res.status).toBe('pending');

    // And under a rule it earned, it runs on its own as it always did.
    await earned();
    const ran = await proposeAction({ orgId: ORG, actionId: 'test.publish', input: { to: 'team@acme.example', text: 'The new plan ships on the 14th.' }, principal: AGENT, invokedBy: AGENT.id, proposal: { confidence: 0.99, rationale: 'update', agentSlug: 'account-director', suggestedDecision: 'approve', suggestedDecisionReason: 'Due.' } });

    expect(ran.status).toBe('done');
    expect(published).toEqual(['The new plan ships on the 14th.']);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, res.runId));

    expect((run!.proposal as { gates: Array<{ verdict: string; critic: { vendor: string } }> }).gates[0]).toMatchObject({ verdict: 'pass', critic: { vendor: 'openai' } });
  });

  it('runs the person\'s own word, with the finding as advice', async () => {
    critic.answer = SERIOUS;

    const res = await propose(PERSON, 'The new plan ships Friday.');

    expect(res.status).toBe('done');
    expect(published).toEqual(['The new plan ships Friday.']);
    expect(res.advice).toHaveLength(1);
    expect(res.advice![0]).toContain('"ships Friday"');
    expect(res.advice![0]).toContain('went out as the person asked');
  });
});

describe('which gates a workspace has on', () => {
  it('reads the red-team plugin\'s gate for the actions it names, only where the plugin is on', async () => {
    await db.delete(projectSchema);
    await db.delete(tenantAccountSchema);
    await db.insert(tenantAccountSchema).values({ id: 'acct-gate', name: 'Northwind', slug: 'northwind-gate' });
    await db.insert(projectSchema).values([
      { id: ORG, accountId: 'acct-gate', slug: 'northwind-gate', name: 'Northwind', enabledPlugins: ['red-team'] },
      { id: 'proj_kestrel_gate', accountId: 'acct-gate', slug: 'kestrel-gate', name: 'Kestrel Capital', enabledPlugins: ['wiki'] },
    ]);

    const gates = await gatesForWorkspace(ORG, ['gmail.send']);

    expect(gates.map(g => `${g.plugin}/${g.name}`)).toEqual(['red-team/red-team']);
    expect(gates[0]!.critic.vendor).toBe('different');
    expect(gates[0]!.returns).toBe(1);
    expect(await gatesForWorkspace(ORG, ['hubspot.update'])).toEqual([]);
    expect(await gatesForWorkspace('proj_kestrel_gate', ['gmail.send'])).toEqual([]);
    expect(await gatesForWorkspace('proj_nobody', ['gmail.send'])).toEqual([]);
  });
});
