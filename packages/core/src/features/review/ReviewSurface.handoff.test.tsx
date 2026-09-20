/**
 * The hand-off card, read the way Chris read the first one — on a phone,
 * wanting to know what it does, how much it costs, whether it can be undone,
 * who runs it, and which button does what (2026-09-20, action run 781).
 *
 * Three states of one run: pending (Approve), approved and waiting for a
 * person (Mark done), and done (read-only, with who did it and where the
 * result is). Everything asserted here is composed by the shell from the
 * card's `headline` / `badges` / `handoff` and the run's status and trail,
 * so no presenter can rearrange it.
 */
import type { ReviewCardRun } from './ReviewSurface';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

vi.mock('@/libs/Orpc', () => ({
  client: { review: { decideAction: vi.fn(async () => ({ execution: null })), snoozeAction: vi.fn(), regenerateAction: vi.fn(), actionStatus: vi.fn() } },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/inbox',
}));

const { ReviewSurface } = await import('./ReviewSurface');

const CRUMBS = [{ label: 'Workspace' }, { label: 'Review' }, { label: 'Approvals' }];

const STEPS = [
  { say: 'Register the domain in the account.', run: 'aws route53domains register-domain --domain-name kestrel-capital.example --duration-in-years 1', url: 'https://console.aws.example/route53' },
  { say: 'Wait for the registration email and confirm it.' },
  { say: 'Point the hosted zone at the marketing site.', run: 'aws route53 change-resource-record-sets --hosted-zone-id Z0FIXTURE --change-batch file://records.json' },
];

/**
 * The domain registration as the presenter builds it, in whichever state.
 * @param over - The run fields under test.
 */
function handoff(over: Partial<ReviewCardRun> = {}): ReviewCardRun {
  return {
    id: 781,
    actionId: 'aws.mutate',
    status: 'pending',
    input: {},
    invokedBy: 'agent:send-lead',
    proposal: {
      confidence: 0.9,
      rationale: 'The rename needs the domain before the marketing site can move, and the name is free today.',
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'Fourteen dollars a year and nothing depends on it yet.',
      evidence: [],
    },
    people: { usr_rowan: 'Rowan Pike' },
    card: {
      title: 'Register kestrel-capital.example in Route 53 for the Kestrel rename',
      system: 'Deploy',
      object: { title: 'Register kestrel-capital.example in Route 53 for the Kestrel rename', section: 'Approvals' },
      headline: 'Buy kestrel-capital.example in the acme-prod account so the marketing site can move.',
      badges: [
        { label: 'Deploy' },
        { label: 'Irreversible', tone: 'warn' },
        { label: '$14/year' },
        { label: 'AWS account acme-prod (123456789012)' },
      ],
      handoff: { reversible: false },
      summary: 'Buy kestrel-capital.example in the acme-prod account so the marketing site can move. The registration is a year at a time and cannot be refunded once it goes through.',
      contentHeading: { label: 'Recipe' },
      content: [{ kind: 'steps', id: 'recipe', label: 'Recipe', steps: STEPS }],
      fields: [],
      links: [
        { label: 'Route 53 pricing', href: 'https://aws.example/route53/pricing' },
        { label: 'github.com/acme/site/issues/12', href: 'https://github.com/acme/site/issues/12' },
      ],
      nextAction: 'Approving hands this to a person to do. Nothing runs here; whoever does it marks it done, and the run records who and when.',
      verbs: { approve: 'Approve', reject: 'Reject' },
    },
    ...over,
  };
}

const barLabels = () => [...page.getByTestId('sticky-action-bar').element().querySelectorAll('button')]
  .map(b => (b.querySelector('span')?.textContent ?? b.textContent ?? '').trim());

