'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/**
 * Workspace drift banner — on dashboard load, ask the server what the mounted
 * workspace folder has to do with this project, and say only that.
 *
 * Four readings, decided on the server (`context.driftStatus`):
 * - The folder is ANOTHER project's (a deployment hosts several projects on
 *   one mount): say whose, say this project is applied from git, link the
 *   version history. No Apply — there is nothing here to apply to this project.
 * - The folder is this project's but git applies it (read-only mount, or a
 *   pipeline signed the last apply): say the files changed and the next
 *   deploy applies them. No Apply.
 * - The folder is this project's and a person applies it: show how many
 *   changes an apply would make (`context.driftDiff`, a dry run), and open
 *   that diff for review before applying — never blind. An empty diff says
 *   nothing and is remembered.
 * - An apply is still landing, or nothing differs: nothing.
 *
 * Dismiss is durable per (project, folder sha) — the strip comes back only
 * when the folder changes again, not on every page load.
 *
 * Quiet on purpose: a one-line, muted, bottom-anchored strip — housekeeping
 * information, not an alert.
 * @param props
 * @param props.onApplied - What to do once an apply has landed; defaults to reloading the page.
 */
export const WorkspaceDriftBanner = ({ onApplied = () => window.location.reload() }: { onApplied?: () => void } = {}) => {
  const [view, setView] = useState<View>({ kind: 'hidden' });
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readDrift().then((v) => {
      if (!cancelled) {
        setView(v);
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (view.kind === 'hidden') {
    return null;
  }

  const dismiss = () => {
    remember(view.key);
    setView({ kind: 'hidden' });
  };

  const apply = async () => {
    if (view.kind !== 'apply') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await client.context.applyNow({ sha: view.sha });
      if (result.errors.length > 0) {
        setError(`applied with ${result.errors.length} error(s) — check the server log`);
        return;
      }
      setReviewing(false);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'apply failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div role="status" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-2xl items-center gap-3 rounded-md border border-border/70 bg-muted/95 px-3 py-2 shadow-sm backdrop-blur sm:inset-x-4 sm:bottom-4">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {view.kind === 'foreign' && (
            view.owner
              ? `The workspace mounted on this host is ${view.owner.name}'s (${view.owner.slug}). This project is applied from git.`
              : 'The workspace mounted on this host belongs to another project. This project is applied from git.'
          )}
          {view.kind === 'git' && 'Workspace files changed. This project is applied from git — the next deploy applies them.'}
          {view.kind === 'apply' && `Workspace files changed — ${view.diff.changes} change${view.diff.changes === 1 ? '' : 's'} not yet applied.`}
        </p>
        {(view.kind === 'foreign' || view.kind === 'git') && (
          <Link href="/dashboard/workspace#versions" className="shrink-0 text-xs font-medium text-foreground hover:underline">
            Version history
          </Link>
        )}
        {view.kind === 'apply' && (
          <button
            type="button"
            onClick={() => setReviewing(true)}
            className="shrink-0 text-xs font-medium text-foreground transition hover:underline"
          >
            Review & apply
          </button>
        )}
        <span className="text-xs text-muted-foreground/50" aria-hidden="true">·</span>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-xs text-muted-foreground transition hover:text-foreground"
        >
          Dismiss
        </button>
      </div>

      {view.kind === 'apply' && (
        <Dialog open={reviewing} onOpenChange={open => !busy && setReviewing(open)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Apply workspace changes</DialogTitle>
              <DialogDescription>
                Folder
                {' '}
                <code className="font-mono text-xs">{view.sha}</code>
                {' '}
                would make these changes to this project. Nothing is written until you confirm.
              </DialogDescription>
            </DialogHeader>
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {Object.entries(view.diff.counts)
                .filter(([, c]) => c.created + c.updated > 0)
                .map(([kind, c]) => (
                  <li key={kind} className="flex items-center justify-between px-3 py-2">
                    <span className="font-medium">{kind}</span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {[c.created > 0 && `${c.created} new`, c.updated > 0 && `${c.updated} updated`].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
            </ul>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setReviewing(false)} disabled={busy}>Cancel</Button>
              <Button onClick={apply} disabled={busy}>
                {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
                {busy ? 'Applying…' : `Apply ${view.diff.changes} change${view.diff.changes === 1 ? '' : 's'}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

type Owner = { id: string; slug: string; name: string } | null;
type Diff = Awaited<ReturnType<typeof client.context.driftDiff>>;
type View
  = | { kind: 'hidden' }
    | { kind: 'foreign'; key: string; owner: Owner }
    | { kind: 'git'; key: string }
    | { kind: 'apply'; key: string; sha: string; diff: Diff };

/**
 * One read of the server's verdict, turned into what to show. A dismissed
 * (project, sha), an apply in flight, an in-sync folder and an empty diff all
 * come back as nothing to show.
 */
async function readDrift(): Promise<View> {
  const s = await client.context.driftStatus();
  if (!s.available) {
    return { kind: 'hidden' };
  }
  const key = `vocion_drift_dismissed:${s.projectId}:${s.currentSha}`;
  if (remembered(key) || s.inFlight) {
    return { kind: 'hidden' };
  }
  if (!s.own) {
    return { kind: 'foreign', key, owner: s.owner };
  }
  if (!s.drifted) {
    return { kind: 'hidden' };
  }
  if (s.deployManaged) {
    return { kind: 'git', key };
  }
  const diff = await client.context.driftDiff();
  if (diff.changes === 0) {
    // Files changed, nothing an apply would touch — not worth a strip, and not worth asking twice.
    remember(key);
    return { kind: 'hidden' };
  }
  return { kind: 'apply', key, sha: s.currentSha, diff };
}

function remembered(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function remember(key: string): void {
  try {
    localStorage.setItem(key, new Date().toISOString());
  } catch { /* private window — the strip simply comes back next load */ }
}
