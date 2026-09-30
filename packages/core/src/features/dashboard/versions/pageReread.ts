'use client';

/**
 * ONE RE-READ OF THE PAGE, HOWEVER MANY THINGS ASK (Chris, 2026-09-30, #269:
 * "I keep getting refreshed every few seconds … I don't love that it's forcing
 * a hard refresh on this page").
 *
 * A server-rendered record page has two followers: the route's `VersionWatch`
 * (the record itself, and a chat turn's own writes) and the version chip's
 * `useLiveRefresh` (its tasks, runs, cards and evidence). Each re-read the
 * page on its own, so one write — the record, then its body artifact, then the
 * run that made it — re-read it two and three times over, and each re-read
 * re-marked what it thought had changed.
 *
 * Now they ask here. Asks are gathered into at most one re-read per
 * {@link REREAD_MIN_GAP_MS}: the first after a quiet spell runs at once, the
 * rest of a burst ride one re-read at the end of the window. The re-read is
 * the page's OWNER's — `VersionWatch` claims the page when it is mounted, so
 * every re-read runs in its transition and what changed is marked once, in
 * place (`router.refresh()`: the server component renders again, the client
 * keeps its state, its scroll and its open pane). A page with no owner uses
 * the asker's own re-read.
 */

/** The soonest the page re-reads again after it just did. */
export const REREAD_MIN_GAP_MS = 1_500;

type Owner = { reread: () => void };

const owners: Owner[] = [];
const listeners = new Set<(at: number) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let queued: (() => void) | null = null;
let last = 0;

/**
 * Own the page's re-read — the surface that knows how to re-read it in place
 * and mark what changed. The newest owner wins; releasing hands it back.
 * @param owner - How the page re-reads itself.
 * @returns Release the claim.
 */
export function claimPageReread(owner: Owner): () => void {
  owners.push(owner);
  return () => {
    const at = owners.lastIndexOf(owner);
    if (at >= 0) {
      owners.splice(at, 1);
    }
  };
}

function runNow(): void {
  if (timer) {
    clearTimeout(timer);
  }
  timer = null;
  last = Date.now();
  const run = owners.at(-1)?.reread ?? queued;
  queued = null;
  run?.();
  listeners.forEach(l => l(last));
}

/**
 * Ask for the page to be read again. Gathered with every other ask in the
 * window into one re-read, run by the page's owner, or by `fallback` when
 * nothing owns the page. `now` is for what a person or the page's own clock
 * asked for — a tap, a return to the tab, the fallback poll — which reads at
 * once and takes any gathered asks with it.
 * @param fallback - The asker's own re-read, used only when there is no owner.
 * @param opts - Options.
 * @param opts.now - Read now rather than at the end of the window.
 */
export function requestPageReread(fallback: () => void, opts: { now?: boolean } = {}): void {
  queued = fallback;
  if (opts.now) {
    runNow();
    return;
  }
  if (timer) {
    return;
  }
  timer = setTimeout(runNow, Math.max(0, REREAD_MIN_GAP_MS - (Date.now() - last)));
}

/**
 * Hear every re-read of the page, whoever ran it — what a "live · 3s ago"
 * label counts from.
 * @param listener - Called with when it ran, ms.
 * @returns Stop hearing.
 */
export function onPageReread(listener: (at: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests: forget every owner, listener and pending re-read. */
export function resetPageRereadForTests(): void {
  owners.splice(0);
  listeners.clear();
  if (timer) {
    clearTimeout(timer);
  }
  timer = null;
  queued = null;
  last = 0;
}
