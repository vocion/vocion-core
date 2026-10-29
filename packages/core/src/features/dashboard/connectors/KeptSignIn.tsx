'use client';

/**
 * A connection's kept sign-in, on the connectors page: where it stands, how
 * to sign in again, and "Upload a session file". For a connector that keeps
 * one (`libs/browser/keptSignIn.ts`; Squarespace, which has no API for posts
 * and refuses a password typed from a data centre), publish runs start from
 * it. Two ways to make one, neither needing developer tools: the operator's
 * `npm run squarespace:session`, which signs in in a real browser and uploads
 * it, or the file that command writes with `--out`, uploaded here.
 */

import type { Source } from './connectorRows';
import type { KeptSignInSpec } from '@/libs/browser/keptSignIn';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * The workspace in this page's address (`/w/<slug>/…`), for the command a person copies.
 * @param pathname - The page's path.
 */
function workspaceOf(pathname: string): string | null {
  return /^\/(?:[a-z]{2}\/)?w\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

/**
 * Read a picked file as JSON, or say why it is not a session file.
 * @param file - The file.
 */
async function readSessionFile(file: File): Promise<{ ok: true; json: unknown } | { ok: false; why: string }> {
  if (file.size > 1_000_000) {
    return { ok: false, why: 'That file is too large to be a session file.' };
  }
  try {
    return { ok: true, json: JSON.parse(await file.text()) as unknown };
  } catch {
    return { ok: false, why: 'That file is not JSON: pick the file the sign-in command wrote.' };
  }
}

/**
 * Upload a session file to a connection.
 * @param sourceId - The connection.
 * @param json - The file's contents.
 */
export async function uploadSessionFile(sourceId: number, json: unknown): Promise<{ ok: true; resumed: number } | { ok: false; why: string }> {
  const res = await fetch(`/rpc/sources/${sourceId}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
  const body = await res.json().catch(() => null) as { error?: string; resumed?: number[] } | null;
  return res.ok ? { ok: true, resumed: body?.resumed?.length ?? 0 } : { ok: false, why: body?.error ?? `The upload was refused (${res.status}).` };
}

/**
 * The section: status, how to sign in again, and the file input. With a
 * `sourceId` the file is uploaded at once; without one (a connection not
 * saved yet) it is handed to `onPicked`, and uploaded once the connection is.
 * @param props - The connection and its site.
 * @param props.spec - What the connector keeps.
 * @param props.site - The site's address, when known.
 * @param props.source - The saved connection, when there is one.
 * @param props.onPicked - A file picked before the connection was saved.
 * @param props.onUploaded - The upload was kept.
 */
export function KeptSignInSection({ spec, site, source, onPicked, onUploaded }: {
  spec: KeptSignInSpec;
  site: string | null;
  source?: Source | null;
  onPicked?: (json: unknown | null) => void;
  onUploaded?: () => void;
}) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'error'; text: string }>({ kind: 'idle' });
  const status = source?.signIn ?? null;
  const origin = typeof window === 'undefined' ? '<app address>' : window.location.origin;
  const workspace = (typeof window === 'undefined' ? null : workspaceOf(window.location.pathname)) ?? '<workspace>';
  const command = `VOCION_API_TOKEN=<admin token> npm run squarespace:session -- --site ${site ?? '<site address>'} --workspace ${workspace} --url ${origin}`;

  const pick = async (file: File | undefined) => {
    if (!file) {
      onPicked?.(null);
      return;
    }
    const read = await readSessionFile(file);
    if (!read.ok) {
      setState({ kind: 'error', text: read.why });
      return;
    }
    if (!source) {
      onPicked?.(read.json);
      setState({ kind: 'done', text: `${file.name} will be kept once the connection is saved.` });
      return;
    }
    setState({ kind: 'busy' });
    const up = await uploadSessionFile(source.id, read.json);
    if (!up.ok) {
      setState({ kind: 'error', text: up.why });
      return;
    }
    setState({ kind: 'done', text: `Signed in. ${up.resumed > 0 ? `${up.resumed} page${up.resumed === 1 ? '' : 's'} waiting on it carry on now.` : 'Publish runs start from it.'}` });
    onUploaded?.();
  };

  return (
    <div className="space-y-3 text-sm" data-testid="kept-sign-in">
      {status
        ? (
            <p className={status.needsSignIn ? 'text-warn' : 'text-muted-foreground'}>
              {status.needsSignIn
                ? `${spec.vendor} wants a fresh sign-in (${status.needsSignIn.at.slice(0, 10)}): publishing waits for it.`
                : status.kept
                  ? `Signed in: kept ${status.savedAt?.slice(0, 10) ?? ''}${status.savedFrom ? ` from ${status.savedFrom}` : ''}.`
                  : `No ${spec.vendor} sign-in is kept: publishing types the stored password, which ${spec.vendor} may refuse from the cloud.`}
            </p>
          )
        : null}
      <div className="space-y-1">
        <p className="font-medium">Sign in from your own machine</p>
        <p className="text-muted-foreground">
          {`${spec.vendor} refuses a password typed by a browser in the cloud, so you sign in once where it knows you. A workspace admin runs this from a checkout of Vocion; a browser window opens at the site, you sign in as usual (two-step included), and the sign-in is kept here, sealed.`}
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap">{command}</pre>
        <p className="text-muted-foreground">The admin token is from Developers → Create token. On another machine, add --out session.json and upload the file below.</p>
      </div>
      <label className="block space-y-1">
        <span className="font-medium">Upload a session file</span>
        <input
          type="file"
          accept="application/json,.json"
          disabled={state.kind === 'busy'}
          onChange={e => void pick(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1"
        />
      </label>
      {state.kind === 'done' || state.kind === 'error'
        ? <p role="status" className={state.kind === 'error' ? 'text-destructive' : 'text-pass'}>{state.text}</p>
        : null}
    </div>
  );
}

/**
 * "Sign in again": the section in a dialog, from the connection's row.
 * @param props - The connection.
 * @param props.source - The connection.
 * @param props.spec - What its connector keeps.
 * @param props.name - The connector's name.
 * @param props.onClose - Closed.
 * @param props.onUploaded - A sign-in was kept.
 */
export function SignInAgainDialog({ source, spec, name, onClose, onUploaded }: { source: Source; spec: KeptSignInSpec; name: string; onClose: () => void; onUploaded: () => void }) {
  const site = typeof source.config?.siteUrl === 'string' ? source.config.siteUrl : null;
  return (
    <Dialog open onOpenChange={next => !next && onClose()}>
      <DialogContent className="max-w-xl sm:max-w-xl">
        <DialogTitle className="font-display text-lg">{`Sign in to ${site ?? name} again`}</DialogTitle>
        <KeptSignInSection spec={spec} site={site} source={source} onUploaded={onUploaded} />
      </DialogContent>
    </Dialog>
  );
}
