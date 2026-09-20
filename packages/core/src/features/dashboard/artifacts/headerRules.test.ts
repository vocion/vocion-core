import { describe, expect, it } from 'vitest';
import { actionsFor, openInChatTarget, resolveTab, tabsFor } from './headerRules';

/**
 * The header's rules, without a browser: which tabs an artifact shows, which
 * verbs a surface shows, and where one verb goes from each surface.
 *
 * These are the two questions the three surfaces used to answer differently —
 * and answering them in one pure function is what makes "the pane, the page
 * and /open end up with the same vocabulary" checkable rather than asserted.
 */

const DOC = { kind: 'document' as const };

describe('tabsFor', () => {
  it('gives a document three views of itself, Document first', () => {
    expect(tabsFor({ ...DOC, issues: 0, findings: 0, blocks: 0, verified: true }).map(t => t.id))
      .toEqual(['document', 'html', 'findings']);
  });

  it('gives every other kind no tab strip at all — one view needs no chrome', () => {
    for (const kind of ['markdown', 'table', 'chart', 'record', 'link', 'file', 'sequence'] as const) {
      expect(tabsFor({ kind })).toEqual([]);
    }
  });

  it('counts verify issues and buyer findings together on the Findings tab', () => {
    const findings = tabsFor({ ...DOC, issues: 2, findings: 9, blocks: 0, verified: false }).find(t => t.id === 'findings');

    expect(findings?.count).toBe(11);
  });

  it('is amber only when something blocks — a fix to make is not an alarm', () => {
    const clean = tabsFor({ ...DOC, issues: 0, findings: 3, blocks: 0, verified: true }).find(t => t.id === 'findings');
    const blocked = tabsFor({ ...DOC, issues: 0, findings: 3, blocks: 1, verified: true }).find(t => t.id === 'findings');
    const unverified = tabsFor({ ...DOC, issues: 2, findings: 0, blocks: 0, verified: false }).find(t => t.id === 'findings');

    expect(clean?.blocking).toBe(false);
    expect(blocked?.blocking).toBe(true);
    expect(unverified?.blocking).toBe(true);
  });

  it('drops HTML on an older version — it is a read, so there is nothing to hand-edit', () => {
    expect(tabsFor({ ...DOC, historical: true }).map(t => t.id)).toEqual(['document', 'findings']);
  });

  it('keeps Findings even when there is nothing to answer, so a person can check', () => {
    const tabs = tabsFor({ ...DOC, issues: 0, findings: 0, blocks: 0, verified: true });

    expect(tabs.map(t => t.id)).toContain('findings');
    expect(tabs.find(t => t.id === 'findings')?.count).toBe(0);
  });
});

describe('resolveTab', () => {
  const tabs = tabsFor({ ...DOC, historical: false });

  it('opens what this browser last had open for this artifact', () => {
    expect(resolveTab(tabs, 'findings')).toBe('findings');
  });

  it('falls back to the first tab when nothing is remembered', () => {
    expect(resolveTab(tabs, null)).toBe('document');
  });

  it('falls back rather than showing a blank panel when the remembered tab is gone', () => {
    expect(resolveTab(tabsFor({ ...DOC, historical: true }), 'html')).toBe('document');
  });
});

describe('actionsFor', () => {
  it('never offers "Open in chat" from the pane — the pane IS a chat with this open beside it', () => {
    expect(actionsFor('pane', DOC)).not.toContain('chat');
  });

  it('offers "Open in chat" from the artifact page, which is the surface that is not in one', () => {
    expect(actionsFor('page', DOC)).toContain('chat');
  });

  it('offers Close only where there is a column to give back', () => {
    expect(actionsFor('pane', { ...DOC, closable: true })).toContain('close');
    expect(actionsFor('pane', { ...DOC, closable: false })).not.toContain('close');
    expect(actionsFor('page', { ...DOC, closable: true })).not.toContain('close');
  });

  it('keeps PDF and Open for a document, on every surface that has them', () => {
    expect(actionsFor('pane', { ...DOC, hasPdf: true })).toEqual(expect.arrayContaining(['pdf', 'open']));
    expect(actionsFor('page', { ...DOC, hasPdf: true })).toEqual(expect.arrayContaining(['pdf', 'open']));
    // No PDF was printed for this version: the verb is omitted, not disabled.
    expect(actionsFor('page', { ...DOC, hasPdf: false })).not.toContain('pdf');
  });

  it('gives a non-document neither PDF nor the full-screen document wrapper', () => {
    const actions = actionsFor('page', { kind: 'table', hasPdf: true });

    expect(actions).not.toContain('pdf');
    expect(actions).not.toContain('open');
    expect(actions).toEqual(expect.arrayContaining(['history', 'export', 'share', 'chat']));
  });

  it('shows Save only while there is something unsaved, and shows it first', () => {
    expect(actionsFor('pane', DOC)).not.toContain('save');
    expect(actionsFor('pane', { ...DOC, dirty: true })[0]).toBe('save');
  });

  it('omits every stateful verb on /open — it is a read of one version', () => {
    const actions = actionsFor('open', { ...DOC, hasPdf: true, dirty: true, closable: true });

    expect(actions).toEqual(['chat', 'pdf']);
  });

  it('agrees with itself: every surface draws the verbs it has in the same order', () => {
    const pane = actionsFor('pane', { ...DOC, hasPdf: true, closable: true }).filter(a => a !== 'close');
    const page = actionsFor('page', { ...DOC, hasPdf: true }).filter(a => a !== 'chat');

    expect(pane).toEqual(page);
  });
});

describe('openInChatTarget', () => {
  it('goes to the conversation the artifact came out of, with it open beside the transcript', () => {
    expect(openInChatTarget(251, 132)).toEqual({ href: '/dashboard/chat/132?artifact=251', stashAbout: false });
  });

  it('starts a fresh chat carrying the artifact when it came out of none', () => {
    expect(openInChatTarget(251, null)).toEqual({ href: '/dashboard/chat?new=1', stashAbout: true });
    expect(openInChatTarget(251, undefined)).toEqual({ href: '/dashboard/chat?new=1', stashAbout: true });
  });
});
