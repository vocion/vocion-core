import { describe, expect, it, vi } from 'vitest';

const permanentRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ permanentRedirect }));

const { default: PluginsRedirect } = await import('./page');

describe('/dashboard/plugins', () => {
  it('308s to /dashboard/marketplace — the plugin catalogue is a section of it now, and the old path is in links people already sent', () => {
    expect(() => PluginsRedirect()).toThrow(/NEXT_REDIRECT:\/dashboard\/marketplace/);
    expect(permanentRedirect).toHaveBeenCalledWith('/dashboard/marketplace');
  });
});
