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

const list = vi.fn();
const listPlatforms = vi.fn();

vi.mock('@/libs/Orpc', () => ({
  client: {
    apiTokens: {
      list: (input?: { includeRevoked?: boolean }) => list(input),
      listPlatforms: () => listPlatforms(),
      revealPlatformKey: vi.fn(),
      create: vi.fn(),
      createPlatformKey: vi.fn(),
      revoke: vi.fn(),
    },
  },
}));

// Registered here so the panel's links never depend on a mock another file in
// the same browser worker left behind ("Mock … wasn't registered" in CI).
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard/developers',
}));

const { ApiTokensPanel } = await import('./ApiTokensPanel');

beforeEach(() => {
  list.mockReset();
  listPlatforms.mockReset();
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
