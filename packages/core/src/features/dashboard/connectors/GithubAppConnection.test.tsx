/**
 * The GitHub block on Connections, drawn from what the status route answers:
 * Create before an app exists, Connect before this workspace is connected,
 * and the connected accounts with their repositories, Test connection's
 * finding and the return from GitHub. Fictional accounts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { describeGithubReturn, describeRepos, GithubAppConnection } from './GithubAppConnection';

const APP = { appId: 1001, slug: 'vocion-northwind', name: 'Vocion Northwind', ownerLogin: 'northwind', htmlUrl: null };
const INSTALL = { id: 7, installationId: 555, accountLogin: 'Northwind', accountType: 'Organization', repositorySelection: 'selected', repos: ['northwind/orders-api'], tier: 'base', status: 'active', lastError: null, settingsUrl: 'https://github.com/organizations/Northwind/settings/installations/555', updatedAt: '2026-09-30T12:00:00Z' };

function stubStatus(view: unknown, test?: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/test') && init?.method === 'POST') {
      return new Response(JSON.stringify(test ?? { results: [] }));
    }
    return new Response(JSON.stringify(view));
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('GithubAppConnection', () => {
  it('offers to create the app when the deployment has none', async () => {
    stubStatus({ app: null, installations: [] });
    render(<GithubAppConnection />);

    await expect.element(page.getByTestId('github-create-app')).toBeVisible();
    await expect.element(page.getByText(/never as a person/)).toBeVisible();
  });

  it('offers to connect when the app exists and this workspace is not connected', async () => {
    stubStatus({ app: APP, installations: [] });
    render(<GithubAppConnection />);

    await expect.element(page.getByTestId('github-connect')).toBeVisible();
  });

  it('shows the connected account and what Test connection found', async () => {
    stubStatus({ app: APP, installations: [INSTALL] }, { results: [{ installationId: 555, account: 'Northwind', ok: true, message: 'Connected to 1 repository at the base tier.' }] });
    render(<GithubAppConnection />);

    await expect.element(page.getByText('Northwind', { exact: true })).toBeVisible();
    await expect.element(page.getByText('orders-api')).toBeVisible();

    await userEvent.click(page.getByTestId('github-test'));

    await expect.element(page.getByTestId('github-test-result')).toHaveTextContent('Connected to 1 repository at the base tier.');
  });
});

describe('describeGithubReturn', () => {
  it('says what the return from GitHub means, and GitHub\'s reason when it failed', () => {
    expect(describeGithubReturn(new URLSearchParams('github=connected&account=Northwind'))).toEqual({ ok: true, message: 'GitHub is connected to Northwind.' });
    expect(describeGithubReturn(new URLSearchParams('github=error&reason=Your%20GitHub%20account%20cannot%20reach%20that%20installation'))).toEqual({ ok: false, message: 'Your GitHub account cannot reach that installation' });
    expect(describeGithubReturn(new URLSearchParams('tab=all'))).toBeNull();
  });

  it('names a few repositories and counts the rest', () => {
    expect(describeRepos({ repositorySelection: 'all', repos: [], accountLogin: 'Northwind' })).toBe('Every repository of Northwind');
    expect(describeRepos({ repositorySelection: 'selected', repos: ['n/a', 'n/b', 'n/c', 'n/d', 'n/e', 'n/f'], accountLogin: 'n' })).toBe('a, b, c, d and 2 more');
  });
});
