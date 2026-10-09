import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as renderBare } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import messages from '@/locales/en.json';

/**
 * Render inside the intl provider the panel's copy reads from.
 * @param ui - What to render.
 */
function render(ui: React.ReactElement) {
  return renderBare(<NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>);
}

/**
 * The add form offers what each connector declares (#1080): log in with the
 * vendor, or paste a token. Wrong here means a person is sent to log in at a
 * connector that only takes a pasted key, or sees a login they already made
 * asked for again.
 */

const addConnector = vi.fn();
const revealStoredCredential = vi.fn();
vi.mock('@/libs/Orpc', () => ({
  client: { connect: { addConnector: (...args: unknown[]) => addConnector(...args) } },
  noStoreClient: { connect: { revealStoredCredential: (...args: unknown[]) => revealStoredCredential(...args) } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/connectors',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { SourcesPanel } = await import('./SourcesPanel');

const TILES = [
  { slug: 'github', name: 'GitHub', description: 'Pull requests and checks.', icon: 'GitPullRequest', authKind: 'apikey', credentialPlatform: 'github', syncless: false, inspectable: false },
  { slug: 'hubspot', name: 'HubSpot', description: 'CRM records.', icon: 'Contact', authKind: 'apikey', credentialPlatform: 'hubspot', syncless: false, inspectable: false },
  { slug: 'jira', name: 'Jira', description: 'Issues.', icon: 'SquareKanban', authKind: 'apikey', credentialPlatform: 'jira', syncless: false, inspectable: false },
  { slug: 'slack', name: 'Slack', description: 'Channels.', icon: 'MessageSquare', authKind: 'oauth', credentialPlatform: null, syncless: false, inspectable: false },
  { slug: 'quickbooks', name: 'QuickBooks Online', description: 'Books.', icon: 'Landmark', authKind: 'oauth', credentialPlatform: 'quickbooks', syncless: false, inspectable: false },
];

/**
 * A configured GitHub source, as `/rpc/sources` lists it.
 * @param slug - The source's slug.
 * @param id - The source's id.
 */
function githubSource(slug: string, id: number) {
  return {
    id,
    slug,
    kind: 'plugin',
    config: { _connector: 'github', repos: ['northwind/api'], deployBranch: 'staging' },
    lastSyncedAt: null,
    enabled: 'true',
    createdAt: '2026-09-01T00:00:00.000Z',
    authKind: 'apikey',
    objectType: null,
    documentCount: 0,
    chunkCount: 0,
    credentialConnected: true,
    credentialUpdatedAt: null,
    credentialBroken: null,
    syncless: false,
    inspectable: false,
    inspectNote: null,
    sync: null,
  };
}

/**
 * Stub the sources API. The list is `sources`; a POST to `/rpc/sources` adds
 * `github-2` (id 7) to it, the way a real create would, and is recorded.
 * @param sources - The sources the workspace starts with.
 */
function stubSources(sources: ReturnType<typeof githubSource>[]) {
  const posts: Record<string, unknown>[] = [];
  const listed = [...sources];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/rpc/sources' && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      listed.push(githubSource('github-2', 7));
      return new Response(JSON.stringify({ source: { id: 7 } }), { status: 200 });
    }
    if (url === '/rpc/sources') {
      return new Response(JSON.stringify({ sources: listed, connectors: TILES }), { status: 200 });
    }
    if (url === '/rpc/sources/7/credentials') {
      return new Response(JSON.stringify({
        credentials: null,
        available: [],
        linkedCredentialId: null,
        platform: 'github',
        platformLabel: 'GitHub',
        helpText: 'A GitHub token.',
        fields: [{ name: 'token', label: 'Access token', shapeHint: 'any non-empty token', secret: true }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `unstubbed ${url}` }), { status: 500 });
  }));
  return posts;
}

beforeEach(() => {
  addConnector.mockReset();
  revealStoredCredential.mockReset();
  stubSources([]);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

const NO_LOGIN = { providerLabel: 'GitHub', loggedInAs: null, stored: null, lastAttempt: null };
const LOGGED_IN = { providerLabel: 'GitHub', loggedInAs: 'northwind', stored: { kind: 'login' as const, account: 'northwind', hint: '…abcd', revealable: true }, lastAttempt: null };
const ATLASSIAN_NO_LOGIN = { providerLabel: 'Atlassian', loggedInAs: null, stored: null, lastAttempt: null };
const GITHUB_CONFIG = { repos: ['northwind/portal'], baseUrl: 'https://api.github.com', deployBranch: 'main', lookbackDays: 7 };

describe('the add form puts the credential inside it', () => {
  it('a connector with a login and a paste leads with the login, with pasting one click away and its guidance folded behind Details', async () => {
    await render(<SourcesPanel connectInfo={{ github: NO_LOGIN }} />);
    await page.getByRole('button', { name: 'Connect GitHub' }).click();

    const login = page.getByRole('link', { name: 'Log in with GitHub' });
    const href = login.element().getAttribute('href') ?? '';

    expect(href.startsWith('/api/connect/github/start?connector=github')).toBe(true);
    expect(decodeURIComponent(href)).toContain('returnTo=/dashboard/connectors?add=github');
    // Dressed as GitHub's own login, so the person sees whose login opens next.
    await expect.element(login).toHaveAttribute('data-brand', 'github');

    await expect.element(page.getByLabelText('Personal access token', { exact: true })).not.toBeInTheDocument();

    await page.getByRole('button', { name: 'Paste a Personal access token instead' }).click();

    await expect.element(page.getByLabelText('Personal access token', { exact: true })).toBeVisible();
    // One sentence on where to find it; the scopes and steps wait behind Details.
    await expect.element(page.getByRole('link', { name: 'github.com' })).toHaveAttribute('href', 'https://github.com/settings/personal-access-tokens/new');
    await expect.element(page.getByText(/Needs access to: pull_requests:read/)).not.toBeVisible();

    await page.getByTestId('connect-paste-guide').getByText('Details').click();

    await expect.element(page.getByText('Make a fine-grained personal access token')).toBeVisible();
    await expect.element(page.getByText(/Needs access to: pull_requests:read/)).toBeVisible();
  });

  it('the old two-step wording and the paste checkbox are gone', async () => {
    await render(<SourcesPanel connectInfo={{ github: NO_LOGIN }} />);
    await page.getByRole('button', { name: 'Connect GitHub' }).click();

    await expect.element(page.getByText(/press Connect on its row/)).not.toBeInTheDocument();
    await expect.element(page.getByRole('checkbox', { name: 'Paste a token instead' })).not.toBeInTheDocument();
  });

  it('says what the source still needs after the login, from the declaration', async () => {
    await render(<SourcesPanel connectInfo={{ github: NO_LOGIN, jira: ATLASSIAN_NO_LOGIN }} />);
    await page.getByRole('button', { name: 'Connect GitHub' }).click();

    await expect.element(page.getByTestId('connect-after-login')).toHaveTextContent('After logging in you choose: repositories.');
  });

  it('a paste-only connector shows its inputs and guidance and no login button', async () => {
    await render(<SourcesPanel connectInfo={{}} />);
    await page.getByRole('button', { name: 'Connect HubSpot' }).click();

    await expect.element(page.getByLabelText('Private-app token', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('link', { name: /Log in with/ })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /^Paste .* instead$/ })).not.toBeInTheDocument();

    await page.getByTestId('connect-paste-guide').getByText('Details').click();

    await expect.element(page.getByText('Needs access to: CRM object read access')).toBeVisible();
  });

  it('a connector with nothing to paste (QuickBooks) shows its login alone: no paste, no input', async () => {
    await render(<SourcesPanel connectInfo={{ quickbooks: { providerLabel: 'QuickBooks', loggedInAs: null, stored: null, lastAttempt: null } }} />);
    await page.getByRole('button', { name: 'Connect QuickBooks Online' }).click();

    await expect.element(page.getByRole('link', { name: 'Log in with QuickBooks' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Paste .* instead$/ })).not.toBeInTheDocument();
    await expect.element(page.getByRole('textbox')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('connect-after-login')).toHaveTextContent('Logging in is all it takes; the source is added for you.');
  });

  it('a connector made of several inputs (Jira) asks for each one by name, with no "needs" line when the access list is empty', async () => {
    await render(<SourcesPanel connectInfo={{ jira: ATLASSIAN_NO_LOGIN }} />);
    await page.getByRole('button', { name: 'Connect Jira' }).click();
    await page.getByRole('button', { name: /^Paste .* instead$/ }).click();

    await expect.element(page.getByLabelText('Atlassian account email', { exact: true })).toBeVisible();
    await expect.element(page.getByLabelText('API token', { exact: true })).toBeVisible();
    await expect.element(page.getByText(/Needs access to/)).not.toBeInTheDocument();
  });

  it('?paste=1 puts the cursor in the first input', async () => {
    window.history.replaceState(null, '', '/?add=github&paste=1');
    await render(<SourcesPanel connectInfo={{ github: NO_LOGIN }} />);

    await expect.element(page.getByLabelText('Personal access token', { exact: true })).toHaveFocus();
  });

  it('a secret input is masked and its toggle shows what was typed, then hides it again', async () => {
    await render(<SourcesPanel connectInfo={{}} />);
    await page.getByRole('button', { name: 'Connect HubSpot' }).click();
    await userEvent.fill(page.getByLabelText('Private-app token', { exact: true }), 'pat-na1-typed');

    await expect.element(page.getByLabelText('Private-app token', { exact: true })).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Show Private-app token' }).click();

    await expect.element(page.getByLabelText('Private-app token', { exact: true })).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Hide Private-app token' }).click();

    await expect.element(page.getByLabelText('Private-app token', { exact: true })).toHaveAttribute('type', 'password');
  });

  it('an empty secret input asks for a value rather than showing dots that read as one already typed', async () => {
    await render(<SourcesPanel connectInfo={{}} />);
    await page.getByRole('button', { name: 'Connect HubSpot' }).click();

    await expect.element(page.getByLabelText('Private-app token', { exact: true })).toHaveAttribute('placeholder', 'Paste the value');
  });

  it('save waits for the credential and names it, and for the settings and names them', async () => {
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: NO_LOGIN }} />);

    await expect.element(page.getByRole('button', { name: 'Connect', exact: true }).last()).toBeDisabled();
    await expect.element(page.getByText(/Still needed/i)).toHaveTextContent(/personal access token/);
    await expect.element(page.getByText(/Still needed/i)).toHaveTextContent(/repositories/);
  });
});

