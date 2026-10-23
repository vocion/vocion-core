import { describe, expect, it } from 'vitest';
import { appMissingHere } from '@/features/navigation/apps';
import { appsElsewhere } from './appsElsewhere';

/**
 * A deep link into an app this workspace lacks is recognised from the
 * catalogue alone, so the shell can say where the app is instead of opening
 * on nothing.
 */
describe('appsElsewhere', () => {
  it('lists every app a bare workspace lacks, each with the pages it owns', () => {
    const missing = appsElsewhere([], []);
    const ids = missing.map(a => a.id);

    expect(ids).toEqual(expect.arrayContaining(['finance', 'software-factory', 'routines']));
    expect(ids).not.toContain('workforce');
    expect(missing.every(a => !a.core)).toBe(true);
  });

  it('leaves out the apps the workspace has', () => {
    expect(appsElsewhere(['finance'], []).map(a => a.id)).not.toContain('finance');
  });

  it('names Finance for a Finance page opened in a workspace without it, and nothing for Chat', () => {
    const missing = appsElsewhere([], []);
    const finance = missing.find(a => a.id === 'finance')!;
    const page = finance.owns[0]!;

    expect(appMissingHere(page, [{ id: 'workforce', core: true, owns: [] }], missing)).toBe('finance');
    expect(appMissingHere('/dashboard/chat', [{ id: 'workforce', core: true, owns: [] }], missing)).toBeNull();
  });
});
