/**
 * A briefing is a source, and until this it was the only kind of answer the
 * agent could give with nothing to cite.
 *
 * Citations existed for exactly one tool: `search_knowledge` numbered its hits
 * `[n]`, emitted them as source chips, and the prompt told the model to cite
 * them. Every other tool returned bare prose. So a turn answered entirely from
 * `get_briefing` — which is what "what should I do right now?" produces —
 * carried a whole day's schedule with no source marker anywhere, and the one
 * claim in it that was wrong looked exactly like the ones that were right.
 */
import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

const brief = {
  id: 42,
  title: 'Revenue Briefing — Thu, Sep 17, 2026',
  content: '## Critical path\n10:30 — bid outcome call',
  createdAt: new Date(),
  teamSlug: 'revenue',
};

describe('get_briefing citations', () => {
  it('numbers the briefing and emits it as a source the reader can open', async () => {
    const emit = vi.fn();
    const ctx = {
      orgId: 'org_1',
      citationSeq: { current: 0 },
      emit,
    } as unknown as RuntimeContext;

    const { renderBriefingForAgent } = await import('./briefingCitation');
    const text = renderBriefingForAgent(ctx, brief, 'your team (revenue)');

    // The number the model is told to cite with.
    expect(text.startsWith('[1] ')).toBe(true);
    expect(ctx.citationSeq.current).toBe(1);

    // The same number, on a source the panel can render and the reader can open.
    expect(emit).toHaveBeenCalledWith({
      type: 'documents',
      documents: [expect.objectContaining({
        document_id: 'briefing:42',
        semantic_identifier: brief.title,
        link: '/dashboard/briefings/42',
        source_type: 'briefing',
        citationIndex: 1,
      })],
    });
  });

  it('keeps numbering unique when a turn reads several briefings', async () => {
    const ctx = { orgId: 'org_1', citationSeq: { current: 7 }, emit: vi.fn() } as unknown as RuntimeContext;
    const { renderBriefingForAgent } = await import('./briefingCitation');

    expect(renderBriefingForAgent(ctx, brief, 'rollup').startsWith('[8] ')).toBe(true);
    expect(renderBriefingForAgent(ctx, { ...brief, id: 43 }, 'team alpha').startsWith('[9] ')).toBe(true);
  });

  it('tells the model to cite it, in the tool output itself', async () => {
    const ctx = { orgId: 'org_1', citationSeq: { current: 0 }, emit: vi.fn() } as unknown as RuntimeContext;
    const { renderBriefingForAgent } = await import('./briefingCitation');

    expect(renderBriefingForAgent(ctx, brief, 'rollup')).toContain('cite [1] on every claim');
  });
});
