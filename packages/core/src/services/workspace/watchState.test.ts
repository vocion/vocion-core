import { describe, expect, it } from 'vitest';
import { watchedItems, watchStateOf } from './watchState';

const WATCH = { automation: 'error-watch', items: 'projects', itemLabel: 'project' };
const row = (over: Partial<{ status: string; pausedAt: Date | null; input: Record<string, unknown> }> = {}) => ({
  name: 'Production errors become incidents',
  status: over.status ?? 'active',
  pausedAt: over.pausedAt ?? null,
  doConfig: { input: over.input ?? { projects: [{ project: 'northwind-api', environment: 'production' }, 'northwind-web', { environment: 'staging' }] } },
});

describe('what a watch is watching, and when it last read', () => {
  it('reads what the automation names, by label, from objects or strings', () => {
    expect(watchedItems(row().doConfig.input, WATCH)).toEqual(['northwind-api', 'northwind-web']);
    expect(watchedItems({ projects: 'northwind-api' }, WATCH)).toEqual([]);
    expect(watchedItems({ projects: ['a'] }, { automation: 'error-watch' })).toEqual([]);
  });

  it('says when it last read, and why its last read failed', () => {
    const at = new Date('2026-01-10T12:00:00Z');

    expect(watchStateOf(row(), { startedAt: at, status: 'ok', error: null }, WATCH)).toEqual({ name: 'Production errors become incidents', items: ['northwind-api', 'northwind-web'], state: 'active', lastReadAt: at, lastError: null });
    expect(watchStateOf(row(), { startedAt: at, status: 'error', error: 'Sentry answered 401' }, WATCH).lastError).toBe('Sentry answered 401');
    expect(watchStateOf(row(), null, WATCH).lastReadAt).toBeNull();
  });

  it('tells a paused, an off and a missing watch apart from a quiet one', () => {
    expect(watchStateOf(row({ pausedAt: new Date() }), null, WATCH).state).toBe('paused');
    expect(watchStateOf(row({ status: 'disabled' }), null, WATCH).state).toBe('off');
    expect(watchStateOf(null, null, WATCH)).toMatchObject({ state: 'missing', items: [] });
    expect(watchStateOf(row({ input: { projects: [] } }), null, WATCH).items).toEqual([]);
  });
});