describe('a stored login fills the credential, masked', () => {
  it('shows who is logged in and the masked tail, never the token, with Replace', async () => {
    window.history.replaceState(null, '', '/?add=github&connect=ok&connector=github');
    await render(<SourcesPanel connectInfo={{ github: LOGGED_IN }} />);

    await expect.element(page.getByTestId('connect-stored-text')).toHaveTextContent('Logged in as northwind · ••••abcd');
    await expect.element(page.getByRole('button', { name: 'Replace' })).toBeVisible();
    await expect.element(page.getByRole('link', { name: /Log in with/ })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('ghs_');
  });

  it('Replace empties it to an editable input and the login button comes back', async () => {
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: LOGGED_IN }} />);
    await page.getByRole('button', { name: 'Replace' }).click();

    const input = page.getByLabelText('Personal access token', { exact: true });

    await expect.element(input).toHaveValue('');
    await expect.element(page.getByTestId('connect-stored-text')).not.toBeInTheDocument();

    await userEvent.fill(input, 'ghp_replacement');

    await expect.element(input).toHaveValue('ghp_replacement');
    await expect.element(page.getByRole('link', { name: 'Log in with GitHub' })).toBeVisible();
  });

  it('a stored pasted key reads "Saved key" with its tail, on a connector that has no login', async () => {
    window.history.replaceState(null, '', '/?add=hubspot');
    await render(<SourcesPanel connectInfo={{ hubspot: { providerLabel: null, loggedInAs: null, stored: { kind: 'paste', account: null, hint: '…wxyz', revealable: true }, lastAttempt: null } }} />);

    await expect.element(page.getByTestId('connect-stored-text')).toHaveTextContent('Saved key · ••••wxyz');
    await expect.element(page.getByRole('link', { name: /Log in with/ })).not.toBeInTheDocument();
  });

  it('saves the kept login in one request with the typed repos, and the form closes', async () => {
    addConnector.mockResolvedValue({ ok: true, sourceId: 5 });
    stubSources([githubSource('github', 3)]);
    window.history.replaceState(null, '', '/?add=github&connect=ok&connector=github');
    await render(<SourcesPanel connectInfo={{ github: LOGGED_IN }} />);

    await expect.element(page.getByText('Connected GitHub.', { exact: false })).toBeVisible();

    await userEvent.fill(page.getByLabelText(/Repositories/), 'northwind/portal');
    await page.getByRole('button', { name: 'Connect', exact: true }).last().click();

    await vi.waitFor(() => expect(addConnector).toHaveBeenCalledWith({ connector: 'github', config: { ...GITHUB_CONFIG, repos: ['northwind/portal'] }, credential: { keepStored: true } }));
  });

  it('saves a pasted value in the same one request, with no second dialog afterwards', async () => {
    addConnector.mockResolvedValue({ ok: true, sourceId: 5 });
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: NO_LOGIN }} />);
    await page.getByRole('button', { name: 'Paste a Personal access token instead' }).click();
    await userEvent.fill(page.getByLabelText('Personal access token', { exact: true }), 'ghp_pasted_once');
    await userEvent.fill(page.getByLabelText(/Repositories/), 'northwind/portal');
    await page.getByRole('button', { name: 'Connect', exact: true }).last().click();

    await vi.waitFor(() => expect(addConnector).toHaveBeenCalledWith({ connector: 'github', config: { ...GITHUB_CONFIG, repos: ['northwind/portal'] }, credential: { values: { token: 'ghp_pasted_once' } } }));

    await expect.element(page.getByRole('heading', { name: /^Connect github/ })).not.toBeInTheDocument();
  });

  it('shows the refusal sentence the route sends back, inline, and keeps the form open', async () => {
    addConnector.mockRejectedValue(new Error('Only a workspace admin can connect a source'));
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: LOGGED_IN }} />);

    await userEvent.fill(page.getByLabelText(/Repositories/), 'northwind/portal');
    await page.getByRole('button', { name: 'Connect', exact: true }).last().click();

    await expect.element(page.getByRole('alert')).toHaveTextContent('Only a workspace admin can connect a source');
    await expect.element(page.getByRole('button', { name: 'Connect', exact: true }).last()).toBeVisible();
  });
});

