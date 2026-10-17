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

describe('an asset catalog on the drive source', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function sheetBytes(): Promise<ArrayBuffer> {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['Northwind | Asset Guide'],
      ['Asset Title', 'Asset Type', 'Funnel Stage', 'Industry / Vertical', 'Gated?', 'Page Link', 'File Link'],
      ['Construction Blueprint', 'Blueprint', 'BOFU', 'Construction', 'Yes', 'https://northwind.example/whitepapers/construction', 'https://files.northwind.example/c.pdf'],
      ['Scorecard', 'Scorecard', 'MOFU', 'All industries', 'Yes', 'Open page', ''],
      ['Crews Case Study', 'Case Study', 'MOFU', 'Construction', 'Yes', 'N/A', 'https://files.northwind.example/crews.pdf'],
    ]);
    // A label over a hyperlink: the link is what the catalog keeps.
    ws.F4!.l = { Target: 'https://northwind.example/whitepapers/scorecard' };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, 'Assets');
    const buf = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array;
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  it('reads the sheet as one document per row, config rows after, and reports what it skipped', async () => {
    const bytes = await sheetBytes();
    const checked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/files/sheet1?fields=')) {
        return new Response(JSON.stringify({ id: 'sheet1', name: 'Asset Guide.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      }
      if (url.includes('/files/sheet1?alt=media')) {
        return new Response(bytes);
      }
      if (url.includes('/files?')) {
        return new Response(JSON.stringify({ files: [] }));
      }
      checked.push(url);
      return new Response('ok', { status: url.includes('dead') ? 404 : 200 });
    }));
    const events: Array<{ kind: string; message?: string }> = [];
    const docs = [];
    for await (const doc of driveConnector.sync({
      config: {
        catalog: {
          files: [{ fileId: 'sheet1' }],
          rows: [
            { title: 'ROI Calculator', type: 'Tool', url: 'https://short.example/roi' },
            { title: 'Blueprint fallback', type: 'Blueprint', url: 'https://www.northwind.example/whitepapers/construction/' },
            { title: 'Retired page', type: 'Website Page', url: 'https://northwind.example/dead' },
          ],
        },
      },
      credentials: {},
      orgId: 'org-1',
      onProgress: (e: { kind: string; message?: string }) => events.push(e),
    } as never)) {
      docs.push(doc);
    }

    expect(docs.map(d => d.title)).toEqual(['Construction Blueprint', 'Scorecard', 'ROI Calculator', 'Retired page']);
    expect(docs[1]!.metadata).toMatchObject({ kind: 'asset', url: 'https://northwind.example/whitepapers/scorecard' });
    expect(docs.find(d => d.title === 'Retired page')!.metadata).toMatchObject({ linkOk: false, linkStatus: 404 });
    expect(docs[0]!.metadata).toMatchObject({ linkOk: true });
    expect(events.filter(e => e.kind === 'skipped').map(e => e.message)).toEqual([expect.stringMatching(/Crews Case Study.*gated, and only a file link/)]);
    expect(checked).toHaveLength(4);
  });
});
