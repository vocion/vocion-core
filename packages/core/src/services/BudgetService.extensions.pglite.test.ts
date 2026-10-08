/**
 * BudgetService's two extension seams (`libs/extensions.ts`), against a real
 * database: a budget guard is asked only after every core cap has passed, so a
 * workspace's own cap is the one named when both would refuse; its refusal
 * carries its own words; a guard that throws refuses nothing. A charge
 * observer hears every charge after it commits, and its failure never fails
 * the charge.
 */
import type { BudgetGuard, ChargeObserver } from '@/libs/extensions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seams = vi.hoisted(() => ({ guards: [] as BudgetGuard[], observers: [] as ChargeObserver[] }));

vi.mock('@vocion/enterprise/index', () => ({
  extensions: [{
    name: 'test-budget',
    get budgetGuards() {
      return seams.guards;
    },
    get chargeObservers() {
      return seams.observers;
    },
  }],
}));
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentBudgetSchema } = await import('@/models/Schema');
const { chargeUsage, ORG_SCOPE_SLUG, preflightCheck, setLimits } = await import('@/services/BudgetService');

const ORG = 'org_budget_ext_test';
const AGENT = 'deal-lead';
/** One dollar per million input tokens. */
const CHAT_MODEL = 'claude-haiku-4-5-20251001';
const MESSAGE = 'This Org has reached the monthly cap its provider set.';

const refusing: BudgetGuard = async () => ({ source: 'test:cap', reason: 'hard_cents_exceeded', limit: 500, current: 612, message: MESSAGE });

beforeEach(async () => {
  seams.guards = [];
  seams.observers = [];
  await db.delete(agentBudgetSchema);
});

afterEach(async () => {
  await db.delete(agentBudgetSchema);
});

describe('an extension\'s budget guard', () => {
  it('refuses in its own words once core\'s caps have passed, with what it was asked', async () => {
    const guard = vi.fn(refusing);
    seams.guards = [guard];

    const check = await preflightCheck({ orgId: ORG, agentSlug: AGENT });

    expect(guard).toHaveBeenCalledWith({ orgId: ORG, agentSlug: AGENT, feature: undefined });
    expect(check).toEqual({ ok: false, scope: 'extension', agentSlug: 'test:cap', reason: 'hard_cents_exceeded', limit: 500, current: 612, limitFrom: 'own', message: MESSAGE });
  });

  it('is not asked when a workspace cap already refused, so the workspace\'s cap is the one named', async () => {
    const guard = vi.fn(refusing);
    seams.guards = [guard];
    await setLimits({ orgId: ORG, agentSlug: ORG_SCOPE_SLUG, hardCentsLimit: 50 });
    await chargeUsage({ orgId: ORG, agentSlug: AGENT, model: CHAT_MODEL, usage: { inputTokens: 1_000_000 } });

    const check = await preflightCheck({ orgId: ORG, agentSlug: AGENT });

    expect(check).toMatchObject({ ok: false, scope: 'org', agentSlug: ORG_SCOPE_SLUG });
    expect(check.ok ? null : check.message).toBeUndefined();
    expect(guard).not.toHaveBeenCalled();
  });

  it('lets the call through when it returns null, and the first refusal wins over later guards', async () => {
    seams.guards = [async () => null];

    expect(await preflightCheck({ orgId: ORG, feature: 'retrieval.embed' })).toEqual({ ok: true });

    const later = vi.fn(refusing);
    seams.guards = [refusing, later];

    expect(await preflightCheck({ orgId: ORG })).toMatchObject({ ok: false, scope: 'extension' });
    expect(later).not.toHaveBeenCalled();
  });

  it('refuses nothing when it throws: a broken extension does not stop the installation', async () => {
    seams.guards = [async () => {
      throw new Error('cap store unreachable');
    }];

    expect(await preflightCheck({ orgId: ORG, agentSlug: AGENT })).toEqual({ ok: true });
  });
});

describe('an extension\'s charge observer', () => {
  it('hears each charge after it is recorded, in tokens and micro-cents', async () => {
    const seen: Array<{ committed: number; event: Parameters<ChargeObserver>[0] }> = [];
    seams.observers = [async (event) => {
      const rows = await db.select().from(agentBudgetSchema);
      seen.push({ committed: rows.length, event });
    }];

    await chargeUsage({ orgId: ORG, agentSlug: AGENT, model: CHAT_MODEL, usage: { inputTokens: 1_000_000 } });

    expect(seen).toHaveLength(1);
    // The agent's row and the workspace's row were written before it was told.
    expect(seen[0]!.committed).toBe(2);
    expect(seen[0]!.event).toMatchObject({ orgId: ORG, agentSlug: AGENT, tokens: 1_000_000, microCents: 100_000_000 });
    expect(seen[0]!.event.at).toBeInstanceOf(Date);
  });

  it('is not told about a call that cost nothing, and its failure never fails the charge', async () => {
    const quiet = vi.fn(async () => {});
    seams.observers = [quiet];

    await chargeUsage({ orgId: ORG, agentSlug: AGENT, model: CHAT_MODEL, usage: { inputTokens: 0 } });

    expect(quiet).not.toHaveBeenCalled();

    const after = vi.fn(async () => {});
    seams.observers = [async () => {
      throw new Error('ledger down');
    }, after];

    await expect(chargeUsage({ orgId: ORG, agentSlug: AGENT, model: CHAT_MODEL, usage: { inputTokens: 1_000 } })).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledOnce();
  });
});
