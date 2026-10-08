import { describe, expect, it } from 'vitest';
import { headingFontFor } from './fonts';
import { brandAccent, brandCss, brandTitle, brandView, checkOrgBrand, fieldsOf, previewViewOf, withFields } from './orgBrand';

/**
 * An Org's brand is a brand guide — the same schema a workspace's brand.yaml
 * is read with — worn by the app: a view (logos, accent per theme, heading
 * face) and the CSS layered over the app's tokens.
 */

const LOGO = '/api/media/brand/acct-nw/logo-0123456789abcdef.svg';
const MARK = '/api/media/brand/acct-nw/mark-0123456789abcdef.svg';

const northwind = withFields(null, {
  name: 'Northwind',
  accent: '#0E8C7F',
  headingFont: 'Space Grotesk',
  senderName: 'Northwind Ops',
  logos: { wordmark: LOGO, mark: MARK },
  website: 'https://northwind.example',
});

describe('the guide', () => {
  it('writes the editable fields into the guide and reads them back', () => {
    expect(northwind.palette).toEqual({ accent: '#0e8c7f' });
    expect(northwind.roles.accent).toBe('accent');
    expect(brandAccent(northwind)).toBe('#0e8c7f');
    expect(fieldsOf(northwind)).toEqual({ name: 'Northwind', accent: '#0e8c7f', headingFont: 'Space Grotesk', senderName: 'Northwind Ops', logos: { wordmark: LOGO, mark: MARK }, website: 'https://northwind.example' });
  });

  it('keeps what the guide holds beyond the fields, and writes the accent to the token it already names', () => {
    const seeded = { ...northwind, palette: { navy: '#12355B', teal: '#0E8C7F' }, roles: { ink: 'navy', accent: 'teal' }, voice: ['Plain and direct.'] };
    const edited = withFields(seeded, { ...fieldsOf(seeded), accent: '#1F6FEB', headingFont: null });

    expect(edited.palette).toEqual({ navy: '#12355B', teal: '#1f6feb' });
    expect(edited.roles).toEqual({ ink: 'navy', accent: 'teal' });
    expect(edited.voice).toEqual(['Plain and direct.']);
    // "The app's own face" — back to Inter.
    expect(edited.fonts.heading).toBe('Inter');
  });

  it('is checked: a guide without a name, or with an accent that cannot be worn, is refused with the reason', () => {
    expect(checkOrgBrand({ palette: {} })).toMatchObject({ ok: false, reason: expect.stringContaining('name') });
    expect(checkOrgBrand({ name: 'Northwind', palette: { accent: 'teal' }, roles: { accent: 'accent' } })).toMatchObject({ ok: false, reason: expect.stringContaining('palette.accent') });
    expect(checkOrgBrand(withFields(null, { ...fieldsOf(northwind), accent: '#FFFF00' }))).toMatchObject({ ok: false, reason: expect.stringContaining('Pick a deeper shade') });
    expect(checkOrgBrand(withFields(null, { ...fieldsOf(northwind), accent: '#F18700' }))).toMatchObject({ ok: true, notes: [expect.stringContaining('On light pages')] });
  });
});

describe('the view and its CSS', () => {
  it('the logo stands in for itself on dark pages unless a dark one is given; the mark the same', () => {
    const v = brandView(northwind, { whiteLabel: false });

    expect(v.logo).toEqual({ light: LOGO, dark: LOGO });
    expect(v.mark).toEqual({ light: MARK, dark: MARK });
    expect(v.poweredBy).toBe(true);
    expect(brandView(northwind, { whiteLabel: true }).poweredBy).toBe(false);
  });

  it('serves only allowlisted heading faces; Inter is the app\'s own and is no override', () => {
    expect(headingFontFor('space grotesk')?.id).toBe('space-grotesk');
    expect(headingFontFor('SourceSerif4')?.id).toBe('source-serif-4');
    expect(headingFontFor('Comic Neue')).toBeNull();
    expect(brandView(northwind, { whiteLabel: false }).headingFont?.family).toBe('Space Grotesk');
    expect(brandView(withFields(null, { ...fieldsOf(northwind), headingFont: 'Inter' }), { whiteLabel: false }).headingFont).toBeNull();
  });

  it('layers the accent and the face over the app tokens, light and dark apart, from normalised values only', () => {
    const css = brandCss(brandView(northwind, { whiteLabel: false }));

    expect(css).toMatch(/^:root\{--org-accent:#0e8c7f;--org-accent-foreground:#[0-9a-f]{6};--org-accent-ink:#[0-9a-f]{6};--org-accent-ink-foreground:#[0-9a-f]{6};--org-font-heading:var\(--font-space-grotesk\)/);
    expect(css).toContain(':root.dark,.dark{--org-accent:#0e8c7f;');
    expect(css).not.toMatch(/tint/);
    // Nothing to layer: nothing emitted.
    expect(brandCss(brandView(withFields(null, { ...fieldsOf(northwind), accent: null, headingFont: null }), { whiteLabel: false }))).toBe('');
  });

  it('previews a draft, and an accent that cannot be worn previews as none', () => {
    expect(previewViewOf({ ...fieldsOf(northwind), name: '  ' }).name).toBe('Your company');
    expect(previewViewOf({ ...fieldsOf(northwind), accent: '#ffff00' }).accent).toBeNull();
    expect(previewViewOf({ ...fieldsOf(northwind), accent: 'nope' }).accent).toBeNull();
  });

  it('names the tab after the Org', () => {
    expect(brandTitle('Northwind')).toBe('Northwind · Vocion');
    expect(brandTitle(null)).toBe('Vocion');
  });
});
