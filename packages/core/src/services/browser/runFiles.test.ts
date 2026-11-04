import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadName, isFileRef, resolveRunFile, RUN_FILE_MAX_BYTES } from './runFiles';

vi.mock('@/services/ArtifactService', () => ({
  getArtifact: vi.fn(async ({ id }: { id: number }) => id === 7
    ? { kind: 'table', title: 'Roster for Northwind Clinic', spec: { columns: [{ key: 'name', label: 'Name' }], rows: [{ name: 'Ada Example' }] } }
    : null),
}));

vi.mock('./browserEngine', () => ({
  mayLoad: vi.fn(async (u: string) => !u.includes('internal.example')),
}));

describe('isFileRef', () => {
  it('reads artifact ids and https addresses as files, nothing else', () => {
    expect(isFileRef('artifact:12')).toBe(true);
    expect(isFileRef(' https://files.example/w9.pdf ')).toBe(true);
    expect(isFileRef('http://files.example/w9.pdf')).toBe(false);
    expect(isFileRef('Northwind Clinic')).toBe(false);
    expect(isFileRef('')).toBe(false);
    expect(isFileRef(undefined)).toBe(false);
  });
});

describe('downloadName', () => {
  it('prefers Content-Disposition, then the last part of the address', () => {
    expect(downloadName('https://files.example/a/b/roster.csv', 'attachment; filename="Roster v2.csv"')).toBe('Roster v2.csv');
    expect(downloadName('https://files.example/a/w9%20form.pdf', null)).toBe('w9 form.pdf');
    expect(downloadName('https://files.example/', null)).toBe('file');
  });
});

describe('resolveRunFile', () => {
  afterEach(() => vi.clearAllMocks());

  it('attaches an artifact with tables as an xlsx', async () => {
    const f = await resolveRunFile('org-1', 'artifact:7');

    expect(typeof f).not.toBe('string');

    if (typeof f !== 'string') {
      expect(f.name.endsWith('.xlsx')).toBe(true);
      expect(f.mimeType).toContain('spreadsheetml');
      expect(f.buffer.byteLength).toBeGreaterThan(100);
    }
  });

  it('says so when the artifact is not in the workspace', async () => {
    expect(await resolveRunFile('org-1', 'artifact:99')).toMatch(/no artifact #99/);
  });

  it('fetches an https address the browser may use', async () => {
    const doFetch = vi.fn(async () => new Response(Buffer.from('%PDF-1.4 sample'), { headers: { 'content-type': 'application/pdf' } }));
    const f = await resolveRunFile('org-1', 'https://files.example/w9.pdf', doFetch as unknown as typeof fetch);

    expect(typeof f).not.toBe('string');

    if (typeof f !== 'string') {
      expect(f).toMatchObject({ name: 'w9.pdf', mimeType: 'application/pdf' });
    }
  });

  it('refuses an address the browser may not use, without fetching it', async () => {
    const doFetch = vi.fn();

    expect(await resolveRunFile('org-1', 'https://internal.example/secret.pdf', doFetch as unknown as typeof fetch)).toMatch(/not an address/);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('refuses a file over the limit', async () => {
    const doFetch = vi.fn(async () => new Response('x', { headers: { 'content-length': String(RUN_FILE_MAX_BYTES + 1) } }));

    expect(await resolveRunFile('org-1', 'https://files.example/big.pdf', doFetch as unknown as typeof fetch)).toMatch(/larger than/);
  });

  it('refuses anything that is not an artifact or https', async () => {
    expect(await resolveRunFile('org-1', 'file:///etc/passwd')).toMatch(/must be artifact/);
  });
});
