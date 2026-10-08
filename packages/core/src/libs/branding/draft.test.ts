import { describe, expect, it } from 'vitest';
import { cleanBrandName, decodeDraft, draftFromProfile, encodeDraft } from './draft';

/**
 * A brand drafted from what the company's own site paints: the choices a
 * person would make, and every gap said rather than filled.
 */

const SITE = {
  url: 'https://northwind.example',
  name: 'Northwind | Routing for regional carriers',
  logoUrl: 'https://northwind.example/assets/logo.svg',
  faviconUrl: 'https://northwind.example/favicon.ico',
  colors: { primary: '#FFFFFF', accent: '#0E8C7F', background: '#ffffff', textPrimary: '#12355B' },
  fonts: { heading: 'Barlow', body: 'Inter' },
};

describe('draftFromProfile', () => {
  it('maps the site onto the brand fields', () => {
    const { input, notes } = draftFromProfile(SITE, 'Northwind');

    expect(input).toEqual({
      name: 'Northwind',
      // The primary is the page's own white: not an accent. The next one with a hue is.
      accent: '#0e8c7f',
      headingFont: 'Barlow',
      senderName: 'Northwind',
      logos: { wordmark: 'https://northwind.example/assets/logo.svg' },
      website: 'https://northwind.example',
    });
    // The .ico favicon cannot be kept: said, not guessed around.
    expect(notes.join(' ')).toContain('.ico');
  });

  it('keeps Vocion\'s accent when no colour on the site can be worn, and says so', () => {
    const { input, notes } = draftFromProfile({ ...SITE, colors: { primary: '#FFFF00' } }, 'Northwind');

    expect(input.accent).toBeNull();
    expect(notes.join(' ')).toContain('accent stays Vocion');
  });

  it('a font the app does not serve stays in the app\'s own face, and the site\'s name falls back to the Org\'s', () => {
    const { input, notes } = draftFromProfile({ url: 'https://northwind.example', fonts: { heading: 'Acumin Pro' } }, 'Northwind');

    expect(input.name).toBe('Northwind');
    expect(input.headingFont).toBeNull();
    expect(notes.join(' ')).toContain('Acumin Pro');
    expect(notes.join(' ')).toContain('no logo');
  });

  it('cleans a page title into a name', () => {
    expect(cleanBrandName('Kestrel Capital — Home')).toBe('Kestrel Capital');
    expect(cleanBrandName('Contoso Supply')).toBe('Contoso Supply');
  });
});

describe('a draft in a link', () => {
  it('round-trips through the Brand settings URL, accents and accented names included', () => {
    const input = draftFromProfile({ ...SITE, name: 'Café Northwind' }, 'Northwind').input;
    const param = encodeDraft(input);

    expect(param).toMatch(/^[\w-]+$/);
    expect(decodeDraft(param)).toEqual(input);
    expect(decodeDraft('not-a-draft')).toBeNull();
    expect(decodeDraft(null)).toBeNull();
  });
});
