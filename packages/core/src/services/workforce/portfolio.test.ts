import type { PortfolioCommand } from './portfolioContract';
import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { recordWorkforceCommand } = await import('./ledger');
const { readPortfolioHistory, readWorkforcePortfolio, saveWorkforcePortfolio: save } = await import('./portfolio');
const org = 'portfolio-a';
const other = 'portfolio-b';
const draft = (): PortfolioCommand => ({ id: randomUUID(), eventKey: randomUUID(), version: -1, itemIds: [], data: { name: 'Invoice classification', owner: '', objective: '', baseline: '', expectedBenefit: '', successMeasure: '', teamSlug: null, stage: 'discovery', improvements: [] } });
async function item(orgId: string, test = false) {
  return recordWorkforceCommand(orgId, 'admin', { kind: 'create', eventKey: randomUUID(), key: randomUUID(), title: 'Invoice', agentSlug: 'analyst', workflow: 'human-assisted', rubric: 'Matches source', configurationVersion: 'test', test });
}

beforeAll(async () => {
  await db.insert(agentSchema).values([org, other].map(orgId => ({ orgId, slug: 'analyst', name: 'Analyst', systemPrompt: 'Test' })));
});

it('persists workflows without inventing impact, replays safely and retains immutable revisions', async () => {
  const command = draft();
  const result = await save(org, 'admin', command);

  expect(result.version).toBe(0);
  expect(await save(org, 'admin', command)).toEqual(result);
  await expect(save(org, 'another-actor', command)).rejects.toMatchObject({ status: 409 });
  await expect(save(org, 'admin', { ...command, data: { ...command.data, owner: 'Changed' } })).rejects.toMatchObject({ status: 409 });

  await save(org, 'admin', { ...command, eventKey: randomUUID(), version: 0, data: { ...command.data, owner: 'Finance owner', stage: 'pilot' } });

  const history = await readPortfolioHistory(org, command.id);

  expect(history.map(h => h.version)).toEqual([1, 0]);
  expect(history[1]?.data.data.owner).toBe('');
  expect((await readWorkforcePortfolio(org)).workflows.find(w => w.id === command.id)?.data.owner).toBe('Finance owner');
  await expect(save(org, 'admin', { ...command, eventKey: randomUUID(), version: 0 })).rejects.toMatchObject({ status: 409 });
});

it('rejects foreign and synthetic items, foreign teams and foreign workflow updates', async () => {
  const foreign = await item(other);
  const synthetic = await item(org, true);
  const command = draft();
  await save(org, 'admin', command);

  await expect(save(org, 'admin', { ...draft(), itemIds: [foreign.itemId] })).rejects.toMatchObject({ status: 404 });
  await expect(save(org, 'admin', { ...draft(), itemIds: [synthetic.itemId] })).rejects.toMatchObject({ status: 404 });
  await expect(save(other, 'admin', { ...command, version: 0, eventKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
  await expect(save(org, 'admin', { ...draft(), data: { ...command.data, teamSlug: 'foreign-team' } })).rejects.toMatchObject({ status: 404 });
  await expect(save(other, 'admin', { ...command, eventKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
  expect(await readPortfolioHistory(other, command.id)).toEqual([]);
  expect((await readWorkforcePortfolio(other)).workflows).toEqual([]);
});

it('prevents double-counting an item across workflows and leaves failed writes atomic', async () => {
  const source = await item(org);
  const command = { ...draft(), itemIds: [source.itemId] };
  await save(org, 'admin', command);
  const duplicate = { ...draft(), itemIds: [source.itemId] };

  await expect(save(org, 'admin', duplicate)).rejects.toMatchObject({ status: 409 });
  expect((await readWorkforcePortfolio(org)).workflows.some(w => w.id === duplicate.id)).toBe(false);
  await expect(save(org, 'admin', { ...draft(), itemIds: [source.itemId, source.itemId] })).rejects.toMatchObject({ status: 400 });
});

it('preserves improvement identities and requires follow-up evidence to close', async () => {
  const command = draft();
  const improvement = { id: randomUUID(), title: 'Better rubric', owner: 'Finance owner', hypothesis: 'Reduce corrections', baseline: '3 of 5 corrected', successMeasure: 'Same five cases, independent reviewer', followUp: '2026-11-06', status: 'planned' as const, decision: 'unproven' as const, result: '' };
  command.data.improvements = [improvement];
  await save(org, 'admin', command);
  const update = { ...command, eventKey: randomUUID(), version: 0 };

  await expect(save(org, 'admin', { ...update, data: { ...command.data, improvements: [] } })).rejects.toMatchObject({ status: 400 });
  await expect(save(org, 'admin', { ...update, data: { ...command.data, improvements: [{ ...improvement, status: 'closed' }] } })).rejects.toMatchObject({ status: 400 });

  await save(org, 'admin', { ...update, data: { ...command.data, improvements: [{ ...improvement, status: 'closed', result: 'Two corrections remain; independent review pending', decision: 'revise' }] } });

  expect((await readPortfolioHistory(org, command.id))[0]?.data.data.improvements[0]?.decision).toBe('revise');
});
