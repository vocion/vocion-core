/**
 * Drive's file list reaches shared drives only when the source asks: Google
 * leaves them out unless the list says so, so a folder on a shared drive
 * syncs nothing without `allDrives`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./googleAuth', () => ({ resolveGoogleAccessToken: async () => 'tok' }));

const { driveConnector } = await import('./drive');

async function listUrls(config: Record<string, unknown>): Promise<string[]> {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    return url.includes('/export')
      ? new Response('Board pack text')
      : new Response(JSON.stringify({ files: [{ id: 'f1', name: 'Q3 Board Meeting', mimeType: 'application/vnd.google-apps.presentation' }] }));
  }));
  for await (const _doc of driveConnector.sync({ config, credentials: {}, orgId: 'org-1' } as never)) {
    // drain
  }
  return urls;
}

describe('drive connector', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists My Drive and shared-with-me only, by default', async () => {
    const [list] = await listUrls({});

    expect(list).not.toContain('includeItemsFromAllDrives');
  });

  it('lists and exports from shared drives with allDrives', async () => {
    const [list, exported] = await listUrls({ allDrives: true });

    expect(list).toContain('includeItemsFromAllDrives=true');
    expect(list).toContain('supportsAllDrives=true');
    expect(list).toContain('corpora=allDrives');
    expect(exported).toContain('supportsAllDrives=true');
  });
});
