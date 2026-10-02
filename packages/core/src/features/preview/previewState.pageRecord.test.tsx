import { afterEach, describe, expect, it } from 'vitest';
import { isPageRecord, openPreview } from './previewState';

/**
 * THE PAGE'S OWN RECORD IS NEVER PEEKED BESIDE ITSELF (Chris, 2026-09-30,
 * product #25: a rename from the docked chat opened a pane for the record the
 * page already showed). Fixture data only.
 */
describe('a preview of the page\'s own record', () => {
  const start = `${window.location.pathname}${window.location.search}`;

  afterEach(() => {
    window.history.replaceState(null, '', start);
  });

  it('knows the page\'s record by either spelling, and a run on a run\'s page', () => {
    expect(isPageRecord({ type: 'object', id: '25' }, '/w/northwind/dashboard/p/products/25')).toBe(true);
    expect(isPageRecord({ type: 'request', id: '25' }, '/en/dashboard/p/feature/25')).toBe(true);
    expect(isPageRecord({ type: 'object', id: '26' }, '/w/northwind/dashboard/p/products/25')).toBe(false);
    expect(isPageRecord({ type: 'worker_run', id: '7' }, '/dashboard/p/runs/7')).toBe(true);
    expect(isPageRecord({ type: 'object', id: '7' }, '/dashboard/p/runs/7')).toBe(false);
    expect(isPageRecord({ type: 'object', id: '25' }, '/dashboard/p/work')).toBe(false);
  });

  it('opens nothing for the page\'s own record, and opens another record as before', () => {
    window.history.replaceState(null, '', '/w/northwind/dashboard/p/products/25');
    openPreview({ type: 'object', id: '25' }, null);

    expect(new URLSearchParams(window.location.search).get('preview')).toBeNull();

    openPreview({ type: 'object', id: '31' }, null);

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('object:31');
  });
});
