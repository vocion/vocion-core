import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * The add form offers what each connector declares (#1028): log in with the
 * vendor, or paste a token. Wrong here means a person is sent to log in at a
 * connector that only takes a pasted key, or sees a login they already made
 * asked for again.
 */

const saveSource = vi.fn();
vi.mock('@/libs/Orpc', () => ({ client: { connect: { saveSource: (...args: unknown[]) => saveSource(...args) } } }));
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
  saveSource.mockReset();
  stubSources([]);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('the add form follows the connector declaration', () => {
  it('offers a login link and an unchecked paste box for a connector with a login', async () => {
    await render(<SourcesPanel connectInfo={{ github: { providerLabel: 'GitHub', loggedInAs: null, lastAttempt: null } }} />);
    await page.getByRole('button', { name: 'Connect GitHub' }).click();

    const login = page.getByRole('link', { name: 'Log in with GitHub' });
    const href = login.element().getAttribute('href') ?? '';

    expect(href.startsWith('/api/connect/github/start?connector=github')).toBe(true);
    expect(decodeURIComponent(href)).toContain('returnTo=/dashboard/connectors?add=github');

    const paste = page.getByRole('checkbox', { name: 'Paste a token instead' });

    await expect.element(paste).not.toBeChecked();
    await expect.element(page.getByText('Personal access token', { exact: true })).not.toBeInTheDocument();

    await paste.click();

    await expect.element(page.getByText('Personal access token', { exact: true })).toBeVisible();

    const link = page.getByRole('link', { name: /github\.com\/settings\/personal-access-tokens\/new/ });

    await expect.element(link).toBeVisible();
    await expect.element(page.getByText('Make a fine-grained personal access token')).toBeVisible();
    await expect.element(page.getByText(/Needs access to: pull_requests:read/)).toBeVisible();
  });

  it('shows only the paste fields for a connector with no login', async () => {
    await render(<SourcesPanel connectInfo={{}} />);
    await page.getByRole('button', { name: 'Connect HubSpot' }).click();

    await expect.element(page.getByText('Private-app token', { exact: true })).toBeVisible();
    await expect.element(page.getByText('CRM object read access')).toBeVisible();
    await expect.element(page.getByRole('link', { name: /Log in with/ })).not.toBeInTheDocument();
    await expect.element(page.getByRole('checkbox', { name: 'Paste a token instead' })).not.toBeInTheDocument();
  });

  it('writes no "needs" line when the declared access list is empty', async () => {
    window.history.replaceState(null, '', '/?paste=1');
    await render(<SourcesPanel connectInfo={{ jira: { providerLabel: 'Atlassian', loggedInAs: null, lastAttempt: null } }} />);
    await page.getByRole('button', { name: 'Connect Jira' }).click();

    await expect.element(page.getByText('API token', { exact: true })).toBeVisible();
    await expect.element(page.getByText(/Needs access to/)).not.toBeInTheDocument();
  });

  it('pre-checks the paste box when the link says ?paste=1', async () => {
    window.history.replaceState(null, '', '/?paste=1');
    await render(<SourcesPanel connectInfo={{ github: { providerLabel: 'GitHub', loggedInAs: null, lastAttempt: null } }} />);
    await page.getByRole('button', { name: 'Connect GitHub' }).click();

    await expect.element(page.getByRole('checkbox', { name: 'Paste a token instead' })).toBeChecked();
    await expect.element(page.getByText('Personal access token', { exact: true })).toBeVisible();
  });
});

describe('after a login', () => {
  it('says who is logged in and saves through the login route with the typed repos', async () => {
    saveSource.mockResolvedValue({ ok: true, sourceId: 5 });
    stubSources([githubSource('github', 3)]);
    window.history.replaceState(null, '', '/?add=github&connect=ok&connector=github');
    await render(<SourcesPanel connectInfo={{ github: { providerLabel: 'GitHub', loggedInAs: 'northwind', lastAttempt: null } }} />);

    await expect.element(page.getByText('Logged in as northwind')).toBeVisible();
    await expect.element(page.getByText('Connected GitHub.', { exact: false })).toBeVisible();
    await expect.element(page.getByRole('link', { name: /Log in with/ })).not.toBeInTheDocument();

    await userEvent.fill(page.getByLabelText(/Repositories/), 'northwind/portal');
    await page.getByRole('button', { name: 'Add connector' }).last().click();

    await vi.waitFor(() => expect(saveSource).toHaveBeenCalledWith({ connector: 'github', createNew: true, config: { repos: ['northwind/portal'], baseUrl: 'https://api.github.com', deployBranch: 'main', lookbackDays: 7 } }));
  });

  it('shows the refusal sentence the route sends back', async () => {
    saveSource.mockRejectedValue(new Error('Only a workspace admin can connect a source'));
    window.history.replaceState(null, '', '/?add=github');
    await render(<SourcesPanel connectInfo={{ github: { providerLabel: 'GitHub', loggedInAs: 'northwind', lastAttempt: null } }} />);

    await userEvent.fill(page.getByLabelText(/Repositories/), 'northwind/portal');
    await page.getByRole('button', { name: 'Add connector' }).last().click();

    await expect.element(page.getByRole('alert')).toHaveTextContent('Only a workspace admin can connect a source');
  });
});

describe('pasting a token', () => {
  it('opens the credential dialog for the source it just created', async () => {
    const posts = stubSources([githubSource('github', 3)]);
    window.history.replaceState(null, '', '/?add=github&paste=1');
    await render(<SourcesPanel connectInfo={{ github: { providerLabel: 'GitHub', loggedInAs: null, lastAttempt: null } }} />);

    await userEvent.fill(page.getByLabelText(/Repositories/), 'northwind/portal');
    await page.getByRole('button', { name: 'Add connector' }).last().click();

    await expect.element(page.getByRole('heading', { name: 'Connect github-2' })).toBeVisible();
    await expect.element(page.getByLabelText(/Access token/)).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(saveSource).not.toHaveBeenCalled();
  });
});

describe('the last failed attempt', () => {
  it('is stated with its date under the connector', async () => {
    await render(
      <SourcesPanel
        timeZone="UTC"
        connectInfo={{ slack: { providerLabel: 'Slack', loggedInAs: null, lastAttempt: { at: '2026-10-01T16:12:00.000Z', summary: 'Slack denied access' } } }}
      />,
    );

    await expect.element(page.getByText('Last attempt Oct 1, 4:12 PM: Slack denied access')).toBeVisible();
  });
});
