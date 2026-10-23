import { describe, expect, it } from 'vitest';
import { appsLine } from './pickerModel';

describe('appsLine', () => {
  it('names a workspace\'s apps beyond the core one, else the core app', () => {
    expect(appsLine([{ name: 'Workforce', core: true }, { name: 'GTM', core: false }, { name: 'Routines', core: false }])).toBe('GTM · Routines');
    expect(appsLine([{ name: 'Workforce', core: true }])).toBe('Workforce');
    expect(appsLine([])).toBeNull();
  });
});
