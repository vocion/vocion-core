/**
 * A card is checked as the person who presses it (conversation 411, 2026-10-01).
 * "Fix this, now" on a production outage: the PM's revert card was refused as
 * "the pipeline's own move" because it was checked as the PM seat, though
 * pressing it proposes the revert as the person. Fictional fixtures.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Langfuse', () => ({
  createLangfuseCallback: vi.fn(() => ({ handler: {}, trace: { id: 't', update: vi.fn() } })),
  flushTraces: vi.fn(async () => {}),
}));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { realCardBackstopDeps } = await import('./cardBackstop');

const ORG = 'org_card_presser';
const REVERT = { url: 'https://github.com/northwind/relay-api/pull/88', reason: 'Every signed-in route returns 500 since this deploy.' };

describe('the card pass checks a card as the person who presses it', () => {
  it('puts up a pipeline card in a person\'s turn, and refuses it on the seat\'s own schedule', async () => {
    await db.insert(agentSchema).values({ orgId: ORG, slug: 'release-engineer', name: 'Release engineer', systemPrompt: 'x', harnessConfig: { grantTools: ['github.revert_pull'] } } as never);
    const deps = (ctx: Record<string, unknown>) => realCardBackstopDeps({ ctx: { orgId: ORG, agentSlug: 'product-manager', ...ctx } as never, orgId: ORG, agentSlug: 'product-manager', emit: () => {} });

    expect(await (await deps({ userId: 'usr_dana' })).precheck('github.revert_pull', REVERT)).toBeUndefined();
    expect(await (await deps({})).precheck('github.revert_pull', REVERT)).toMatch(/the pipeline's own move/);
    expect(await (await deps({ userId: 'usr_dana', missionRunId: 7 })).precheck('github.revert_pull', REVERT)).toMatch(/the pipeline's own move/);
  });
});
