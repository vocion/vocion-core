/**
 * What the pane gets back when it cannot show the thing: the reference named
 * in words with its page, never "5974" or "126.plan"; and a read that FAILED
 * (the server restarting under it) marked as retryable, so the pane retries
 * rather than telling the person it does not exist (Chris, 2026-09-28).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { registerPreview, resolvePreview } = await import('./registry');
await import('./descriptors');

const CTX = { orgId: 'org_preview_fallback', userId: null };

describe('an unresolved reference', () => {
  it('names a feature part in words, with the feature page as its link', async () => {
    const doc = await resolvePreview({ type: 'feature_section', id: '126.plan' }, CTX);

    expect(doc.unresolved).toBeTruthy();
    expect(doc.unresolved?.retryable).toBeUndefined();
    expect(doc.title).toBe('Plan for #126');
    expect(doc.href).toBe('/dashboard/p/feature/126');
  });

  it('names an engineering run in words, with its run page', async () => {
    const doc = await resolvePreview({ type: 'worker_run', id: '424242' }, CTX);

    expect(doc.title).toBe('Engineering run #424242');
    expect(doc.href).toBe('/dashboard/p/runs/424242');
  });

  it('marks a read that threw as retryable, and still names what it was reading', async () => {
    registerPreview('team', {
      sourceLabel: 'Team',
      resolve: async () => {
        throw new Error('Connection terminated unexpectedly');
      },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = await resolvePreview({ type: 'team', id: 'growth' }, CTX);
    spy.mockRestore();

    expect(doc.unresolved).toEqual({ reason: 'This could not be read just now.', reference: 'growth', retryable: true });
    expect(doc.title).toBe('Team growth');
  });
});
