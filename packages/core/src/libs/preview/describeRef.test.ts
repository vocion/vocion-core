import { describe, expect, it } from 'vitest';
import { describeRef } from './describeRef';

/**
 * What the pane calls a reference before it has read it, and when it cannot:
 * the kind and which one, in words, and where its page is — never the bare id
 * Chris saw (2026-09-28: "5974", "126.plan").
 */
describe('a reference, in words', () => {
  it.each([
    [{ type: 'mission_run', id: '5974' }, 'Agent run #5974', '/dashboard/p/runs/agent-5974'],
    [{ type: 'worker_run', id: '501' }, 'Engineering run #501', '/dashboard/p/runs/501'],
    [{ type: 'feature_section', id: '126.plan' }, 'Plan for #126', '/dashboard/p/feature/126'],
    [{ type: 'feature_section', id: '126.implementation' }, 'Implementation of #126', '/dashboard/p/feature/126'],
    [{ type: 'feature_section', id: '126.criterion-0' }, 'Criterion 1 of #126', '/dashboard/p/feature/126'],
    [{ type: 'artifact', id: '700' }, 'Artifact #700', '/dashboard/artifacts/700'],
    [{ type: 'conversation', id: '12' }, 'Conversation #12', '/dashboard/chat?c=12'],
    [{ type: 'object', id: '31' }, 'Record #31', '/dashboard/objects/31'],
    [{ type: 'ask', id: '88' }, 'Ask #88', '/dashboard/inbox/ask%3A88'],
  ] as const)('%o → %s', (ref, label, href) => {
    expect(describeRef(ref)).toEqual({ label, href });
  });

  it('never answers with a bare id, whatever the type', () => {
    for (const type of ['mission_run', 'worker_run', 'artifact', 'briefing', 'conversation', 'object', 'document', 'record_history', 'request', 'ask', 'mission', 'deal'] as const) {
      expect(describeRef({ type, id: '5974' }).label).not.toBe('5974');
    }

    expect(describeRef({ type: 'feature_section', id: '126.plan' }).label).not.toContain('126.plan');
  });

  it('keeps a name and a page the caller already holds', () => {
    expect(describeRef({ type: 'mission_run', id: '5974', label: 'Triage the export', href: '/dashboard/somewhere' })).toEqual({ label: 'Triage the export', href: '/dashboard/somewhere' });
  });

  it('names a turn\'s sources and opens their conversation', () => {
    expect(describeRef({ type: 'conversation', id: '41.sources.9051' })).toEqual({ label: 'Sources', href: '/dashboard/chat?c=41' });
  });

  it('reads a citation the way the evidence list does', () => {
    expect(describeRef({ type: 'document', id: 'docuseal:7c9a11' }).href).toBeNull();
  });
});
