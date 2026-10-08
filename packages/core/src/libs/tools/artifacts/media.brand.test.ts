import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { brandAssetUrl, keepBrandAsset, parseBrandAssetUrl, readBrandAsset } from './media';

/**
 * An Org's logo and mark in the media store: an SVG (cleaned) or a PNG,
 * small, named by content hash under the Org, and readable back only under
 * that same Org.
 */

const dir = () => mkdtempSync(path.join(tmpdir(), 'brand-store-'));
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]);
const SVG = new TextEncoder().encode('<svg viewBox="0 0 2 2" onload="x()"><rect width="2" height="2"/><script>x()</script></svg>');

describe('keepBrandAsset', () => {
  it('keeps an SVG cleaned, under the Org, named by its content', async () => {
    const d = dir();
    const kept = await keepBrandAsset({ accountId: 'acct-nw', name: 'logo', data: SVG, contentType: 'image/svg+xml' }, { dir: d, bucket: null });

    expect(kept.ok).toBe(true);

    if (!kept.ok) {
      return;
    }

    expect(kept.url).toMatch(/^\/api\/media\/brand\/acct-nw\/logo-[0-9a-f]{16}\.svg$/);

    const back = await readBrandAsset('acct-nw', kept.filename, { dir: d, bucket: null });
    const text = new TextDecoder().decode(back!.bytes);

    expect(back?.contentType).toBe('image/svg+xml');
    expect(text).not.toMatch(/onload|script/);
    expect(text).toContain('<rect width="2" height="2">');
  });

  it('a PNG is kept by its signature, not its claim', async () => {
    const d = dir();

    expect(await keepBrandAsset({ accountId: 'acct-nw', name: 'mark', data: PNG, contentType: 'image/png' }, { dir: d, bucket: null })).toMatchObject({ ok: true });
    expect(await keepBrandAsset({ accountId: 'acct-nw', name: 'mark', data: SVG, contentType: 'image/png' }, { dir: d, bucket: null })).toMatchObject({ ok: false, reason: 'that file is not a PNG image.' });
  });

  it('refuses another type, an empty file and one over the size a logo may be, with the reason', async () => {
    const d = dir();

    expect(await keepBrandAsset({ accountId: 'acct-nw', name: 'logo', data: PNG, contentType: 'image/gif' }, { dir: d, bucket: null })).toMatchObject({ ok: false, reason: expect.stringContaining('upload an SVG or a PNG') });
    expect(await keepBrandAsset({ accountId: 'acct-nw', name: 'logo', data: new Uint8Array(), contentType: 'image/png' }, { dir: d, bucket: null })).toMatchObject({ ok: false, reason: 'the file is empty.' });
    expect(await keepBrandAsset({ accountId: 'acct-nw', name: 'logo', data: new Uint8Array(600 * 1024), contentType: 'image/png' }, { dir: d, bucket: null })).toMatchObject({ ok: false, tooLarge: true, reason: expect.stringContaining('at most 512 KB') });
  });

  it('writes to the bucket when one is set', async () => {
    const put = vi.fn(async () => {});
    const kept = await keepBrandAsset({ accountId: 'acct-nw', name: 'mark', data: PNG, contentType: 'image/png' }, { put, bucket: { bucket: 'media', region: 'us-west-2' } });

    expect(kept).toMatchObject({ ok: true, store: 's3' });
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'media', key: expect.stringMatching(/^brand\/acct-nw\/mark-[0-9a-f]{16}\.png$/), contentType: 'image/png' }));
  });
});

describe('reading a brand file back', () => {
  it('is scoped to the Org: a name cannot reach another Org\'s file', async () => {
    const d = dir();
    const kept = await keepBrandAsset({ accountId: 'acct-nw', name: 'logo', data: PNG, contentType: 'image/png' }, { dir: d, bucket: null });
    const filename = kept.ok ? kept.filename : '';

    expect(await readBrandAsset('acct-kestrel', filename, { dir: d, bucket: null })).toBeNull();
    expect(await readBrandAsset('acct-nw', '../../etc/passwd', { dir: d, bucket: null })).toBeNull();
  });

  it('parses only URLs this store writes', () => {
    expect(parseBrandAssetUrl(brandAssetUrl('acct-nw', 'logo-0123456789abcdef.svg'))).toEqual({ accountId: 'acct-nw', filename: 'logo-0123456789abcdef.svg' });
    expect(parseBrandAssetUrl('https://agents.example/api/media/brand/acct-nw/logo-0123456789abcdef.png')).toEqual({ accountId: 'acct-nw', filename: 'logo-0123456789abcdef.png' });
    expect(parseBrandAssetUrl('/api/media/brand/acct-nw/logo.exe')).toBeNull();
    expect(parseBrandAssetUrl('https://northwind.example/logo.svg')).toBeNull();
  });
});
