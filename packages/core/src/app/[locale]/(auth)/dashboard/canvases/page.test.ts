import { describe, expect, it, vi } from 'vitest';

const permanentRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ permanentRedirect }));

const { default: CanvasesRedirect } = await import('./page');

describe('/dashboard/canvases', () => {
  it('308s to /dashboard/artifacts — the old path is in pinned nav entries and in links people already sent', () => {
    expect(() => CanvasesRedirect()).toThrow(/NEXT_REDIRECT:\/dashboard\/artifacts/);
    expect(permanentRedirect).toHaveBeenCalledWith('/dashboard/artifacts');
  });
});