describe('the hand-off card, pending', () => {
  it('leads with the sentence and the badges, then the recommendation once, before any tab', async () => {
    await render(<ReviewSurface run={handoff()} crumbs={CRUMBS} />);

    const header = page.getByTestId('decision-header').element();

    expect(header.textContent).toContain('Buy kestrel-capital.example in the acme-prod account so the marketing site can move.');

    // The header comes before the tab row in reading order.
    const tabs = page.getByTestId('review-tabs').element();

    expect(header.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const badges = [...page.getByTestId('decision-badges').element().querySelectorAll('[data-slot="badge"]')];

    expect(badges.map(b => b.textContent)).toEqual(['Deploy', 'Irreversible', '$14/year', 'AWS account acme-prod (123456789012)']);
    expect(badges[1]!.getAttribute('data-tone')).toBe('warn');

    await expect.element(page.getByTestId('decision-recommendation')).toHaveTextContent('send-lead suggests approving · 90% confident');
  });

  it('reads Approve, Reject and Snooze — in words, on a phone too', async () => {
    await page.viewport(390, 844);
    await render(<ReviewSurface run={handoff()} crumbs={CRUMBS} />);

    expect(barLabels()).toEqual(['Add a note', 'Reject', 'Snooze', 'Approve']);

    // The word, not the icon alone: the label span carries no sr-only class
    // and is laid out with a width.
    for (const id of ['decide-reject', 'decide-snooze']) {
      const label = page.getByTestId(id).element().querySelector('span')!;

      expect(label.className).not.toContain('sr-only');
      expect(label.getBoundingClientRect().width).toBeGreaterThan(0);
    }
    await page.viewport(1440, 900);
  });

  it('shows the steps numbered, each command in its own block with a copy button, each link openable', async () => {
    await render(<ReviewSurface run={handoff()} crumbs={CRUMBS} />);

    const labels = [...page.getByTestId('review-tabs').element().querySelectorAll('[data-slot="tabs-trigger"]')].map(t => t.textContent);

    expect(labels).toEqual(['Recipe', 'Why', 'Evidence']);
    await expect.element(page.getByTestId('steps-pane-recipe')).toBeVisible();

    expect(page.getByTestId('command-block').elements()).toHaveLength(2);
    expect(page.getByTestId('copy-command').elements()).toHaveLength(2);
    expect(page.getByTestId('step-1').element().textContent).toContain('Register the domain in the account.');
    expect(page.getByTestId('step-1').element().querySelector('pre')!.textContent).toBe(STEPS[0]!.run);
    expect(page.getByTestId('step-1').element().querySelector('a')!.getAttribute('href')).toBe('https://console.aws.example/route53');
    expect(page.getByTestId('step-2').element().querySelector('pre')).toBeNull();
  });

  it('has ONE Why, with the suggestion inline, rather than the reasoning beside why it suggests that', async () => {
    await render(<ReviewSurface run={handoff()} crumbs={CRUMBS} />);

    await page.getByTestId('tab-why').click();

    await expect.element(page.getByTestId('why-merged')).toBeVisible();

    const why = page.getByTestId('why-pane').element();

    expect(why.querySelectorAll('[data-pattern="section"]')).toHaveLength(1);
    expect(why.textContent).toContain('The rename needs the domain before the marketing site can move, and the name is free today.');
    expect(why.textContent).not.toContain('The reasoning');
    expect(why.textContent).not.toContain('Why it suggests that');
    expect(page.getByTestId('suggested-decision-reason').elements()).toHaveLength(0);
    await expect.element(page.getByTestId('why-suggestion')).toHaveTextContent('send-lead suggests approving · 90% confident · Fourteen dollars a year and nothing depends on it yet.');
  });

  it('renders the named sources as links, and says the recommendation nowhere else', async () => {
    await render(<ReviewSurface run={handoff()} crumbs={CRUMBS} />);

    await page.getByTestId('tab-evidence').click();

    const pricing = page.getByRole('link', { name: 'Route 53 pricing ↗' });

    await expect.element(pricing).toBeVisible();
    expect(pricing.element().getAttribute('href')).toBe('https://aws.example/route53/pricing');

    const details = page.getByTestId('run-details').element();

    expect(details.textContent).not.toContain('Recommended by');
    expect(details.textContent).not.toContain('Agent suggests');
    expect(details.querySelector('[data-testid="confidence-meter"]')).toBeNull();
    expect(details.textContent).not.toContain('Can be put back');
    expect(details.textContent).toContain('Deploy');
    expect(details.textContent).toContain('#781');
  });

  it('says who runs it and where the run stands: Approve is the current step', async () => {
    await render(<ReviewSurface run={handoff()} crumbs={CRUMBS} />);

    await page.getByTestId('tab-evidence').click();

    await expect.element(page.getByTestId('who-runs-it')).toHaveTextContent('Anyone with the account; mark done when finished');

    const steps = [...page.getByTestId('handoff-lifecycle').element().querySelectorAll('li')];

    expect(steps.map(s => s.getAttribute('data-state'))).toEqual(['current', 'next', 'next']);
    expect(steps.map(s => s.querySelector('span > span')?.textContent)).toEqual(['Approve', 'A person runs the steps', 'Mark done']);
    expect(steps[0]!.getAttribute('aria-current')).toBe('step');
  });

  it('names the assignee when the queue routed it to someone', async () => {
    await render(<ReviewSurface run={handoff({ assignee: 'Rowan Pike' })} crumbs={CRUMBS} />);

    await page.getByTestId('tab-evidence').click();

    await expect.element(page.getByTestId('who-runs-it')).toHaveTextContent('Rowan Pike');
  });

  it('falls back to the recipe block when the proposer wrote no steps', async () => {
    const run = handoff();
    run.card.content = [{ kind: 'text', id: 'recipe', label: 'Recipe', body: 'aws route53domains register-domain --domain-name kestrel-capital.example', preformatted: true }];
    await render(<ReviewSurface run={run} crumbs={CRUMBS} />);

    await expect.element(page.getByTestId('text-pane-recipe')).toBeVisible();
    expect(page.getByTestId('steps-pane-recipe').elements()).toHaveLength(0);
  });
});

describe('the hand-off card, approved and waiting for a person', () => {
  const awaiting = () => handoff({
    status: 'awaiting_execution',
    decidedBy: 'usr_rowan',
    decidedAt: '2026-09-20T15:12:00.000Z',
    result: { handoff: { releasedBy: 'usr_rowan', releasedAt: '2026-09-20T15:12:00.000Z' } },
  });

  it('reads Mark done, offers the honest failure, and drops Snooze', async () => {
    await render(<ReviewSurface run={awaiting()} crumbs={CRUMBS} />);

    expect(barLabels()).toEqual(['Add a note', 'Could not be done', 'Mark done']);
  });

  it('moves the lifecycle on: Approve done by name, a person runs the steps current', async () => {
    await render(<ReviewSurface run={awaiting()} crumbs={CRUMBS} />);

    await page.getByTestId('tab-evidence').click();

    const steps = [...page.getByTestId('handoff-lifecycle').element().querySelectorAll('li')];

    expect(steps.map(s => s.getAttribute('data-state'))).toEqual(['done', 'current', 'next']);
    expect(steps[0]!.textContent).toContain('by Rowan Pike');
    expect(steps[0]!.textContent).toContain('Sep 20');
    expect(steps[1]!.getAttribute('aria-current')).toBe('step');
    await expect.element(page.getByTestId('run-details')).toHaveTextContent('Approved — waiting to be done');
  });
});

describe('the hand-off card, done', () => {
  const done = () => handoff({
    status: 'done',
    decidedBy: 'usr_rowan',
    decidedAt: '2026-09-20T15:12:00.000Z',
    executedAt: '2026-09-20T16:40:00.000Z',
    result: {
      handoff: { releasedBy: 'usr_rowan', releasedAt: '2026-09-20T15:12:00.000Z' },
      executed: { by: 'token:factory-worker', at: '2026-09-20T16:40:00.000Z', note: 'Registered; DNS propagating.', resultUrl: 'https://console.aws.example/route53/domains/kestrel-capital.example' },
    },
  });

  it('reads without a decision bar, every step done, with who marked it done, when, and the result', async () => {
    await render(<ReviewSurface run={done()} crumbs={CRUMBS} decidable={false} defaultTab="evidence" />);

    expect(page.getByTestId('sticky-action-bar').elements()).toHaveLength(0);

    const steps = [...page.getByTestId('handoff-lifecycle').element().querySelectorAll('li')];

    expect(steps.map(s => s.getAttribute('data-state'))).toEqual(['done', 'done', 'done']);
    expect(steps[2]!.textContent).toContain('by token:factory-worker');
    expect(steps[2]!.textContent).toContain('Sep 20');
    expect(steps[2]!.textContent).toContain('“Registered; DNS propagating.”');

    const result = page.getByTestId('handoff-result').element();

    expect(result.getAttribute('href')).toBe('https://console.aws.example/route53/domains/kestrel-capital.example');
    expect(result.textContent).toBe('console.aws.example/route53/domains/kestrel-capital.example');
  });
});

describe('a card without a headline', () => {
  it('renders as before: no decision header, the three recommendation rows still under Run details', async () => {
    const run = handoff();
    delete run.card.headline;
    delete run.card.badges;
    delete run.card.handoff;
    await render(<ReviewSurface run={run} crumbs={CRUMBS} />);

    expect(page.getByTestId('decision-header').elements()).toHaveLength(0);

    await page.getByTestId('tab-evidence').click();

    await expect.element(page.getByTestId('run-details')).toHaveTextContent('Recommended by');
    await expect.element(page.getByTestId('run-details')).toHaveTextContent('Agent suggests approving');
    expect(page.getByTestId('handoff-lifecycle').elements()).toHaveLength(0);
  });
});
