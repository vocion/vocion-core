/**
 * The Developers page, listing a provider login beside a pasted key.
 *
 * What someone could get wrong: a login has no key to show, so its row must say
 * which account it is and must not offer a Show button that could never work,
 * while a pasted key beside it keeps its hint and its button.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

// The locale-aware Link needs the intl provider the real app mounts.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const list = vi.fn();
const listPlatforms = vi.fn();
const createPlatformKey = vi.fn();

vi.mock('@/libs/Orpc', () => ({
  client: {
    apiTokens: {
      list: (input?: { includeRevoked?: boolean }) => list(input),
      listPlatforms: () => listPlatforms(),
      revealPlatformKey: vi.fn(),
      create: vi.fn(),
      createPlatformKey: (input: unknown) => createPlatformKey(input),
      revoke: vi.fn(),
    },
  },
}));

const { ApiTokensPanel } = await import('./ApiTokensPanel');

beforeEach(() => {
  list.mockReset();
  listPlatforms.mockReset();
  createPlatformKey.mockReset();
});

const GITHUB_PLATFORM = {
  id: 'github',
  label: 'GitHub',
  keySource: 'supplied' as const,
  credentialsPerOrg: 'many' as const,
  keyShapeHint: 'starts with "ghp_"',
  helpText: 'A GitHub token.',
  fields: [{ name: 'token', label: 'Token', shapeHint: 'starts with "ghp_"', secret: true }],
};

function row(overrides: Record<string, unknown>) {
  return {
    id: 'tok-1',
    name: 'Acme key',
    platform: 'github',
    createdAt: new Date('2026-09-01'),
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: null,
    keyHint: '…beef',
    revealable: true,
    obtainedVia: 'paste',
    account: null,
    ...overrides,
  };
}

describe('a login on the Developers page', () => {
  it('names the account and offers no Show button, while the pasted key keeps its own', async () => {
    list.mockResolvedValue([
      row({}),
      row({
        id: 'tok-2',
        name: 'Northwind login',
        keyHint: null,
        revealable: false,
        obtainedVia: 'login',
        account: 'northwind',
      }),
    ]);
    listPlatforms.mockResolvedValue([GITHUB_PLATFORM]);
    render(<ApiTokensPanel />);

    await expect.element(page.getByText('Login · northwind')).toBeVisible();
    await expect.element(page.getByText('…beef', { exact: false })).toBeVisible();
    // Exactly one Show button: the pasted row's. The login row has none.
    await expect.element(page.getByLabelText('Show key')).toBeVisible();
    expect(page.getByLabelText('Show key').elements()).toHaveLength(1);
    // The login row is not told to "create a new one"; that copy is for old rows.
    await expect.element(page.getByText(/Shown once at creation/)).not.toBeInTheDocument();
  });
});

describe('the Developers page opened from a chat card', () => {
  const APP_LOGIN = { ...GITHUB_PLATFORM, id: 'app-login', label: 'App sign-in', credentialsPerOrg: 'many' as const, fields: [{ name: 'password', label: 'Password', shapeHint: 'any', secret: true }] };

  it('opens the add form with the platform from ?add= already chosen', async () => {
    list.mockResolvedValue([]);
    listPlatforms.mockResolvedValue([GITHUB_PLATFORM, APP_LOGIN]);
    render(<ApiTokensPanel addPlatform="app-login" returnTo="/dashboard/chat?conversation=7" />);

    await expect.element(page.getByLabelText('Platform')).toHaveValue('app-login');
  });

  async function saveAppLogin(returnTo: string) {
    list.mockResolvedValue([]);
    listPlatforms.mockResolvedValue([GITHUB_PLATFORM, APP_LOGIN]);
    createPlatformKey.mockResolvedValue({});
    render(<ApiTokensPanel addPlatform="app-login" returnTo={returnTo} />);
    await page.getByLabelText('Name').fill('Northwind QA');
    await page.getByLabelText('Password').fill('a-long-qa-passphrase');
    await page.getByRole('button', { name: /save/i }).click();

    // The form closes once the save lands.
    await expect.element(page.getByLabelText('Name')).not.toBeInTheDocument();
  }

  it('after a save, links back to the conversation it came from', async () => {
    await saveAppLogin('/dashboard/chat?conversation=7');

    await expect.element(page.getByRole('link', { name: 'Back to your conversation' })).toHaveAttribute('href', expect.stringContaining('/dashboard/chat?conversation=7'));
  });

  it('drops an off-site returnTo: nothing links away', async () => {
    await saveAppLogin('https://evil.example/steal');

    expect(createPlatformKey).toHaveBeenCalledTimes(1);
    expect(page.getByText('Back to your conversation').elements()).toHaveLength(0);
  });
});
