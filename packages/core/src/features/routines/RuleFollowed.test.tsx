import type { BrowserRunView as Run } from '@/libs/browser/run';
import type { RoutineView as Routine } from '@/libs/routines/types';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * A RULE PAYING OFF, where the evidence is: the run pane's step says which rule decided instead
 * of asking and links to the answer it came from; the automation's version history counts the runs
 * that followed each rule since. A rule with no source still reads, smaller. Screenshots land in
 * `VITE_SHOTS_DIR` when it is set.
 */

const SHOTS = (import.meta.env as unknown as Record<string, string | undefined>).VITE_SHOTS_DIR;
const shotTo = async (name: string) => {
  if (SHOTS) {
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
};

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/browser/902',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/hooks/useLive', () => ({ useLive: () => ({ live: false, state: 'idle' }) }));
vi.mock('@/libs/Orpc', () => ({
  client: {
    routines: { get: async () => ({ routine: null, batches: [] }), act: async () => ({ routine: null, error: null }) },
    browser: { get: async () => ({ run: null }), act: async () => ({ run: null }) },
  },
}));

const { BrowserRunView } = await import('@/features/browser/BrowserRunView');
const { RoutineView } = await import('./RoutineView');

const LMFT = 'LMFTs go through Hospital and other providers.';
const TAX = 'Type the tax ID by hand, in the group section and in the attestation.';
const at = new Date().toISOString();

function shot(title: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#f7f7f9"/><rect width="640" height="44" fill="#2f5d50"/><text x="20" y="28" font-family="sans-serif" font-size="16" fill="#fff">Larkspur Health Plan</text><text x="20" y="88" font-family="sans-serif" font-size="18" fill="#222">${title}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const RUN: Run = {
  id: 902,
  status: 'done',
  task: 'Submit a Larkspur group application for Cedar Hollow Counseling Group, LLC.',
  startUrl: 'https://larkspur.example/join',
  inputs: { group: { value: 'Cedar Hollow Counseling Group, LLC' } },
  outputs: [{ name: 'route', description: 'The provider path used' }],
  result: { route: 'Hospital and other providers' },
  summary: 'Filled in the application for Ruth Calloway and stopped for approval before Submit application.',
  steps: [
    { n: 1, at, kind: 'open', label: 'Opened https://larkspur.example/join', ok: true },
    { n: 2, at, kind: 'click', label: 'Clicked “Hospital and other providers”', why: 'Where the onboarding form lives', ok: true, shotUrl: shot('Hospital and other providers') },
    { n: 3, at, kind: 'rule', label: `Followed Marcus’s rule (v3): ${LMFT}`, why: 'Ruth Calloway (LMFT) goes through Hospital and other providers', ok: true, shotUrl: shot('Provider Onboarding Form'), rule: { n: 5, text: LMFT, from: { askId: 41, by: 'Marcus Hale', version: 3 } } },
    { n: 4, at, kind: 'rule', label: `Followed the automation’s rule: ${TAX}`, why: 'Typed 00-4417302 twice', ok: true, rule: { n: 1, text: TAX } },
    { n: 5, at, kind: 'finish', label: 'Finished', ok: true },
  ],
  waiting: null,
  error: null,
  url: 'https://larkspur.example/apply/review',
  title: 'Review and submit',
  frameSeq: 1,
  live: false,
  finalShotUrl: shot('Review and submit'),
  videoUrl: null,
  proposedBy: 'routine:larkspur-application',
  agentSlug: null,
  conversationId: null,
  cents: 41,
  isolation: 'remote',
  resumes: 0,
  resuming: false,
  startedAt: at,
  endedAt: at,
  createdAt: at,
};

describe('the run pane', () => {
  it('says which rule decided a step instead of asking, and links to the answer it came from', async () => {
    await page.viewport(1440, 1100);
    await render(<div className="w-[460px] bg-background p-4 text-foreground"><BrowserRunView initial={RUN} compact /></div>);

    const step = document.querySelector('[data-browser-step-rule="5"]')!;

    expect(step.textContent).toContain(`Followed Marcus’s rule (v3): ${LMFT}`);
    expect(step.textContent).toContain('Ruth Calloway (LMFT) goes through Hospital and other providers');
    expect(step.querySelector('[data-browser-step-rule-source]')?.getAttribute('href')).toBe('/dashboard/inbox/41');
    expect(step.querySelector('[data-browser-step-rule-source]')?.textContent).toBe('Marcus’s answer');

    // A rule with no source: the same row, no link line, no blank.
    const plain = document.querySelector('[data-browser-step-rule="1"]')!;

    expect(plain.textContent).toContain(`Followed the automation’s rule: ${TAX}`);
    expect(plain.querySelector('[data-browser-step-rule-source]')).toBeNull();
    expect(plain.textContent).not.toMatch(/undefined|null|not recorded/i);

    document.querySelectorAll('details').forEach((d) => {
      d.open = true;
    });
    await shotTo('rule-run-pane');
    document.documentElement.classList.add('dark');
    await shotTo('rule-run-pane-dark');
    document.documentElement.classList.remove('dark');
  });
});

