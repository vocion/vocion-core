'use client';

/**
 * GITHUB ON CONNECTIONS (backlog 053): the Vocion GitHub App in one block at
 * the top of the connectors list. It says where this workspace stands and
 * offers the one next move:
 *
 *   - no app on this deployment → Create GitHub App (GitHub's manifest flow);
 *   - an app, nothing connected here → Connect GitHub (GitHub's install screen);
 *   - connected → each account with its repositories, the tier, what the last
 *     mint said, Test connection, Change repositories (on GitHub), Disconnect.
 *
 * Coming back from GitHub, the page's `?github=` says what happened, in
 * GitHub's words when it went wrong.
 */

import type { GithubConnectionView } from '@/services/github/GithubAppService';
import { CheckCircle2, CircleAlert, ExternalLink, GitBranch, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type TestResult = { installationId: number; account: string; ok: boolean; message: string };

const PRIMARY = 'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90';
const QUIET = 'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50';

/**
 * What the return from GitHub says, as one line, or null when the page was not a return.
 * @param params - The page's query string.
 */
export function describeGithubReturn(params: URLSearchParams): { ok: boolean; message: string } | null {
  const outcome = params.get('github');
  const reason = params.get('reason');
  if (outcome === 'created') {
    return { ok: true, message: 'The GitHub App is created and its key is sealed in the vault. Connect GitHub to choose the organization and repositories.' };
  }
  if (outcome === 'connected') {
    const account = params.get('account');
    return { ok: true, message: `GitHub is connected${account ? ` to ${account}` : ''}.` };
  }
  if (outcome === 'requested') {
    return { ok: true, message: reason ?? 'GitHub sent the install request to an organization owner.' };
  }
  if (outcome === 'error') {
    return { ok: false, message: reason ?? 'GitHub did not finish connecting. Try again.' };
  }
  return null;
}

/**
 * The repositories line for one installation.
 * @param i - The installation.
 * @param i.repositorySelection - `all` or `selected`.
 * @param i.repos - The selected repositories.
 * @param i.accountLogin - The account.
 */
export function describeRepos(i: { repositorySelection: string; repos: string[]; accountLogin: string }): string {
  if (i.repositorySelection === 'all') {
    return `Every repository of ${i.accountLogin}`;
  }
  if (i.repos.length === 0) {
    return 'No repositories chosen yet';
  }
  const names = i.repos.map(r => r.split('/')[1] ?? r);
  return names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} and ${names.length - 4} more`;
}

export function GithubAppConnection() {
  const [view, setView] = useState<GithubConnectionView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [owner, setOwner] = useState('');
  const [testing, setTesting] = useState(false);
  const [tests, setTests] = useState<TestResult[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [returned, setReturned] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/connections/github');
      if (!res.ok) {
        setLoadError(`GitHub connection status could not be read (${res.status}).`);
        return;
      }
      setView(await res.json() as GithubConnectionView);
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setReturned(describeGithubReturn(new URLSearchParams(window.location.search)));
  }, [load]);

  const test = async () => {
    setTesting(true);
    setTests(null);
    try {
      const res = await fetch('/api/v1/connections/github/test', { method: 'POST' });
      const data = await res.json() as { results?: TestResult[]; error?: { message?: string } };
      setTests(res.ok ? data.results ?? [] : [{ installationId: 0, account: 'GitHub', ok: false, message: data.error?.message ?? `HTTP ${res.status}` }]);
      await load();
    } finally {
      setTesting(false);
    }
  };

  const setTier = async (tier: 'base' | 'pipeline') => {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/connections/github', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier }) });
      if (res.ok) {
        setView(await res.json() as GithubConnectionView);
      }
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async (id: number) => {
    await fetch(`/api/v1/connections/github/installations/${id}`, { method: 'DELETE' });
    setTests(null);
    await load();
  };

  // A full navigation, not a client route: the install route answers with a
  // redirect to GitHub.
  const connect = () => window.location.assign('/api/v1/connections/github/install');

  const installs = view?.installations ?? [];
  const tier = installs[0]?.tier ?? 'base';

  return (
    <section className="flex flex-col gap-3 border-b border-border/70 pb-4" data-testid="github-app-connection" aria-label="GitHub">
      {returned && (
        <p className={`flex items-start gap-1.5 text-sm ${returned.ok ? 'text-muted-foreground' : 'text-destructive'}`} data-testid="github-return">
          {returned.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
          {returned.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-soft text-foreground">
          <GitBranch className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">GitHub</p>
          <p className="text-[13px] text-muted-foreground">
            {!view
              ? (loadError ?? 'Reading the connection…')
              : !view.app
                  ? 'Vocion acts on your repositories as its own GitHub App, never as a person. Create it once for this deployment.'
                  : installs.length === 0
                    ? `${view.app.name} is ready. Connect it to choose the organization and repositories this workspace works on.`
                    : `Connected as ${view.app.name}. Tokens last an hour and cover one repository at a time.`}
          </p>
        </div>
        {view && !view.app && (
          <form action="/api/v1/connections/github/manifest" method="get" className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="github-app-owner">GitHub organization that owns the app</label>
            <input
              id="github-app-owner"
              name="org"
              value={owner}
              onChange={e => setOwner(e.target.value)}
              placeholder="GitHub organization (optional)"
              className="h-8 w-56 rounded-full border border-border bg-background px-3 text-sm"
            />
            <button type="submit" className={PRIMARY} data-testid="github-create-app">Create GitHub App</button>
          </form>
        )}
        {view?.app && installs.length === 0 && (
          <button type="button" onClick={connect} className={PRIMARY} data-testid="github-connect">Connect GitHub</button>
        )}
      </div>

      {installs.length > 0 && (
        <ul className="ml-11 flex flex-col gap-2">
          {installs.map((i) => {
            const result = tests?.find(t => t.installationId === i.installationId);
            const problem = i.status === 'suspended'
              ? `Suspended on GitHub. An owner of ${i.accountLogin} unsuspends it there.`
              : i.status === 'retired-app'
                ? 'Installed from an app this deployment no longer uses. Connect GitHub again.'
                : i.lastError;
            return (
              <li key={i.id} className="flex flex-col gap-1 text-sm" data-testid="github-installation">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.accountLogin}</span>
                  <span className="truncate text-xs text-muted-foreground">{describeRepos(i)}</span>
                  <span className="flex-1" />
                  <a href={i.settingsUrl} target="_blank" rel="noreferrer" className={QUIET}>
                    Change repositories
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className={QUIET} onClick={() => void disconnect(i.id)}>Disconnect</button>
                    </TooltipTrigger>
                    <TooltipContent>This workspace stops using it. It stays installed on GitHub, where an owner can uninstall it.</TooltipContent>
                  </Tooltip>
                </div>
                {problem && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {problem}
                  </p>
                )}
                {result && (
                  <p className={`flex items-start gap-1.5 text-xs ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`} data-testid="github-test-result">
                    {result.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
                    {result.message}
                  </p>
                )}
              </li>
            );
          })}
          <li className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <label className="inline-flex items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={tier === 'pipeline'}
                disabled={saving}
                onChange={e => void setTier(e.target.checked ? 'pipeline' : 'base')}
                data-testid="github-tier-pipeline"
              />
              The Release engineer may change CI and deploy config
            </label>
            <span className="flex-1" />
            <button type="button" onClick={() => void test()} disabled={testing} className={QUIET} data-testid="github-test">
              {testing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              Test connection
            </button>
            <button type="button" onClick={connect} className={QUIET}>Connect another account</button>
          </li>
        </ul>
      )}
    </section>
  );
}
