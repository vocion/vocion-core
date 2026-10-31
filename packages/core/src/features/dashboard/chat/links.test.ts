import { describe, expect, it } from 'vitest';
import { appPathLabel, classifyDashboardLink, isPlainClick, linkAppPaths, previewRefFor } from './links';

describe('classifyDashboardLink', () => {
  it('recognises dashboard routes, with and without a locale prefix or origin', () => {
    expect(classifyDashboardLink('/dashboard/agents/revenue-lead')).toEqual({ href: '/dashboard/agents/revenue-lead', kind: 'agent', id: 'revenue-lead' });
    expect(classifyDashboardLink('/en/dashboard/missions/runs/42')).toEqual({ href: '/dashboard/missions/runs/42', kind: 'mission-run', id: '42' });
    expect(classifyDashboardLink('https://agents.metacto.com/dashboard/inbox/g/workforce:sheet:merges', 'https://agents.metacto.com'))
      .toEqual({ href: '/dashboard/inbox/g/workforce:sheet:merges', kind: 'ask', id: 'workforce:sheet:merges' });
    expect(classifyDashboardLink('/dashboard/review?filter=pending')).toMatchObject({ kind: 'review' });
    expect(classifyDashboardLink('/dashboard/missions/new')).toMatchObject({ kind: 'page' });
  });

  it('leaves external and non-dashboard links alone', () => {
    expect(classifyDashboardLink('https://hubspot.com/deal/1', 'https://agents.metacto.com')).toBeNull();
    expect(classifyDashboardLink('https://other.example/dashboard/agents/x', 'https://agents.metacto.com')).toBeNull();
    expect(classifyDashboardLink('/sign-in')).toBeNull();
    expect(classifyDashboardLink(undefined)).toBeNull();
  });

  it('knows a project (and the older rooms path), and offers it as a preview instead of a navigation', () => {
    const room = classifyDashboardLink('/dashboard/projects/22');

    expect(room).toEqual({ href: '/dashboard/projects/22', kind: 'room', id: '22' });
    expect(previewRefFor(room!)).toEqual({ type: 'object', id: '22' });
    expect(classifyDashboardLink('/dashboard/rooms/22')).toEqual({ href: '/dashboard/rooms/22', kind: 'room', id: '22' });
    expect(previewRefFor(classifyDashboardLink('/dashboard/agents/lead')!)).toBeNull();
  });

  it('peeks a goal beside the chat instead of navigating to its page', () => {
    const goal = classifyDashboardLink('/dashboard/goals/9');

    expect(goal).toEqual({ href: '/dashboard/goals/9', kind: 'goal', id: '9' });
    expect(previewRefFor(goal!)).toEqual({ type: 'goal', id: '9' });
  });

  it('peeks a record\'s history at the version the "Changed …" line names (backlog 035)', () => {
    const link = classifyDashboardLink('/dashboard/objects/214?preview=record_history%3A214%405');

    expect(link).toMatchObject({ kind: 'object', id: '214' });
    expect(previewRefFor(link!)).toEqual({ type: 'record_history', id: '214@5' });
  });
});

describe('a record named in an answer', () => {
  it('is read through the workspace prefix every record link carries, and keeps it to navigate', () => {
    const link = classifyDashboardLink('/w/northwind/dashboard/objects/504');

    expect(link).toEqual({ href: '/w/northwind/dashboard/objects/504', kind: 'object', id: '504' });
    expect(classifyDashboardLink('https://agents.metacto.com/w/northwind/dashboard/agents/lead', 'https://agents.metacto.com')).toMatchObject({ kind: 'agent', id: 'lead' });
  });

  it('peeks in the pane, whatever its type and wherever its page is', () => {
    expect(previewRefFor(classifyDashboardLink('/w/northwind/dashboard/objects/504')!)).toEqual({ type: 'object', id: '504' });
    expect(previewRefFor(classifyDashboardLink('/w/northwind/dashboard/p/feature/214')!)).toEqual({ type: 'object', id: '214' });
    expect(previewRefFor(classifyDashboardLink('/dashboard/objects/hubspot:deals:4021')!)).toEqual({ type: 'object', id: 'hubspot:deals:4021' });
  });

  it('takes over only a plain click; modifier and middle clicks stay the browser\'s', () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

    expect(isPlainClick(plain)).toBe(true);
    expect(isPlainClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
  });
});

describe('routine links', () => {
  it('peek a routine and a batch of its runs in the pane', () => {
    expect(previewRefFor(classifyDashboardLink('/dashboard/automations/7')!)).toEqual({ type: 'routine', id: '7' });
    expect(previewRefFor(classifyDashboardLink('/en/dashboard/automations/batches/3')!)).toEqual({ type: 'routine_batch', id: '3' });
    expect(classifyDashboardLink('/dashboard/automations')).toMatchObject({ kind: 'page' });
    expect(previewRefFor(classifyDashboardLink('/dashboard/routines/7')!)).toEqual({ type: 'routine', id: '7' });
  });
});

describe('an in-app path written as text is a link (2026-10-29)', () => {
  type Node = { type: string; value?: string; url?: string; children?: Node[] };
  const paragraph = (...children: Node[]): Node => ({ type: 'root', children: [{ type: 'paragraph', children }] });
  const linked = (tree: Node): Node[] => {
    linkAppPaths(tree);
    return tree.children![0]!.children!;
  };

  it('links the path in a sentence, without the full stop after it', () => {
    const nodes = linked(paragraph({ type: 'text', value: 'The batch is at /dashboard/p/seo-pages?batch=506.' }));

    expect(nodes).toEqual([
      { type: 'text', value: 'The batch is at ' },
      { type: 'link', url: '/dashboard/p/seo-pages?batch=506', children: [{ type: 'text', value: 'Seo pages · batch 506' }] },
      { type: 'text', value: '.' },
    ]);
  });

  it('links a workspace path and a path in inline code, and leaves links and other code alone', () => {
    expect(linked(paragraph({ type: 'text', value: 'see /w/fernhill/dashboard/teams/seo' }))[1]).toMatchObject({ type: 'link', url: '/w/fernhill/dashboard/teams/seo' });
    expect(linked(paragraph({ type: 'inlineCode', value: '/dashboard/goals/12' }))[0]).toMatchObject({ type: 'link', url: '/dashboard/goals/12' });
    expect(linked(paragraph({ type: 'inlineCode', value: 'GET /dashboard/goals/12' }))[0]).toMatchObject({ type: 'inlineCode' });

    const link: Node = { type: 'link', url: '/dashboard/goals/12', children: [{ type: 'text', value: '/dashboard/goals/12' }] };

    expect(linked(paragraph(link))[0]).toEqual(link);
    expect(linked(paragraph({ type: 'text', value: 'the docs at https://example.test/dashboard/x' }))).toHaveLength(1);
  });

  it('names the route in its own words', () => {
    expect(appPathLabel('/dashboard/agents/seo-strategist')).toBe('Agents › seo strategist');
    expect(appPathLabel('/dashboard')).toBe('Dashboard');
  });
});