const SPEC = {
  summary: 'Fill in the onboarding form for one group and stop before Submit application.',
  startUrl: 'https://larkspur.example/join',
  systems: ['larkspur.example'],
  inputs: [{ name: 'group', description: 'The group', key: true }],
  outputs: [{ name: 'route', description: 'The provider path used' }],
  preconditions: [],
  steps: [{ n: 1, text: 'Open Hospital and other providers', at: 109 }],
  rules: [{ text: TAX, at: 348 }, { text: LMFT, at: null, from: { askId: 41, by: 'Marcus Hale', on: at, version: 3 } }],
  escalations: [],
  prohibited: [],
  postconditions: [],
  writes: [],
  reconcile: null,
  questions: [],
  manualMinutes: 30,
};

const ROUTINE: Routine = {
  id: 7,
  slug: 'larkspur-application',
  name: 'Submit a Larkspur group application',
  description: 'For one group, fill in the onboarding form and stop before it submits.',
  status: 'live',
  trust: 'approved',
  expert: { userId: 'u1', name: 'Marcus Hale' },
  source: null,
  version: { n: 3, status: 'approved', spec: SPEC, task: '', workflowYaml: '', change: 'The expert added a rule.', approvedBy: 'Marcus Hale', approvedAt: at, createdAt: at },
  draft: null,
  versions: [
    { n: 3, status: 'approved', change: `The expert added a rule: ${LMFT}`, createdAt: at, rules: [{ text: LMFT, from: { askId: 41, by: 'Marcus Hale', on: at, version: 3 }, runs: 1, recent: [{ browserRunId: 902, label: 'Cedar Hollow Counseling Group, LLC', decided: 'Ruth Calloway (LMFT) goes through Hospital and other providers' }] }] },
    { n: 2, status: 'superseded', change: 'Marcus reviewed the analyst’s draft.', createdAt: at, rules: [{ text: TAX, from: null, runs: 4, recent: [{ browserRunId: 899, label: 'Oak Park', decided: null }, { browserRunId: 900, label: 'Naperville', decided: null }, { browserRunId: 901, label: 'Evanston', decided: null }] }] },
    { n: 1, status: 'superseded', change: null, createdAt: at },
  ],
  stats: { runs: 5, done: 5, escalated: 0, failed: 0, lastBatchId: 14 },
  teaching: null,
  savedInputs: [],
  error: null,
  createdAt: at,
  updatedAt: at,
};

describe('the automation page', () => {
  it('counts the runs that followed each rule since, linking to them, and says where the rule came from', async () => {
    await page.viewport(1440, 1800);
    await render(<div className="bg-background p-6 text-foreground"><RoutineView initial={ROUTINE} /></div>);

    const uses = [...document.querySelectorAll<HTMLElement>('[data-routine-rule-use]')];

    expect(uses).toHaveLength(2);
    // The change line already quotes the rule: the use says where it came from, not the rule again.
    expect(uses[0]!.textContent).not.toContain(`Rule: ${LMFT}`);
    expect(uses[0]!.textContent).toContain('From Marcus’s answer');
    expect(uses[1]!.textContent).toContain(`Rule: ${TAX}`);
    expect(uses[0]!.textContent).toContain('Followed in 1 run since, without asking');
    expect(uses[0]!.querySelector('a[href="/dashboard/inbox/41"]')?.textContent).toBe('Marcus’s answer');
    expect(uses[0]!.querySelector('[data-routine-rule-run="902"]')?.getAttribute('href')).toBe('/dashboard/browser/902');

    // A rule taught from the recording: no source words, its count and the newest runs, the rest counted.
    expect(uses[1]!.textContent).toContain('Followed in 4 runs since');
    expect(uses[1]!.textContent).toContain('and 1 more');
    expect(uses[1]!.querySelector('a[href^="/dashboard/inbox"]')).toBeNull();

    // In the spec, the added rule names its source in place of a moment on the recording.
    expect(document.querySelector('[data-routine-rule-from]')?.textContent).toBe('Marcus’s answer · v3');

    await shotTo('rule-versions');
  });
});
