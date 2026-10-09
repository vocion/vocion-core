import type { ConnectPlan } from '@/libs/connect/systemsPlan';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import '@/styles/global.css';

/**
 * "Connect your systems", driven from the keyboard alone: the one question
 * (numbers toggle, Enter submits the recommended set), a login in its own
 * window, a key typed inline and sent to the vault, each verified before the
 * next, Esc to stop, and a summary of what each unlocks.
 */

const PLAN: ConnectPlan = {
  candidates: [
    { connector: 'crm', name: 'Northwind CRM', score: 100, recommended: true, evidence: [{ kind: 'app', app: 'gtm', appName: 'GTM', needed: true }], method: { kind: 'login', startHref: '/api/connect/crm/start?connector=crm&returnTo=%2Fdashboard%2Fconnect%2Fdone', providerLabel: 'Northwind CRM', settingsAfterLogin: [] }, unlocks: [{ app: 'gtm', appName: 'GTM', href: '/dashboard/apps/gtm', added: true, features: ['Pipeline review'] }] },
    { connector: 'tracker', name: 'Tracker', score: 40, recommended: true, evidence: [{ kind: 'mail', domain: 'northwind-traders.org' }], method: { kind: 'key', credentialLabel: 'API token', credentialFields: [{ name: 'apiKey', label: 'API token', secret: true, optional: false, hint: '' }], configFields: [], getItAt: null }, unlocks: [] },
    { connector: 'wiki', name: 'Wiki', score: 15, recommended: false, evidence: [{ kind: 'org', workspaces: 1 }], method: { kind: 'key', credentialLabel: 'API key', credentialFields: [{ name: 'apiKey', label: 'API key', secret: true, optional: false, hint: '' }], configFields: [], getItAt: null }, unlocks: [] },
  ],
  connected: [],
  question: { question: 'Which of these do you use?', options: ['crm', 'tracker', 'wiki'] },
  scope: null,
  refused: null,
};

const plan = vi.fn(async () => PLAN);
const saveKey = vi.fn(async () => ({ ok: true as const, sourceId: 5 }));
const verify = vi.fn(async ({ connector }: { connector: string }) => ({ state: 'verified' as const, preview: connector === 'crm' ? 'Found 1,284 deals' : 'Found 12 documents', checks: [] }));
const finish = vi.fn(async () => ({ marked: true }));
vi.mock('@/libs/Orpc', () => ({ client: { connectSystems: { plan, saveKey, verify, finish }, connect: { saveSource: vi.fn() } } }));

const { ConnectSystemsFlow } = await import('./ConnectSystemsFlow');

