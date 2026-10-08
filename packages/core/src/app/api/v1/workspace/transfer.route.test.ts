/**
 * `GET /api/v1/workspace/export` and `POST /api/v1/workspace/import` over
 * HTTP: workspace admins only, a zip out, a zip in as multipart, the review
 * by default and the apply only with the reviewed sha, and each refusal as the
 * standard envelope. What an export holds and what an import does is
 * `services/workspace/WorkspaceTransfer.test.ts`.
 */
import { Buffer } from 'node:buffer';
import { unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/workspace/WorkspaceExportService', () => ({ exportWorkspace: vi.fn() }));
vi.mock('@/services/workspace/WorkspaceImportService', async () => {
  const actual = await vi.importActual<typeof import('@/services/workspace/WorkspaceImportService')>('@/services/workspace/WorkspaceImportService');
  return { WorkspaceImportError: actual.WorkspaceImportError, previewImport: vi.fn(), applyImport: vi.fn() };
});

const { authenticateBearer } = await import('@/services/ApiTokenService');
const { exportWorkspace } = await import('@/services/workspace/WorkspaceExportService');
const { applyImport, previewImport, WorkspaceImportError } = await import('@/services/workspace/WorkspaceImportService');
const { zipWorkspace } = await import('@/libs/workspace/archive');
const { GET: exportRoute } = await import('./export/route');
const { POST: importRoute } = await import('./import/route');

const ORG = 'proj_northwind_transfer';

function as(role: 'admin' | 'member') {
  vi.mocked(authenticateBearer).mockResolvedValue({ orgId: ORG, tokenId: 't1', principal: { kind: 'user', id: 'token:t1', role, scope: { orgId: ORG } } } as never);
}

function importRequest(fields: Record<string, string | Blob>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return new Request('https://vocion.test/api/v1/workspace/import', { method: 'POST', headers: { authorization: 'Bearer vcn_live_fake' }, body: form });
}

const ZIP = new Blob([zipWorkspace([{ path: 'workspace.yaml', content: 'version: 1\n', encoding: 'utf8' }], 'northwind-workspace') as BlobPart], { type: 'application/zip' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/workspace/export', () => {
  it('refuses a member: the export is the whole workspace', async () => {
    as('member');

    const res = await exportRoute(new Request('https://vocion.test/api/v1/workspace/export', { headers: { authorization: 'Bearer vcn_live_fake' } }));

    expect(res.status).toBe(403);
    expect(exportWorkspace).not.toHaveBeenCalled();
  });

  it('hands an admin the workspace as a zip under one folder, named for the workspace and the day', async () => {
    as('admin');
    vi.mocked(exportWorkspace).mockResolvedValue({
      project: { id: ORG, slug: 'northwind', name: 'Northwind' },
      exportedAt: new Date('2026-10-07T12:00:00Z'),
      files: [
        { path: 'EXPORT.md', content: '# Northwind\n', encoding: 'utf8' },
        { path: 'workspace.yaml', content: 'version: 1\n', encoding: 'utf8' },
      ],
      report: { base: 'stored', fromRows: [], left: [], problems: [] },
    });

    const res = await exportRoute(new Request('https://vocion.test/api/v1/workspace/export', { headers: { authorization: 'Bearer vcn_live_fake' } }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="northwind-workspace-2026-10-07.zip"');
    expect(exportWorkspace).toHaveBeenCalledWith(ORG);

    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));

    expect(Object.keys(entries).sort()).toEqual(['northwind-workspace/EXPORT.md', 'northwind-workspace/workspace.yaml']);
    expect(Buffer.from(entries['northwind-workspace/workspace.yaml']!).toString()).toBe('version: 1\n');
  });
});

describe('POST /api/v1/workspace/import', () => {
  it('refuses a member', async () => {
    as('member');

    expect((await importRoute(importRequest({ file: ZIP }))).status).toBe(403);
    expect(previewImport).not.toHaveBeenCalled();
  });

  it('asks for the zip as multipart in a field named file', async () => {
    as('admin');
    const res = await importRoute(importRequest({ replace: 'true' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain('field named file');
  });

  it('reviews by default, merging unless replace is asked for, and writes nothing', async () => {
    as('admin');
    vi.mocked(previewImport).mockResolvedValue({ sha: 'local-abc', replace: true, fileCount: 1, counts: {} as never, changes: [], unchanged: 0, errors: [], warnings: [], blockedBy: null });

    const res = await importRoute(importRequest({ file: ZIP, replace: 'true' }));

    expect(res.status).toBe(200);
    expect((await res.json()).sha).toBe('local-abc');
    expect(previewImport).toHaveBeenCalledWith(ORG, expect.any(Uint8Array), { replace: true });
    expect(applyImport).not.toHaveBeenCalled();
  });

  it('applies only with the sha the review answered, as the caller', async () => {
    as('admin');

    expect((await importRoute(importRequest({ file: ZIP, apply: 'true' }))).status).toBe(400);
    expect(applyImport).not.toHaveBeenCalled();

    vi.mocked(applyImport).mockResolvedValue({ sha: 'local-abc', versionId: 7, counts: {} as never, changes: [], errors: [], warnings: [] });
    const res = await importRoute(importRequest({ file: ZIP, apply: 'true', sha: 'local-abc' }));

    expect(res.status).toBe(200);
    expect(applyImport).toHaveBeenCalledWith(ORG, expect.any(Uint8Array), { replace: false, sha: 'local-abc', appliedBy: 'workspace.import:token:t1' });
  });

  it('answers each refusal with its status: changed since the review, or undone by the next apply', async () => {
    as('admin');
    vi.mocked(applyImport).mockRejectedValueOnce(new WorkspaceImportError('CHANGED', 'Review it again.'));

    expect((await importRoute(importRequest({ file: ZIP, apply: 'true', sha: 'x' }))).status).toBe(409);

    vi.mocked(applyImport).mockRejectedValueOnce(new WorkspaceImportError('BLOCKED', 'Applied from git.'));
    const blocked = await importRoute(importRequest({ file: ZIP, apply: 'true', sha: 'x' }));

    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe('IMPORT_BLOCKED');

    vi.mocked(previewImport).mockRejectedValueOnce(new WorkspaceImportError('INVALID', 'agents/broken.yaml: no prompt'));

    expect((await importRoute(importRequest({ file: ZIP }))).status).toBe(422);
  });

  it('refuses an upload that is not a workspace zip with what is wrong with it', async () => {
    as('admin');
    vi.mocked(previewImport).mockImplementationOnce(async () => {
      const { readWorkspaceArchive } = await import('@/libs/workspace/archive');
      readWorkspaceArchive(new Uint8Array([1, 2, 3]));
      throw new Error('unreachable');
    });
    const res = await importRoute(importRequest({ file: new Blob(['not a zip']) }));

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain('could not be read as a zip');
  });
});
