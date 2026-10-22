import type { RoutineBatchView as Batch, RoutineView as Routine, RoutineRunStatus, RoutineRunView } from '@/libs/routines/types';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/** Where the look-at screenshots go: outside the tree. */
const SHOTS = (import.meta.env as unknown as Record<string, string | undefined>).VITE_SHOTS_DIR;
const shotTo = async (name: string) => {
  if (SHOTS) {
    // Let pictures load and colour transitions settle first.
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
};

/**
 * The routine surfaces in a real browser: the batch queue keeps every tile the
 * same size whatever its run is doing (a waiting tile adds its answers in
 * place of its lines, never below them), and the routine page draws its spec
 * and its teaching state. Screenshots land in `vitest-test-results/` for a
 * look at light and dark.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/routines/batches/3',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/hooks/useLive', () => ({ useLive: () => ({ live: false, state: 'idle' }) }));
vi.mock('@/libs/Orpc', () => ({
  client: {
    routines: { batch: async () => ({ batch: null }), get: async () => ({ routine: null, batches: [] }), act: async () => ({ routine: null, error: null }), answer: async () => ({ batch: null, error: null }), finding: async () => ({ batch: null, error: null }), report: async () => ({ report: null, error: null }) },
    browser: { get: async () => ({ run: null }) },
  },
}));

const { RoutineBatchView } = await import('./RoutineBatchView');
const { RoutineView } = await import('./RoutineView');

/**
 * A fictional console page, as a run's last picture.
 * @param hue
 * @param title
 */
function shot(hue: number, title: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#f7f7f9"/><rect width="640" height="44" fill="hsl(${hue} 45% 32%)"/><text x="20" y="28" font-family="sans-serif" font-size="16" fill="#fff">Lumen Awareness - Console</text><rect x="20" y="64" width="160" height="316" rx="6" fill="#ececf1"/><text x="200" y="88" font-family="sans-serif" font-size="18" fill="#222">${title}</text>${[0, 1, 2, 3, 4].map(i => `<rect x="200" y="${110 + i * 44}" width="420" height="32" rx="4" fill="#fff" stroke="#ddd"/>`).join('')}<rect x="520" y="340" width="100" height="32" rx="6" fill="hsl(${hue} 60% 45%)"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const PEOPLE = ['Avery Lin', 'Jordan Pike', 'Sam Okafor', 'Riley Chen', 'Morgan Diaz', 'Casey Byrne', 'Taylor Brooks', 'Jamie Ford', 'Drew Patel', 'Quinn Moss', 'Rowan Hale', 'Emery Stone', 'Harper Vale', 'Skyler Reed', 'Parker Lowe', 'Reese Grant', 'Finley Shaw', 'Logan Price', 'Blake Wynn', 'Dakota Cole'];
const STATUSES: RoutineRunStatus[] = ['done', 'done', 'running', 'waiting', 'done', 'escalated', 'running', 'done', 'queued', 'failed', 'done', 'done', 'running', 'done', 'skipped', 'done', 'running', 'queued', 'done', 'done'];

function run(n: number): RoutineRunView {
  const status = STATUSES[n - 1]!;
  const name = PEOPLE[n - 1]!;
  const email = `${name.split(' ')[0]!.toLowerCase()}@northwind.example`;
  const started = new Date(Date.now() - (300 - n * 9) * 1000).toISOString();
  const done = status === 'done';
  return {
    id: 100 + n,
    batchId: 3,
    n,
    label: `${name} · Q4 Phishing Refresher`,
    status,
    input: { email, full_name: name, campaign: 'Q4 Phishing Refresher' },
    browserRunId: status === 'queued' ? null : 500 + n,
    browser: status === 'queued' ? null : { status, step: status === 'running' ? 'Typed the email into Add user' : 'Saved the enrollment', why: status === 'running' ? 'New users are created before they can be enrolled' : null, steps: 4 + (n % 7), live: false, frameSeq: n, url: 'https://console.lumen.example/users', finalShotUrl: shot((n * 37) % 360, done ? 'Enrolled' : 'Add user') },
    waiting: status === 'waiting'
      ? { kind: 'question', text: 'A user with this email already exists but is deactivated. Reactivate them or create a new account?', options: ['Reactivate', 'Create new', 'Skip'], askId: 41 }
      : status === 'escalated'
        ? { kind: 'escalation', text: 'Already enrolled in Q4 Phishing Refresher — re-enroll resets their progress.', options: ['Leave as is', 'Re-enroll'], askId: 42 }
        : null,
    receipt: done ? { requested: { email, campaign: 'Q4 Phishing Refresher' }, before: 'No user with this email', after: { email, campaign: 'Q4 Phishing Refresher' }, checks: [{ name: 'email', expected: email, actual: email, ok: true }, { name: 'campaign', expected: 'Q4 Phishing Refresher', actual: 'Q4 Phishing Refresher', ok: true }], verified: true, approvedBy: 'the approved spec', at: new Date().toISOString() } : null,
    summary: done ? `Added ${name} and enrolled them.` : null,
    error: status === 'failed' ? 'The console signed out mid-save; nothing was written.' : null,
    humanMs: 0,
    cents: 6,
    startedAt: status === 'queued' ? null : started,
    endedAt: done || status === 'failed' || status === 'skipped' ? new Date(Date.parse(started) + 95_000).toISOString() : null,
  };
}

const runs = Array.from({ length: 20 }, (_, i) => run(i + 1));
const counts = runs.reduce<Partial<Record<RoutineRunStatus, number>>>((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {});

const BATCH: Batch = {
  id: 3,
  routine: { id: 7, name: 'Add a user and enroll them', version: 2, trust: 'approved', expert: 'Dana Reyes' },
  requestedBy: 'Chris',
  conversationId: null,
  status: 'running',
  counts,
  total: 20,
  cents: 118,
  humanMs: 140_000,
  manualMinutes: 6,
  startedAt: new Date(Date.now() - 310_000).toISOString(),
  endedAt: null,
  runs,
  findings: [{ id: 'f1', kind: 'not_on_list', title: '3 people in the console are not on the roster', detail: 'They have active accounts but are not in the employee list this batch was given. Deactivate them, or leave them?', items: [{ name: 'Pat Quill', email: 'pat@northwind.example', status: 'Active' }, { name: 'Lee Marsh', email: 'lee@northwind.example', status: 'Active' }, { name: 'Robin Fair', email: 'robin@northwind.example', status: 'Active' }], askId: 43, options: ['Deactivate them', 'Delete them', 'Leave them'], state: 'open', answer: null, followUpBatchId: null }],
  report: null,
};

const ROUTINE: Routine = {
  id: 7,
  slug: 'add-user-enroll',
  name: 'Add a user and enroll them',
  description: 'Create the user in the training console if they are new, then enroll them in the named campaign.',
  status: 'in_review',
  trust: 'drafted',
  expert: { userId: 'u1', name: 'Dana Reyes' },
  source: { kind: 'slate', url: 'https://slate.example/v/abc123', title: 'Adding a user in the console', durationSec: 212 },
  version: null,
  draft: null,
  versions: [{ n: 1, status: 'draft', change: null, createdAt: new Date().toISOString() }],
  stats: { runs: 0, done: 0, escalated: 0, failed: 0, lastBatchId: null },
  teaching: null,
  savedInputs: [],
  error: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const VERSION = {
  n: 1,
  status: 'draft' as const,
  task: '',
  workflowYaml: 'name: add-user-enroll\nsteps:\n  - open: https://console.lumen.example/users\n',
  change: null,
  approvedBy: null,
  approvedAt: null,
  createdAt: new Date().toISOString(),
  spec: {
    summary: 'Adds a person to the training console when they are not there yet, then enrolls them in a campaign and reads both back.',
    startUrl: 'https://console.lumen.example/users',
    systems: ['console.lumen.example'],
    inputs: [{ name: 'email', description: 'Work address', example: 'avery@northwind.example', key: true }, { name: 'full_name', description: 'As on the roster', example: 'Avery Lin' }, { name: 'campaign', description: 'Campaign to enroll in', example: 'Q4 Phishing Refresher', key: true }, { name: 'console_password', description: 'Admin sign-in', secret: true }],
    outputs: [{ name: 'user_email', description: 'The user as saved', checks: 'email' }, { name: 'enrolled_in', description: 'The campaign on their profile', checks: 'campaign' }],
    preconditions: ['Signed in as an admin'],
    steps: [{ n: 1, text: 'Search Users for the email', why: 'A person may already have an account', at: 14 }, { n: 2, text: 'If not found, click Add user and fill name and email', why: 'Enrollment needs an account first', at: 41 }, { n: 3, text: 'Open Campaigns › the campaign › Enroll', why: null, at: 97 }],
    rules: [{ text: 'Never create a second account for an email that exists', at: 52 }],
    escalations: [{ when: 'the person is already enrolled', ask: 'whether to re-enroll and reset their progress', at: 130 }],
    prohibited: ['Delete or deactivate a user'],
    postconditions: ['The user exists with this email', 'They are enrolled in the campaign'],
    writes: [{ button: 'Save user', host: 'console.lumen.example' }, { button: 'Enroll' }],
    reconcile: { listUrl: 'https://console.lumen.example/users', how: 'Reads every active user in the console and compares with the roster.', matchOn: 'email' },
    questions: [{ id: 'q1', question: 'Should contractors be enrolled too?', why: 'The recording showed only employees.', at: 160 }, { id: 'q2', question: 'Which campaign when none is named?', at: null, answer: 'Q4 Phishing Refresher', answeredBy: 'Dana Reyes' }],
    manualMinutes: 6,
  },
};

describe('the batch queue', () => {
  it('draws 20 tiles of one size, the waiting ones with their answers, and the finding', async () => {
    await page.viewport(1440, 1500);
    const screen = await render(<div className="bg-background p-6 text-foreground"><RoutineBatchView initial={BATCH} /></div>);
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-routine-run]')];

    expect(tiles).toHaveLength(20);

    const heights = new Set(tiles.map(t => Math.round(t.getBoundingClientRect().height)));
    const widths = new Set(tiles.map(t => Math.round(t.getBoundingClientRect().width)));

    expect(heights.size).toBe(1);
    expect(widths.size).toBe(1);
    expect(document.querySelectorAll('[data-tile-option]').length).toBe(5);
    expect(document.querySelector('[data-routine-finding="f1"]')).not.toBeNull();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

    await shotTo('batch-desktop');
    document.documentElement.classList.add('dark');
    await shotTo('batch-desktop-dark');
    document.documentElement.classList.remove('dark');
    screen.unmount();
  });

  it('fits a phone without scrolling sideways', async () => {
    await page.viewport(390, 1400);
    await render(<div className="bg-background p-4 text-foreground"><RoutineBatchView initial={BATCH} /></div>);

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);

    await shotTo('batch-phone');
  });

  it('draws compact in the pane', async () => {
    await page.viewport(1440, 1000);
    await render(<div className="w-[460px] bg-background p-4 text-foreground"><RoutineBatchView initial={BATCH} compact /></div>);
    await shotTo('batch-pane');
  });
});

describe('the routine', () => {
  it('draws the spec in review, its questions and Run it', async () => {
    await page.viewport(1440, 2300);
    await render(<div className="bg-background p-6 text-foreground"><RoutineView initial={{ ...ROUTINE, version: VERSION, draft: null }} batches={[{ id: 3, status: 'running', total: 20, counts, startedAt: BATCH.startedAt, endedAt: null }]} /></div>);

    expect(document.querySelectorAll('[data-routine-steps] li')).toHaveLength(3);
    expect(document.querySelector('[data-routine-approve]')?.textContent).toContain('Approve version 1');
    expect(document.querySelectorAll('[data-moment]').length).toBeGreaterThan(3);

    await shotTo('routine-desktop');
  });

  it('draws teaching while it waits for the recording', async () => {
    await page.viewport(1440, 900);
    await render(<div className="w-[460px] bg-background p-4 text-foreground"><RoutineView initial={{ ...ROUTINE, status: 'teaching', teaching: { state: 'waiting_for_recording', startedAt: new Date(Date.now() - 120_000).toISOString(), targetUrl: 'https://console.lumen.example', recordUrl: 'https://slate.example/record', instruction: 'Press ⌥⇧R (Alt+Shift+R) or the Slate button on the console tab, choose that tab, then do the task while saying what you are doing and why; press Stop when it is done.', checks: 14, lastCheckedAt: new Date().toISOString() } }} compact /></div>);

    expect(document.querySelector('[data-routine-teaching="waiting_for_recording"]')).not.toBeNull();

    await shotTo('teaching-pane');
  });
});
