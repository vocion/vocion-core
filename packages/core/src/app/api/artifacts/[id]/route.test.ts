import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { createArtifact } = await import('@/services/ArtifactService');
const { saveArtifact } = await import('@/libs/tools/artifacts/store');
const { GET: getById } = await import('./route');
const { GET: getByName } = await import('./[filename]/route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_art_a';
const OTHER = 'org_art_b';
let dir: string;
let saved: Awaited<ReturnType<typeof saveArtifact>>;

function session(orgId: string) {
  mockSession.mockResolvedValue({ userId: 'usr-1', orgId, role: 'member' } as never);
}
function req(url: string, bearer?: string) {
  return new NextRequest(`http://localhost${url}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vocion-artifacts-'));
  process.env.VOCION_ARTIFACTS_DIR = dir;
  delete process.env.VOCION_ARTIFACTS_URL_BASE;
  saved = await saveArtifact({ orgId: ORG, data: 'a,b\n1,2\n', ext: 'csv', contentType: 'text/csv' });
});

beforeEach(() => {
  mockBearer.mockReset();
  mockSession.mockReset();
});

afterAll(() => {
  delete process.env.VOCION_ARTIFACTS_DIR;
});

describe('GET /api/artifacts', () => {
  it('saveArtifact returns the authenticated route, not a public path', () => {
    expect(saved.url).toBe(`/api/artifacts/${saved.id}/${saved.filename}`);
    expect(saved.url.startsWith('/artifacts/')).toBe(false);
  });

  it('serves a legacy content-addressed file to its own org with the right type, privately', async () => {
    session(ORG);
    const res = await getByName(req(saved.url), { params: Promise.resolve({ id: saved.id, filename: saved.filename }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('cache-control')).toMatch(/private/);
    expect(await res.text()).toBe('a,b\n1,2\n');
  });

  it('resolves a legacy id without a filename by scanning the directory', async () => {
    session(ORG);
    const res = await getById(req(`/api/artifacts/${saved.id}`), { params: Promise.resolve({ id: saved.id }) });

    expect(res.status).toBe(200);
  });

  it('is a 404 for another org — by session and by token', async () => {
    session(OTHER);
    const a = await getByName(req(saved.url), { params: Promise.resolve({ id: saved.id, filename: saved.filename }) });

    expect(a.status).toBe(404);

    mockSession.mockReset();
    mockBearer.mockResolvedValue({ orgId: OTHER, tokenId: 't1', principal: { kind: 'token', id: 't1', role: 'member', workspaceRole: 'owner' as const, scope: { orgId: OTHER } } } as never);
    const b = await getByName(req(saved.url, 'vcn_live_x'), { params: Promise.resolve({ id: saved.id, filename: saved.filename }) });

    expect(b.status).toBe(404);
  });

  it('is a 401 with no credentials and a 404 for a mismatched filename or a traversal attempt', async () => {
    mockSession.mockResolvedValue({ userId: null, orgId: null } as never);
    const anon = await getById(req(`/api/artifacts/${saved.id}`), { params: Promise.resolve({ id: saved.id }) });

    expect(anon.status).toBe(401);

    session(ORG);
    const wrong = await getByName(req('/x'), { params: Promise.resolve({ id: saved.id, filename: `${ORG}-deadbeef.csv` }) });

    expect(wrong.status).toBe(404);

    const trav = await getByName(req('/x'), { params: Promise.resolve({ id: saved.id, filename: '../../etc/passwd' }) });

    expect(trav.status).toBe(404);
  });

  it('returns a card artifact as JSON (no file behind it) and 404s it for another org', async () => {
    const { artifact: row } = await createArtifact({ orgId: ORG, kind: 'markdown', title: 'Plan', spec: { md: '- call Acme' }, author: { kind: 'agent', id: 'agent:revenue-lead' } });
    session(ORG);
    const ok = await getById(req(`/api/artifacts/${row.id}`), { params: Promise.resolve({ id: String(row.id) }) });

    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/json/);
    expect(await ok.json()).toMatchObject({ artifact: { id: row.id, kind: 'markdown', spec: { md: '- call Acme' } } });

    session(OTHER);
    const no = await getById(req(`/api/artifacts/${row.id}`), { params: Promise.resolve({ id: String(row.id) }) });

    expect(no.status).toBe(404);
  });

  it('resolves an artifact row id to its file and 404s it for another org', async () => {
    await writeFile(path.join(dir, `${ORG}-rowfile.md`), '# brief', 'utf8');
    const { artifact: row } = await createArtifact({ orgId: ORG, kind: 'file', title: 'Revenue brief', spec: { filename: `${ORG}-rowfile.md`, contentType: 'text/markdown', bytes: 7, url: `/api/artifacts/${ORG}-rowfile/${ORG}-rowfile.md` }, url: `/api/artifacts/${ORG}-rowfile/${ORG}-rowfile.md`, author: { kind: 'agent', id: 'agent:revenue-lead' } });
    session(ORG);
    const ok = await getById(req(`/api/artifacts/${row.id}`), { params: Promise.resolve({ id: String(row.id) }) });

    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/markdown/);
    expect(ok.headers.get('content-disposition')).toContain('Revenue_brief.md');

    session(OTHER);
    const no = await getById(req(`/api/artifacts/${row.id}`), { params: Promise.resolve({ id: String(row.id) }) });

    expect(no.status).toBe(404);
  });
});
