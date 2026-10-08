import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandCssRoot, brandForAgent, brandLogoRefs, loadBrand, logoDataUri, logoRefPath, readWorkspaceBrand } from './brand';

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

describe('a brand from wherever it is stored', () => {
  it('loadBrand inlines a data URI as written and asks the source for any other logo', () => {
    const asked: string[] = [];
    const { brand, issues } = loadBrand({
      file: 'brand.yaml',
      read: () => 'name: Contoso Supply\nlogos:\n  mark: brand/mark.svg\n  wordmark: data:image/png;base64,AAAA\n  markOnDark: brand/missing.svg\n',
      logo: (ref) => {
        asked.push(ref);
        return ref === 'brand/mark.svg' ? 'data:image/svg+xml;base64,PHN2Zy8+' : undefined;
      },
    });

    expect(asked).toEqual(['brand/mark.svg', 'brand/missing.svg']);
    expect(brand?.logos).toEqual({ mark: 'data:image/svg+xml;base64,PHN2Zy8+', wordmark: 'data:image/png;base64,AAAA', markOnDark: undefined });
    expect(issues).toEqual([{ file: 'brand.yaml', message: 'logos.markOnDark: "brand/missing.svg" is not a readable image under the workspace' }]);
  });

  it('a brand that cannot be read is an issue naming the file, never a crash', () => {
    const { brand, issues } = loadBrand({ file: 'brand.yaml', read: () => {
      throw new Error('token unresolved');
    }, logo: () => undefined });

    expect(brand).toBeNull();
    expect(issues).toEqual([{ file: 'brand.yaml', message: 'token unresolved' }]);
  });

  it('logoRefPath keys a logo by its place in the workspace, and refuses one outside it', () => {
    expect(logoRefPath('brand/./mark.svg')).toBe('brand/mark.svg');
    expect(logoRefPath('../outside.svg')).toBeNull();
    expect(logoRefPath('/etc/passwd')).toBeNull();
    expect(logoRefPath('data:image/png;base64,AAAA')).toBeNull();
    expect(logoRefPath('brand/\0mark.svg')).toBeNull();
  });

  it('brandLogoRefs reads the logos block leniently, and an unparseable file names none', () => {
    expect(brandLogoRefs('name: X\nlogos:\n  mark: a.svg\n  wordmark: 3\n')).toEqual(['a.svg']);
    expect(brandLogoRefs(': : not yaml [')).toEqual([]);
  });
});
