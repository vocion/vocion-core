import { describe, expect, it } from 'vitest';
import { cleanFontFamily, cleanFontRoles } from './fontNames';

describe('font names as a person reads them', () => {
  it('takes a build hash off the end (the names a live onboarding stored)', () => {
    expect(cleanFontRoles({ heading: 'Barlow-364621179e86efae', primary: 'Inter-b937ba1167470226' })).toEqual({ heading: 'Barlow', primary: 'Inter' });
  });

  it('reads next/font\'s own names and drops its fallback face', () => {
    expect(cleanFontFamily('__Inter_a64ecd, __Inter_Fallback_a64ecd')).toBe('Inter');
    expect(cleanFontFamily('__Playfair_Display_7d5a8c, __Playfair_Display_Fallback_7d5a8c, serif')).toBe('Playfair Display, serif');
    expect(cleanFontFamily('"Inter Fallback"')).toBe('Inter');
  });

  it('leaves a real name alone', () => {
    expect(cleanFontFamily('Acumin Pro')).toBe('Acumin Pro');
    expect(cleanFontFamily('"Source Serif 4", Georgia, serif')).toBe('Source Serif 4, Georgia, serif');
    expect(cleanFontFamily('Abril-Faced')).toBe('Abril-Faced');
    expect(cleanFontFamily('  ')).toBeUndefined();
  });
});
