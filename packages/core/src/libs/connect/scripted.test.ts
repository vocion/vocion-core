import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SCRIPT = {
  providers: {
    github: {
      outcome: 'ok',
      displayName: 'GitHub — northwind',
      credentials: { installationId: '1', account: 'northwind', accountType: 'Organization', repositorySelection: 'selected', repositories: ['northwind/portal'] },
    },
    atlassian: { outcome: 'refuse', reason: 'access_denied' },
  },
};

/**
 * Write a script file into a throwaway directory and point the environment at it.
 */
function useScript(): void {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'connect-script-')), 'connect.json');
  writeFileSync(file, JSON.stringify(SCRIPT));
  vi.stubEnv('VOCION_CONNECT_SCRIPT', file);
}

/**
 * Load a fresh copy of the module, so the once-per-process script cache starts empty.
 */
async function freshModule() {
  vi.resetModules();
  return import('./scripted');
}

describe('scripted connect providers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to run in production unless the allow flag is set, and names the flag', async () => {
    useScript();
    vi.stubEnv('NODE_ENV', 'production');
    const { scriptedProviders } = await freshModule();
    const { githubProvider } = await import('./providers/github');

    expect(() => scriptedProviders([githubProvider])).toThrow('VOCION_ALLOW_SCRIPTED_CONNECT');

    vi.stubEnv('VOCION_ALLOW_SCRIPTED_CONNECT', '1');

    expect(() => scriptedProviders([githubProvider])).not.toThrow();
  });

  it('answers the GitHub exchange with the scripted bag and name', async () => {
    useScript();
    const { scriptedProviders } = await freshModule();
    const { githubProvider } = await import('./providers/github');
    const [github] = scriptedProviders([githubProvider]);

    const result = await github!.exchange({ query: { installation_id: '1' }, redirectUri: 'http://x/cb' });

    expect(result).toEqual({ ok: true, displayName: 'GitHub — northwind', credentials: SCRIPT.providers.github.credentials });
    expect(github!.summarize(SCRIPT.providers.github.credentials)?.account).toBe('northwind (organization)');
  });

  it('refuses the Atlassian exchange with the scripted reason', async () => {
    useScript();
    const { scriptedProviders } = await freshModule();
    const { atlassianProvider } = await import('./providers/atlassian');
    const [atlassian] = scriptedProviders([atlassianProvider]);

    expect(await atlassian!.exchange({ query: { code: 'scripted' }, redirectUri: 'http://x/cb' })).toEqual({ ok: false, reason: 'access_denied' });
  });

  it('sends the browser straight back to the callback with the state, and is always configured', async () => {
    useScript();
    const { scriptedProviders } = await freshModule();
    const { githubProvider } = await import('./providers/github');
    const [github] = scriptedProviders([githubProvider]);

    expect(github!.configured()).toBe(true);
    expect(github!.authorizeUrl({ state: 'a.b', redirectUri: 'http://localhost:3008/api/connect/github/callback' }))
      .toBe('http://localhost:3008/api/connect/github/callback?state=a.b&code=scripted');
  });

  it('refuses a provider the script does not name, so no test can reach a real vendor', async () => {
    useScript();
    const { scriptedProviders } = await freshModule();
    const { slackProvider } = await import('./providers/slack');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const [slack] = scriptedProviders([slackProvider]);

    expect(await slack!.exchange({ query: { code: 'scripted' }, redirectUri: 'http://x/cb' })).toEqual({ ok: false, reason: 'not_scripted' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
