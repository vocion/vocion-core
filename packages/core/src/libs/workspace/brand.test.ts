import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandCssRoot, brandForAgent, BrandOverrideSchema, inheritBrand, logoDataUri, readWorkspaceBrand, readWorkspaceBrandFile } from './brand';

const TEMPLATE = path.resolve(__dirname, '..', '..', '..', 'templates', 'workspaces', 'client-documents');

describe('readWorkspaceBrand', () => {
  it('reads the sample workspace brand: tokens, roles, fonts, the logo as a data URI', () => {
    const { brand, issues } = readWorkspaceBrand(TEMPLATE);

    expect(issues).toEqual([]);
    expect(brand?.brand.name).toBe('Metacto');
    expect(brand?.cssRoot).toContain('--brand-orange:#F18700;');
    expect(brand?.cssRoot).toContain('--accent:var(--brand-orange);');
    expect(brand?.cssRoot).toContain('--font-heading:"Barlow",sans-serif;');
    expect(brand?.logos.mark).toMatch(/^data:image\/svg\+xml;base64,/);

    const text = brandForAgent(brand!);

    expect(text).toContain('Voice rules:');
    expect(text).toContain('Never write: before anything moves');
    expect(text).toContain('LOGO mark:');
  });

  it('no file is no brand, not an error; a bad file is an issue with the reason', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'brand-'));

    expect(readWorkspaceBrand(empty)).toEqual({ brand: null, issues: [] });

    writeFileSync(path.join(empty, 'brand.yaml'), 'name: X\npalette:\n  ink: notahex\n');
    const bad = readWorkspaceBrand(empty);

    expect(bad.brand).toBeNull();
    expect(bad.issues[0]?.message).toContain('palette.ink');
  });

  it('a logo path outside the workspace root is refused', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'brand-'));

    expect(logoDataUri('../../etc/passwd', root)).toBeUndefined();
    expect(logoDataUri('data:image/png;base64,AAAA', root)).toBe('data:image/png;base64,AAAA');
  });

  it('roles that name an unknown token are skipped rather than emitted broken', () => {
    const css = brandCssRoot({ name: 'A', palette: { ink: '#000000' }, roles: { ink: 'ink', accent: 'nope' }, fonts: { heading: 'Inter', headingWeight: 700, body: 'Inter' }, logos: {}, voice: [], banned: [] });

    expect(css).toContain('--ink:var(--brand-ink);');
    expect(css).not.toContain('--accent');
  });
});

describe('inheritBrand — the Org\'s brand with a workspace\'s file over it', () => {
  const org = {
    name: 'Northwind',
    descriptor: 'Routing software for regional carriers.',
    palette: { navy: '#12355B', teal: '#0E8C7F' },
    roles: { ink: 'navy', accent: 'teal' },
    fonts: { heading: 'Space Grotesk', headingWeight: 700, body: 'Inter' },
    logos: { mark: '/api/media/brand/acct-nw/mark-0123456789abcdef.svg', wordmark: '/api/media/brand/acct-nw/logo-0123456789abcdef.svg' },
    voice: ['Plain and direct.'],
    banned: ['synergy'],
    senderName: 'Northwind Ops',
  };

  it('a workspace that writes nothing is the Org\'s brand', () => {
    expect(inheritBrand(org, null)).toEqual(org);
  });

  it('a field the file writes wins, key by key; a field it leaves out is the Org\'s', () => {
    const file = BrandOverrideSchema.parse({ palette: { teal: '#1F6FEB', sand: '#F4EFE6' }, roles: { background: 'sand' }, logos: { wordmark: 'brand/support-logo.svg' }, fonts: { body: 'IBM Plex Sans' }, voice: ['Warm. Short sentences.'] });
    const merged = inheritBrand(org, file)!;

    expect(merged.name).toBe('Northwind');
    expect(merged.palette).toEqual({ navy: '#12355B', teal: '#1F6FEB', sand: '#F4EFE6' });
    expect(merged.roles).toEqual({ ink: 'navy', accent: 'teal', background: 'sand' });
    expect(merged.logos).toEqual({ mark: org.logos.mark, wordmark: 'brand/support-logo.svg' });
    expect(merged.fonts).toEqual({ heading: 'Space Grotesk', headingWeight: 700, body: 'IBM Plex Sans' });
    // A house style is replaced whole, never half-merged.
    expect(merged.voice).toEqual(['Warm. Short sentences.']);
    expect(merged.banned).toEqual(['synergy']);
    expect(merged.senderName).toBe('Northwind Ops');
  });

  it('a file may rename the company for its documents', () => {
    expect(inheritBrand(org, BrandOverrideSchema.parse({ name: 'Northwind Freight' }))?.name).toBe('Northwind Freight');
  });

  it('with no Org brand, the file has to name the company, as it always had to', () => {
    expect(inheritBrand(null, BrandOverrideSchema.parse({ palette: { teal: '#0E8C7F' } }))).toBeNull();

    const dir = mkdtempSync(path.join(tmpdir(), 'brand-'));
    writeFileSync(path.join(dir, 'brand.yaml'), 'palette:\n  teal: "#0E8C7F"\n');

    expect(readWorkspaceBrandFile(dir).override?.palette).toEqual({ teal: '#0E8C7F' });
    expect(readWorkspaceBrand(dir).issues[0]?.message).toContain('name: Required');
  });
});
