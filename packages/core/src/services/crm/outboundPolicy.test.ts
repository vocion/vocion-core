import { describe, expect, it, vi } from 'vitest';

const read = vi.hoisted(() => vi.fn());
vi.mock('@/libs/DB', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: read }) }) }) } }));
const { assertOutboundAllowed } = await import('./outboundPolicy');

describe('outbound dry run', () => {
  it('blocks send, enrollment, and generic/CRM writes even when approved', async () => {
    read.mockResolvedValue([{ dryRun: true }]);
    for (const id of ['gmail.send', 'personalization.enroll', 'hubspot.update', 'hubspot.create', 'rest.request', 'mcp.call']) {
      await expect(assertOutboundAllowed('held', { id, grant: 'write' }, {})).rejects.toThrow('dry run');
    }

    await expect(assertOutboundAllowed('held', { id: 'future.mail', grant: 'send_email' }, {})).rejects.toThrow('dry run');
  });

  it('allows drafts but checks the changed execution input for sending', async () => {
    read.mockResolvedValue([{ dryRun: true }]);
    await assertOutboundAllowed('held', { id: 'gmail.send', grant: 'send_email' }, { draft: true });

    await expect(assertOutboundAllowed('held', { id: 'gmail.send', grant: 'send_email' }, { draft: false })).rejects.toThrow('dry run');
  });

  it('fails closed on missing workspace and database failures', async () => {
    read.mockResolvedValue([]);

    await expect(assertOutboundAllowed('missing', { id: 'gmail.send', grant: 'send_email' }, {})).rejects.toThrow();

    read.mockRejectedValue(new Error('database unavailable'));

    await expect(assertOutboundAllowed('missing', { id: 'gmail.send', grant: 'send_email' }, {})).rejects.toThrow();
  });

  it('does not block internal planning or other workspaces with live delivery', async () => {
    read.mockResolvedValue([{ dryRun: false }]);
    await assertOutboundAllowed('live', { id: 'gmail.send', grant: 'send_email' }, {});
    await assertOutboundAllowed('held', { id: 'playbook.write', grant: 'write' }, {});
  });
});
