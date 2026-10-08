/**
 * Attachment uploads count against the same per-person chat limit as turns:
 * past thirty in a minute, an upload is a 429 with `Retry-After`, refused
 * before the files are read or stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/tools/artifacts/store', () => ({ saveArtifact: vi.fn() }));

const { clerkAuth } = await import('@/libs/Auth');
const { saveArtifact } = await import('@/libs/tools/artifacts/store');
const { hit, RATE_LIMITS, resetMemoryRateLimits } = await import('@/libs/rateLimit');
const { POST } = await import('./route');

function upload(ip: string) {
  const form = new FormData();
  form.append('file', new Blob(['Kestrel renewal notes'], { type: 'text/plain' }), 'notes.txt');
  return new Request('https://app.northwind.example/api/chat/attachments', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: form });
}

beforeEach(() => {
  resetMemoryRateLimits();
  vi.mocked(saveArtifact).mockClear();
  vi.mocked(clerkAuth).mockResolvedValue({ userId: 'usr-sam', orgId: 'proj-ops', accountId: 'acct-northwind', projectId: 'proj-ops', role: 'member', workspaceRole: 'member', has: () => true });
});

describe('POST /api/chat/attachments limits', () => {
  it('refuses the 31st upload or turn in a minute with a 429 and Retry-After, storing nothing', async () => {
    for (let i = 0; i < RATE_LIMITS.chatPerUser.limit; i++) {
      await hit(RATE_LIMITS.chatPerUser, 'usr-sam');
    }

    const res = await POST(upload('198.51.100.4'));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(saveArtifact).not.toHaveBeenCalled();
  });
});