/** A login window that comes straight back connected, the way the scripted vendor does. */
function loginWindowThatSucceeds() {
  const popup = { closed: false, close: vi.fn(), location: { origin: window.location.origin, search: '?connect=ok&connector=crm' } };
  return vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConnectSystemsFlow, keyboard only', () => {
  it('asks once, connects a login and a key, verifies each, and ends on the summary', async () => {
    const open = loginWindowThatSucceeds();
    const onClose = vi.fn();
    await render(<ConnectSystemsFlow input={{}} decision={{ conversationId: 3, decisionId: 31 }} onClose={onClose} verifyBudgetMs={0} />);

    // The question, with the evidence-backed systems preselected.
    await expect.element(page.getByRole('heading', { name: 'Which of these do you use?' })).toBeVisible();
    await expect.element(page.getByTestId('decision-option-crm')).toHaveAttribute('aria-selected', 'true');
    await expect.element(page.getByTestId('decision-option-wiki')).toHaveAttribute('aria-selected', 'false');

    // 3 toggles Wiki on, 3 again off; Enter takes the recommended set.
    await userEvent.keyboard('3');

    await expect.element(page.getByTestId('decision-option-wiki')).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('3');
    await userEvent.keyboard('{Enter}');

    // One at a time, with the progress line.
    await expect.element(page.getByRole('heading', { name: 'Connect Northwind CRM?' })).toBeVisible();
    await expect.element(page.getByTestId('decision-queue')).toHaveTextContent('1 of 2');
    await expect.element(page.getByText('GTM needs it — Unlocks GTM: Pipeline review')).toBeVisible();

    await userEvent.keyboard('{Enter}');

    // The login opened in its own window, came back, and was checked before moving on.
    expect(open).toHaveBeenCalledWith(PLAN.candidates[0]!.method.kind === 'login' ? PLAN.candidates[0]!.method.startHref : '', 'vocion-connect', expect.any(String));
    await expect.element(page.getByRole('heading', { name: 'Connect Tracker?' })).toBeVisible();
    expect(verify).toHaveBeenCalledWith({ connector: 'crm' });
    await expect.element(page.getByTestId('decision-queue')).toHaveTextContent('2 of 2');

    // A key, typed inline: Enter on the option, type, Enter saves.
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByTestId('connect-field-apiKey')).toHaveAttribute('type', 'password');

    await userEvent.keyboard('trk-e2e-not-a-real-key');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByTestId('connect-summary')).toBeVisible();
    expect(saveKey).toHaveBeenCalledWith({ connector: 'tracker', config: {}, values: { apiKey: 'trk-e2e-not-a-real-key' } });

    // The summary: each with what it found and what it unlocks; never the key.
    await expect.element(page.getByRole('heading', { name: 'Connected 2 of 2.' })).toBeVisible();
    await expect.element(page.getByTestId('connect-summary-crm')).toHaveTextContent('Found 1,284 deals');
    await expect.element(page.getByTestId('connect-summary-crm')).toHaveTextContent('GTM: Pipeline review');
    expect(document.body.textContent).not.toContain('trk-e2e-not-a-real-key');

    await userEvent.keyboard('{Enter}');

    expect(finish).toHaveBeenCalledWith({ conversationId: 3, decisionId: 31, summary: 'Connected Northwind CRM, Tracker.' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Later, then Esc stops the walk and leaves the rest for later', async () => {
    plan.mockResolvedValueOnce({ ...PLAN, question: null });
    await render(<ConnectSystemsFlow input={{ named: ['crm', 'tracker', 'wiki'] }} onClose={vi.fn()} verifyBudgetMs={0} />);

    await expect.element(page.getByRole('heading', { name: 'Connect Northwind CRM?' })).toBeVisible();
    await expect.element(page.getByTestId('decision-queue')).toHaveTextContent('1 of 3');

    // 2 is Later.
    await userEvent.keyboard('2');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByRole('heading', { name: 'Connect Tracker?' })).toBeVisible();

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('heading', { name: 'Connected 0 of 3.' })).toBeVisible();
    await expect.element(page.getByTestId('connect-summary-crm')).toHaveAttribute('data-outcome', 'later');
    await expect.element(page.getByTestId('connect-summary-wiki')).toHaveAttribute('data-outcome', 'later');
    await expect.element(page.getByText('Connect the 3 I put off')).toBeVisible();
  });

  it('leads every step with the lead\'s own line, not only the first; a step with none shows its evidence', async () => {
    plan.mockResolvedValueOnce({ ...PLAN, question: null });
    await render(
      <ConnectSystemsFlow
        input={{ named: ['crm', 'tracker', 'wiki'], say: { crm: 'Your pipeline review reads every Northwind deal from here.', tracker: 'Agents tried to file the Kestrel bug here twice this week.' } }}
        intro="Three systems, then the factory can run."
        onClose={vi.fn()}
        verifyBudgetMs={0}
      />,
    );

    await expect.element(page.getByRole('heading', { name: 'Connect Northwind CRM?' })).toBeVisible();
    await expect.element(page.getByText('Your pipeline review reads every Northwind deal from here.')).toBeVisible();

    await userEvent.keyboard('2');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByRole('heading', { name: 'Connect Tracker?' })).toBeVisible();
    await expect.element(page.getByText('Agents tried to file the Kestrel bug here twice this week.')).toBeVisible();

    await userEvent.keyboard('2');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByRole('heading', { name: 'Connect Wiki?' })).toBeVisible();
    await expect.element(page.getByText('Used in another workspace of your Org')).toBeVisible();
  });

  it('says when the login window was blocked, on the system, with Try again first', async () => {
    plan.mockResolvedValueOnce({ ...PLAN, question: null, candidates: [PLAN.candidates[0]!] });
    vi.spyOn(window, 'open').mockReturnValue(null);
    await render(<ConnectSystemsFlow input={{ named: ['crm'] }} onClose={vi.fn()} />);

    await expect.element(page.getByRole('heading', { name: 'Connect Northwind CRM?' })).toBeVisible();

    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByRole('heading', { name: 'Northwind CRM did not connect' })).toBeVisible();
    await expect.element(page.getByText(/blocked the login window/)).toBeVisible();
    await expect.element(page.getByTestId('decision-option-retry')).toHaveAttribute('aria-selected', 'true');
  });
});
