/**
 * THE DRAFT RUN CANNOT GO LIVE: the engine, not the prompt, decides. A real
 * browser drives the practice blog editor (fictional, served in the browser;
 * `services/browser/practiceBlog.ts`) under the draft run's approval
 * (`DRAFT_APPROVED_AHEAD`), with a scripted model standing in for the real
 * one, so each test is the exact clicks a model could try.
 */
import type { BrowserSession } from '@/services/browser/browserEngine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowserSession, openBrowserSession } from '@/services/browser/browserEngine';
import { runBrowserLoop } from '@/services/browser/browserLoop';
import { PRACTICE_BLOG_ORIGIN } from '@/services/browser/practiceBlog';
import { DRAFT_APPROVED_AHEAD } from './squarespaceTask';

type Call = { name: string; args: Record<string, unknown> };

/**
 * A model that takes the scripted steps in order, finding each element's ref in the page it is shown.
 * @param steps - Each step: a tool and its args, or a function of the page that returns one.
 */
function scripted(steps: Array<(page: string) => Call>) {
  let n = 0;
  const invoke = async (messages: Array<{ content: unknown }>) => {
    const page = messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const step = steps[Math.min(n, steps.length - 1)]!(page);
    n += 1;
    return { content: '', tool_calls: [{ id: `c${n}`, name: step.name, args: { why: 'scripted', ...step.args } }] };
  };
  return { bindTools: () => ({ invoke }) } as never;
}

/**
 * The ref of the element with this role and name on the page shown.
 * @param page - The snapshot text.
 * @param role - The role.
 * @param name - The accessible name.
 */
function ref(page: string, role: string, name: string): string {
  const line = page.split('\n').find(l => l.includes(`${role} "${name}"`) && l.includes('[ref='));
  const m = line?.match(/\[ref=(\w+)\]/);
  if (!m) {
    throw new Error(`no ${role} "${name}" on the page`);
  }
  return m[1]!;
}

const POSTS = [
  { id: 'p2', title: 'Tent stakes', slug: 'tent-stakes', status: 'Draft', body: '<p>Draft.</p>', excerpt: '', seoTitle: '', seoDescription: '' },
  { id: 'p3', title: 'Trail food', slug: 'trail-food', status: 'Published', body: '<p>Live.</p>', excerpt: '', seoTitle: '', seoDescription: '' },
];

let s: BrowserSession;
const KEY = 'draft-guard-test';

beforeAll(async () => {
  s = await openBrowserSession(KEY);
  await s.page.goto(`${PRACTICE_BLOG_ORIGIN}/`);
  await s.page.evaluate((posts) => {
    localStorage.setItem('nw.user', 'true');
    localStorage.setItem('nw.seenNew', 'true');
    localStorage.setItem('nw.posts', JSON.stringify(posts));
  }, POSTS);
}, 60_000);

afterAll(async () => {
  await closeBrowserSession(KEY);
});

async function run(startPath: string, steps: Array<(page: string) => Call>, answer: 'approved' | 'denied' = 'denied') {
  const waits: string[] = [];
  const labels: string[] = [];
  const out = await runBrowserLoop(scripted(steps), s, {
    task: 'Save the draft.',
    startUrl: `${PRACTICE_BLOG_ORIGIN}${startPath}`,
    inputs: {},
    secrets: {},
    outputs: [],
    continuing: false,
    approvedAhead: DRAFT_APPROVED_AHEAD,
  }, {
    now: () => Date.now(),
    stopped: () => false,
    charge: async () => {},
    step: async (st) => {
      labels.push(st.label);
    },
    wait: async (w) => {
      waits.push(w.text);
      return answer === 'approved' ? { kind: 'approved' } : { kind: 'denied', note: 'not in a draft run' };
    },
  });
  const posts = await s.page.evaluate(() => JSON.parse(localStorage.getItem('nw.posts') ?? '[]') as Array<{ id: string; status: string }>);
  return { out, waits, labels, posts };
}

describe('a Squarespace draft run, in the practice editor', () => {
  it('saves a draft without stopping, while the editor shows it as a draft', async () => {
    const r = await run('/config/pages/journal/p2', [
      page => ({ name: 'click', args: { ref: ref(page, 'button', 'Save') } }),
      () => ({ name: 'finish', args: { summary: 'Saved.', result: {} } }),
    ]);

    expect(r.waits).toEqual([]);
    expect(r.labels.some(l => l.startsWith('Approved ahead') && l.includes('Post · Draft'))).toBe(true);
    expect(r.posts.find(p => p.id === 'p2')!.status).toBe('Draft');
  }, 60_000);

  it('holds a choice of Published in the status menu, so Save keeps the draft', async () => {
    const r = await run('/config/pages/journal/p2', [
      page => ({ name: 'select_option', args: { ref: ref(page, 'combobox', 'Status'), value: 'Published' } }),
      page => ({ name: 'click', args: { ref: ref(page, 'button', 'Save') } }),
      () => ({ name: 'finish', args: { summary: 'Saved.', result: {} } }),
    ]);

    expect(r.waits).toHaveLength(1);
    expect(r.waits[0]).toMatch(/^Choose “Published”/);
    expect(r.posts.find(p => p.id === 'p2')!.status).toBe('Draft');
  }, 60_000);

  it('holds Save on a post the editor does not show as a draft, and holds PUBLISH always', async () => {
    const r = await run('/config/pages/journal/p3', [
      page => ({ name: 'click', args: { ref: ref(page, 'button', 'Save') } }),
      page => ({ name: 'click', args: { ref: ref(page, 'button', 'PUBLISH') } }),
      () => ({ name: 'finish', args: { summary: 'Done.', result: {} } }),
    ]);

    expect(r.labels).toContain('Not approved ahead: the page does not show “Post · Draft”');
    expect(r.waits).toHaveLength(2);
    expect(r.waits[0]).toMatch(/^Click “Save”/);
    expect(r.waits[1]).toMatch(/^Click “PUBLISH”/);
  }, 60_000);
});