describe('Show reveals the stored value for an admin', () => {
  it('Show fetches it, fills editable inputs, and Hide drops it from the page', async () => {
    revealStoredCredential.mockResolvedValue({ status: 'ok', values: { token: 'ghs_the_real_value_abcd' } });
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: LOGGED_IN }} />);

    expect(document.body.innerHTML).not.toContain('ghs_the_real_value_abcd');

    await page.getByRole('button', { name: 'Show' }).click();

    await expect.element(page.getByLabelText('Personal access token', { exact: true })).toHaveValue('ghs_the_real_value_abcd');
    await expect.element(page.getByLabelText('Personal access token', { exact: true })).toHaveAttribute('type', 'text');
    expect(revealStoredCredential).toHaveBeenCalledTimes(1);
    expect(revealStoredCredential).toHaveBeenCalledWith({ connector: 'github' });

    await page.getByRole('button', { name: 'Hide Personal access token' }).click();

    await expect.element(page.getByTestId('connect-stored-text')).toHaveTextContent('Logged in as northwind · ••••abcd');
    expect(document.body.innerHTML).not.toContain('ghs_the_real_value_abcd');
  });

  it('an edited revealed value saves as typed values, not as the stored credential', async () => {
    revealStoredCredential.mockResolvedValue({ status: 'ok', values: { token: 'ghs_the_real_value_abcd' } });
    addConnector.mockResolvedValue({ ok: true, sourceId: 5 });
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: LOGGED_IN }} />);
    await page.getByRole('button', { name: 'Show' }).click();
    await userEvent.fill(page.getByLabelText('Personal access token', { exact: true }), 'ghp_edited_after_show');
    await userEvent.fill(page.getByLabelText(/Repositories/), 'northwind/portal');
    await page.getByRole('button', { name: 'Connect', exact: true }).last().click();

    await vi.waitFor(() => expect(addConnector).toHaveBeenCalledWith({ connector: 'github', config: { ...GITHUB_CONFIG, repos: ['northwind/portal'] }, credential: { values: { token: 'ghp_edited_after_show' } } }));
  });

  it('an unedited revealed value still saves as the stored credential', async () => {
    revealStoredCredential.mockResolvedValue({ status: 'ok', values: { token: 'ghs_the_real_value_abcd' } });
    addConnector.mockResolvedValue({ ok: true, sourceId: 5 });
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: LOGGED_IN }} />);
    await page.getByRole('button', { name: 'Show' }).click();
    await page.getByRole('button', { name: 'Hide Personal access token' }).click();
    await userEvent.fill(page.getByLabelText(/Repositories/), 'northwind/portal');
    await page.getByRole('button', { name: 'Connect', exact: true }).last().click();

    await vi.waitFor(() => expect(addConnector).toHaveBeenCalledWith(expect.objectContaining({ credential: { keepStored: true } })));
  });

  it('a revealed value saved while still shown, unedited, keeps the stored credential rather than pasting a copy of it', async () => {
    // Sending the shown token as typed values would store a frozen copy: a login
    // loses its refresh, and a one-key platform revokes the login it came from.
    revealStoredCredential.mockResolvedValue({ status: 'ok', values: { token: 'ghs_the_real_value_abcd' } });
    addConnector.mockResolvedValue({ ok: true, sourceId: 5 });
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: LOGGED_IN }} />);
    await page.getByRole('button', { name: 'Show' }).click();

    await expect.element(page.getByLabelText('Personal access token', { exact: true })).toHaveValue('ghs_the_real_value_abcd');

    await userEvent.fill(page.getByLabelText(/Repositories/), 'northwind/portal');
    await page.getByRole('button', { name: 'Connect', exact: true }).last().click();

    await vi.waitFor(() => expect(addConnector).toHaveBeenCalledWith(expect.objectContaining({ credential: { keepStored: true } })));
  });

  it('a refused reveal says so on the line and leaves the credential masked', async () => {
    revealStoredCredential.mockRejectedValue(new Error('Forbidden'));
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: LOGGED_IN }} />);
    await page.getByRole('button', { name: 'Show' }).click();

    await expect.element(page.getByTestId('connect-reveal-note')).toHaveTextContent('Forbidden');
    await expect.element(page.getByTestId('connect-stored-text')).toHaveTextContent('••••abcd');
  });

  it('a login with no token string reads as an app installation, with no Show button and a reason', async () => {
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: { ...LOGGED_IN, stored: { kind: 'login', account: 'northwind', hint: 'login', revealable: false } } }} />);

    await expect.element(page.getByTestId('connect-stored-text')).toHaveTextContent('GitHub App installation · northwind');
    await expect.element(page.getByRole('button', { name: 'Show' })).not.toBeInTheDocument();
    await expect.element(page.getByText(/no token to show/)).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Replace' })).toBeVisible();
  });
});

describe('the last failed attempt', () => {
  it('is stated with its date under the connector', async () => {
    await render(
      <SourcesPanel
        timeZone="UTC"
        connectInfo={{ slack: { providerLabel: 'Slack', loggedInAs: null, stored: null, lastAttempt: { at: '2026-10-01T16:12:00.000Z', summary: 'Slack denied access' } } }}
      />,
    );

    await expect.element(page.getByText('Last attempt Oct 1, 4:12 PM: Slack denied access')).toBeVisible();
  });
});
