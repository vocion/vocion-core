'use client';

import type { FailedAttempt } from './LastAttemptLine';
import { connectStartHref } from '@/libs/connect/returnTo';
import { client } from '@/libs/Orpc';
import { afterLoginText, howToConnectFor } from '@/libs/platforms/registry';

/**
 * What the Connectors page knows about one connector's login, worked out on
 * the server and sent as plain data (#1080). The way to connect is NOT in
 * here: the form reads that from the connector's own declaration.
 */
export type ConnectInfo = {
  /** The login provider's name for a button, e.g. "GitHub". Null when the connector has no login. */
  providerLabel: string | null;
  /** The account a live login in this workspace is for. Null when nobody has logged in. */
  loggedInAs: string | null;
  /** The newest attempt, when it failed. */
  lastAttempt: FailedAttempt | null;
};

/**
 * The connector's declared login, when this page can offer it. The server
 * sends a `ConnectInfo` for every connector with a login; without one the
 * page has no provider to send the person to, so it offers paste alone.
 * @param connector - Connector slug.
 * @param info - What the server said about this connector's login.
 */
function offeredLogin(connector: string, info: ConnectInfo | undefined) {
  return info ? howToConnectFor(connector)?.login : undefined;
}

/**
 * Whether the add form can save from a login: the connector declares one and
 * somebody in the workspace has made it.
 * @param connector - Connector slug.
 * @param info - What the server said about this connector's login.
 */
export function canSaveFromLogin(connector: string, info: ConnectInfo | undefined): boolean {
  return Boolean(offeredLogin(connector, info)) && Boolean(info?.loggedInAs);
}

/**
 * Whether the form is waiting on a choice: the connector can log in, nobody
 * has, and the paste box is not ticked.
 * @param connector - Connector slug.
 * @param info - What the server said about this connector's login.
 * @param pasteChecked - Whether "Paste a token instead" is ticked.
 */
export function needsLoginOrPaste(connector: string, info: ConnectInfo | undefined, pasteChecked: boolean): boolean {
  return Boolean(offeredLogin(connector, info)) && !info?.loggedInAs && !pasteChecked;
}

/**
 * Save the source through the same service the chat action uses. A refusal
 * throws with the sentence the service wrote, for the form to show as it is.
 * @param connector - Connector slug.
 * @param config - What the person filled in.
 */
export async function saveConnectedSource(connector: string, config: Record<string, unknown>): Promise<void> {
  await client.connect.saveSource({ connector, config, createNew: true });
}

/**
 * The paste half of the choice: what to paste, what it must be allowed to
 * do, and where to make one by hand. Every line comes from the declaration;
 * an empty access list prints no line at all.
 * @param props - The declared paste instructions.
 * @param props.paste - `howToConnect.paste`.
 * @param props.paste.credential
 * @param props.paste.access
 * @param props.paste.getItAt
 * @param props.paste.getItAt.url
 * @param props.paste.getItAt.steps
 */
function PasteGuide({ paste }: { paste: { credential: string; access: readonly string[]; getItAt?: { url: string; steps: readonly string[] } } }) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed px-3 py-2 text-sm" data-testid="connect-paste-guide">
      <p>
        Paste a
        {' '}
        <span className="font-medium">{paste.credential}</span>
      </p>
      {paste.access.length > 0 && (
        <p className="text-xs text-muted-foreground">{`Needs access to: ${paste.access.join(', ')}`}</p>
      )}
      {paste.getItAt && (
        <div className="text-xs text-muted-foreground">
          <a href={paste.getItAt.url} target="_blank" rel="noreferrer" className="font-medium text-brand-amber-deep hover:underline">{paste.getItAt.url}</a>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            {paste.getItAt.steps.map(step => <li key={step}>{step}</li>)}
          </ol>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Add the connector, then press Connect on its row to paste the credential.</p>
    </div>
  );
}

/**
 * The top of a connector's add form: log in with the vendor, or paste a
 * token, as the connector declares. Logged in already, it says as whom. The
 * login is a plain link because the start route is an API redirect, not a page.
 * @param props - The connector and the state of the choice.
 * @param props.connector - Connector slug.
 * @param props.info - What the server said about this connector's login.
 * @param props.pasteChecked - Whether "Paste a token instead" is ticked.
 * @param props.onPasteChange - Called when the box is ticked or cleared.
 */
export function ConnectChoice({ connector, info, pasteChecked, onPasteChange }: {
  connector: string;
  info: ConnectInfo | undefined;
  pasteChecked: boolean;
  onPasteChange: (checked: boolean) => void;
}) {
  const how = howToConnectFor(connector);
  if (!how) {
    return null;
  }
  const login = offeredLogin(connector, info);
  if (login && info?.loggedInAs) {
    return (
      <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm" data-testid="connect-logged-in">
        {`Logged in as ${info.loggedInAs}`}
      </p>
    );
  }
  if (!login) {
    return <PasteGuide paste={how.paste} />;
  }
  const href = connectStartHref({ provider: login.provider, connector, returnTo: `/dashboard/connectors?add=${connector}` });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <a href={href} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90">
          {`Log in with ${info?.providerLabel ?? login.provider}`}
        </a>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pasteChecked} onChange={e => onPasteChange(e.target.checked)} />
          Paste a token instead
        </label>
      </div>
      {login.access.length > 0 && (
        <p className="text-xs text-muted-foreground">{`Asks for: ${login.access.join(', ')}`}</p>
      )}
      <p className="text-xs text-muted-foreground" data-testid="connect-after-login">{afterLoginText(login.settingsAfterLogin)}</p>
      {pasteChecked && <PasteGuide paste={how.paste} />}
    </div>
  );
}

/**
 * The failed attempts the connector list shows under each connector, by slug.
 * @param connectInfo - What the server said, per connector.
 */
export function failedAttempts(connectInfo: Record<string, ConnectInfo>): Record<string, FailedAttempt> {
  const failed: Record<string, FailedAttempt> = {};
  for (const [slug, info] of Object.entries(connectInfo)) {
    if (info.lastAttempt) {
      failed[slug] = info.lastAttempt;
    }
  }
  return failed;
}
