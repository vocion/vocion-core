/**
 * `/dashboard/api-tokens` lives on only to redirect into the Developers page
 * (nav sweep, 2026-09-15). Nothing else in the app would notice if it
 * stopped; a bookmark or the credentials e2e spec would.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { redirect } = await import('next/navigation');
const { default: ApiTokensPage } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/dashboard/api-tokens', () => {
  it('sends the old credentials page to Developers', () => {
    ApiTokensPage();

    expect(redirect).toHaveBeenCalledWith('/dashboard/developers');
  });
});
