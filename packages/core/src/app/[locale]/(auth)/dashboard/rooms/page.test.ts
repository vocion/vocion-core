import { describe, expect, it, vi } from 'vitest';

const permanentRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ permanentRedirect }));

const { default: RoomsRedirect } = await import('./page');
const { default: RoomRedirect } = await import('./[id]/page');

describe('/dashboard/rooms (projects were data rooms until 2026-10-27)', () => {
  it('308s the list to /dashboard/projects', () => {
    expect(() => RoomsRedirect()).toThrow(/NEXT_REDIRECT:\/dashboard\/projects$/);
  });

  it('308s one room to the same project', async () => {
    await expect(RoomRedirect({ params: Promise.resolve({ id: '42' }) })).rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/projects\/42$/);
  });
});
