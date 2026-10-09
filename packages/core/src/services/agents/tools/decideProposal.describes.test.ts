import { expect, it, vi } from 'vitest';

const decide = vi.fn(async () => ({ status: 'approved' }));
vi.mock('@/services/ReviewService', () => ({ decide, snooze: vi.fn() }));
// One waiting card: a build of request #41.
vi.mock('@/libs/DB', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ actionId: 'factory.dispatch_task', input: { requestId: 41 }, proposal: { rationale: 'continue the branch' } }] }) }) }) } }));
vi.mock('../consentDecision', () => ({ consentDecision: vi.fn(async () => 'Start the build (factory.dispatch_task): Start the build: Copy link on each row.') }));
const seen: string[] = [];
vi.mock('../turnJudge', () => ({
  saidToDecide: vi.fn(async ({ decision }: { decision: string }) => {
    seen.push(decision);
    return { said: decision.includes('Start the build'), quote: 'build it' };
  }),
}));

const { decideProposalTool } = await import('./decideProposal');

it('asks the consent read about what the card does, not its number (Walk 6: "build it" never names #6061)', async () => {
  const out = await decideProposalTool({ orgId: 'org', userId: 'usr-1', conversationId: 7, connectorSources: [], turnMessage: 'Build it.' } as never).invoke({ id: 6061, decision: 'approve' });

  expect(seen[0]).toContain('Start the build: Copy link on each row');
  expect(out).toContain('Approved proposal #6061');
  expect(decide).toHaveBeenCalled();
});

it('never points the model at a tool that does not exist (there is no list_proposals)', () => {
  const t = decideProposalTool({ orgId: 'org', userId: 'usr-1', conversationId: 7, connectorSources: [] } as never);
  const schema = JSON.stringify((t as unknown as { schema: { shape: { id: { description?: string } } } }).schema.shape.id.description);

  expect(schema).not.toContain('list_proposals');
  expect(schema).toContain('never guess an id');
});
