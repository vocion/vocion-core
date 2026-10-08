/**
 * Dropbox and Box against recorded answers: each resolves its token the three
 * ways a workspace can connect, walks its folder, reads text and PDFs whole
 * and indexes everything else by name and path, downloads only what changed
 * on an incremental run, and keeps every agent read inside the source's
 * folder. Invented folders and files.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Env', () => ({ Env: {} }));

const { dropboxConnector, normalizeDropboxPath, resolveDropboxToken } = await import('./dropbox');
const { boxConnector, resolveBoxToken } = await import('./box');
const { dropboxFilesProvider } = await import('@/services/files/providers/dropbox');
const { boxFilesProvider } = await import('@/services/files/providers/box');

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function vendor(route: (call: Call) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = { url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: typeof init.body === 'string' ? init.body : '' };
    calls.push(call);
    const answer = route(call);
    return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), { status: 200 });
  }));
  return calls;
}

async function collect(docs: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of docs) {
    out.push(d);
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dropbox', () => {
  it('uses a pasted access token as it is, and trades a refresh token with its app key and secret', async () => {
    await expect(resolveDropboxToken({ token: 'sl.short' }, { kind: 'never' })).resolves.toBe('sl.short');

    const calls = vendor(() => ({ access_token: 'sl.fresh', expires_in: 14_400 }));

    await expect(resolveDropboxToken({ token: 'refresh-1', appKey: 'key-1', appSecret: 'secret-1' }, { kind: 'never' })).resolves.toBe('sl.fresh');

    const form = new URLSearchParams(calls[0]!.body);

    expect(calls[0]!.url).toBe('https://api.dropboxapi.com/oauth2/token');
    expect(Object.fromEntries(form)).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: 'key-1', client_secret: 'secret-1' });
    await expect(resolveDropboxToken({}, { kind: 'never' })).rejects.toThrow(/No Dropbox token/);
  });

  it('walks the folder, reads text whole, indexes the rest by name, and skips unchanged files on an incremental run', async () => {
    const since = new Date('2026-10-01T00:00:00Z');
    const calls = vendor((call) => {
      if (call.url.endsWith('/files/list_folder')) {
        return { entries: [
          { '.tag': 'folder', 'name': 'Contracts', 'path_display': '/Northwind/Contracts' },
          { '.tag': 'file', 'id': 'id:a1', 'name': 'MSA notes.md', 'path_display': '/Northwind/Contracts/MSA notes.md', 'path_lower': '/northwind/contracts/msa notes.md', 'server_modified': '2026-10-05T00:00:00Z', 'size': 20, 'rev': 'r1' },
          { '.tag': 'file', 'id': 'id:a2', 'name': 'kickoff.mp4', 'path_display': '/Northwind/kickoff.mp4', 'server_modified': '2026-10-06T00:00:00Z', 'size': 9_000_000_000 },
        ], cursor: 'cur1', has_more: true };
      }
      if (call.url.endsWith('/list_folder/continue')) {
        return { entries: [{ '.tag': 'file', 'id': 'id:a3', 'name': 'old.txt', 'path_display': '/Northwind/old.txt', 'server_modified': '2026-09-01T00:00:00Z', 'size': 5 }], has_more: false };
      }
      return '# MSA\nRenewal is in March.';
    });
    const ctx: SourceContext = { sourceId: 8, orgId: 'org_1', config: { path: 'Northwind' }, credentials: { token: 'sl.short' }, since };

    const docs = await collect(dropboxConnector.sync(ctx));

    expect(docs.map(d => d.externalId)).toEqual(['dropbox:id:a1', 'dropbox:id:a2']);
    expect(docs[0]).toMatchObject({ title: 'MSA notes.md', etag: 'r1', uri: 'https://www.dropbox.com/home/Northwind/Contracts?preview=MSA%20notes.md', metadata: { read: true } });
    expect(docs[0]!.content).toContain('Renewal is in March.');
    expect(docs[1]).toMatchObject({ content: '/Northwind/kickoff.mp4', metadata: { read: false } });
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ path: '/Northwind', recursive: true });

    const download = calls.find(c => c.url.endsWith('/files/download'))!;

    expect(download.headers['dropbox-api-arg']).toBe('{"path":"id:a1"}');
    expect(calls.filter(c => c.url.endsWith('/files/download'))).toHaveLength(1);
    expect(normalizeDropboxPath('/')).toBe('');
  });

  it('keeps an agent\'s read inside the source\'s folder', async () => {
    vendor((call) => {
      if (call.url.endsWith('/files/get_metadata')) {
        return JSON.parse(call.body).path === '/HR/salaries.csv'
          ? { '.tag': 'file', 'id': 'id:z', 'name': 'salaries.csv', 'path_display': '/HR/salaries.csv', 'path_lower': '/hr/salaries.csv' }
          : { '.tag': 'file', 'id': 'id:a1', 'name': 'notes.md', 'path_display': '/Northwind/notes.md', 'path_lower': '/northwind/notes.md', 'size': 10 };
      }
      return 'Kickoff is Tuesday.';
    });
    const provider = await dropboxFilesProvider('org_1', { id: 8, slug: 'dropbox', kind: 'dropbox', config: { path: '/Northwind' }, apiTokenId: null }, { token: 'sl.short' });

    await expect(provider.read('/Northwind/notes.md')).resolves.toMatchObject({ name: 'notes.md', text: 'Kickoff is Tuesday.', note: null });
    await expect(provider.read('/HR/salaries.csv')).rejects.toThrow(/outside \/Northwind/);
    await expect(provider.list('/HR')).rejects.toThrow(/outside \/Northwind/);
  });
});

describe('box', () => {
  it('mints a token with client credentials as the enterprise, or uses a developer token', async () => {
    const calls = vendor(() => ({ access_token: 'box-ccg' }));

    await expect(resolveBoxToken({ clientId: 'cid', clientSecret: 'cs', enterpriseId: '4411' }, { kind: 'never' })).resolves.toBe('box-ccg');
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({ grant_type: 'client_credentials', client_id: 'cid', client_secret: 'cs', box_subject_type: 'enterprise', box_subject_id: '4411' });
    await expect(resolveBoxToken({ clientId: 'cid', clientSecret: 'cs', developerToken: 'dev-1' }, { kind: 'never' })).resolves.toBe('dev-1');
    await expect(resolveBoxToken({ clientId: 'cid', clientSecret: 'cs' }, { kind: 'never' })).rejects.toThrow(/enterprise ID/);
  });

  it('walks folders breadth-first, carrying the path, and reads text whole', async () => {
    const calls = vendor((call) => {
      if (call.url.includes('/folders/0/items')) {
        return { entries: [{ type: 'folder', id: '11', name: 'Northwind' }, { type: 'file', id: '21', name: 'readme.txt', size: 10, sha1: 'h1', modified_at: '2026-10-05T00:00:00Z' }] };
      }
      if (call.url.includes('/folders/11/items')) {
        return { entries: [{ type: 'file', id: '22', name: 'deck.key', size: 10 }] };
      }
      return 'Hello from Box.';
    });

    const docs = await collect(boxConnector.sync({ sourceId: 9, orgId: 'org_1', config: {}, credentials: { clientId: 'c', clientSecret: 's', developerToken: 'dev-1' } }));

    expect(docs.map(d => [d.externalId, d.metadata?.path, d.metadata?.read])).toEqual([['box:21', '/readme.txt', true], ['box:22', '/Northwind/deck.key', false]]);
    expect(docs[0]).toMatchObject({ uri: 'https://app.box.com/file/21', etag: 'h1', content: '/readme.txt\n\nHello from Box.' });
    expect(calls.every(c => c.headers.authorization === 'Bearer dev-1')).toBe(true);
  });

  it('keeps an agent\'s read inside the source\'s folder', async () => {
    vendor((call) => {
      if (call.url.includes('/files/31?')) {
        return { type: 'file', id: '31', name: 'plan.md', size: 10, path_collection: { entries: [{ id: '0', name: 'All Files' }, { id: '11', name: 'Northwind' }] } };
      }
      if (call.url.includes('/files/32?')) {
        return { type: 'file', id: '32', name: 'payroll.csv', size: 10, path_collection: { entries: [{ id: '0', name: 'All Files' }, { id: '99', name: 'HR' }] } };
      }
      return 'The plan.';
    });
    const provider = await boxFilesProvider('org_1', { id: 9, slug: 'box', kind: 'box', config: { folderId: '11' }, apiTokenId: null }, { clientId: 'c', clientSecret: 's', developerToken: 'dev-1' });

    await expect(provider.read('31')).resolves.toMatchObject({ path: '/Northwind/plan.md', text: 'The plan.' });
    await expect(provider.read('32')).rejects.toThrow(/outside the folder/);
  });
});
