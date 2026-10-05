'use client';

import type { FailedAttempt } from './LastAttemptLine';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { connectStartHref } from '@/libs/connect/returnTo';
import { client, noStoreClient } from '@/libs/Orpc';
import { afterLoginText, howToConnectFor, platformForConnectorSlug } from '@/libs/platforms/registry';

/**
 * What the Connectors page knows about one connector's login, worked out on
 * the server and sent as plain data (#1080). The way to connect is NOT in
 * here: the form reads that from the connector's own declaration.
 */
export type StoredCredentialInfo = {
  kind: 'login' | 'paste';
  /** The account a login is for; null for a pasted key. */
  account: string | null;
  /** The masked tail, e.g. `…abcd`. */
  hint: string;
  /** False for a login that holds no token string (a GitHub App installation), so there is nothing to Show. */
  revealable: boolean;
};

export type ConnectInfo = {
  /** The login provider's name for a button, e.g. "GitHub". Null when the connector has no login. */
  providerLabel: string | null;
  /** The account a live login in this workspace is for. Null when nobody has logged in. */
  loggedInAs: string | null;
  /**
   * The stored login or pasted key the add form can keep instead of asking
   * for one. Only the account and the masked tail are here: the value stays on
   * the server until an admin presses Show.
   */
  stored: StoredCredentialInfo | null;
  /** The newest attempt, when it failed. */
  lastAttempt: FailedAttempt | null;
};

/**
 * The connector's declared login, when this page can offer it. The server
 * sends a `ConnectInfo` for every connector with a login; without one the
 * page has no provider to send the person to, so it offers paste alone. A
 * connector that declares no login never gets a login button.
 * @param connector - Connector slug.
 * @param info - What the server said about this connector.
 */
function offeredLogin(connector: string, info: ConnectInfo | undefined) {
  return info ? howToConnectFor(connector)?.login : undefined;
}

/** One input of the credential: its key in the saved document, what to call it, and whether it is secret. */
export type CredentialInput = { name: string; label: string; secret: boolean; optional: boolean };

/**
 * What the person has done with the credential in the add form. Two shapes of
 * one thing: keeping the stored login or key (`keepStored`, nothing typed), or
 * typing values. While a stored value is being shown, `snapshot` holds what the
 * server revealed, so Hide can tell an untouched value (drop it, go back to the
 * masked line) from one the person edited (keep it as typed, masked).
 */
export type CredentialDraft = {
  keepStored: boolean;
  values: Record<string, string>;
  snapshot: Record<string, string> | null;
  /** Secret inputs show their text instead of dots. */
  shown: boolean;
  /** A reveal is in flight. */
  revealing: boolean;
  /** Why a reveal did not show a value: a plain sentence, or null. */
  revealNote: string | null;
};

/**
 * The inputs the connector's credential is made of, from the platform's own
 * declaration. A platform with a single input is labelled with what to paste
 * ("Personal access token"); several keep their own labels ("Email", "API token").
 * @param connector - Connector slug.
 */
export function credentialInputsFor(connector: string): CredentialInput[] {
  const platform = platformForConnectorSlug(connector);
  const credential = howToConnectFor(connector)?.paste.credential;
  if (!platform || !credential) {
    return [];
  }
  const single = platform.fields.length === 1;
  return platform.fields.map(field => ({
    name: field.name,
    label: single ? credential : field.label,
    secret: field.secret,
    optional: field.optional === true,
  }));
}

/**
 * The draft the form opens with: the stored login or key is kept when the
 * workspace holds one, otherwise empty inputs.
 * @param info - What the server said about this connector.
 */
export function initialCredentialDraft(info: ConnectInfo | undefined): CredentialDraft {
  return { keepStored: Boolean(info?.stored), values: {}, snapshot: null, shown: false, revealing: false, revealNote: null };
}

/**
 * The names of the credential inputs still empty, for the "still needed" line.
 * Keeping the stored credential needs nothing more.
 * @param inputs - The credential's inputs.
 * @param draft - The form's state.
 */
export function missingCredentialLabels(inputs: CredentialInput[], draft: CredentialDraft): string[] {
  if (draft.keepStored) {
    return [];
  }
  return inputs.filter(input => !input.optional && (draft.values[input.name] ?? '').trim() === '').map(input => input.label);
}

/**
 * Whether the revealed values were left as the server sent them.
 * @param draft - The form's state.
 */
function untouched(draft: CredentialDraft): boolean {
  const snapshot = draft.snapshot;
  return snapshot !== null && Object.keys({ ...snapshot, ...draft.values }).every(name => (snapshot[name] ?? '') === (draft.values[name] ?? ''));
}

/**
 * What to send as the credential: the stored one, or the typed values. A value
 * revealed and left as it was still means the stored one, shown or not:
 * sending it back as typed values would save a frozen copy, so a login would
 * lose its refresh and a one-key platform would revoke the login it came from.
 * @param draft - The form's state.
 */
export function credentialChoiceOf(draft: CredentialDraft): { keepStored: true } | { values: Record<string, string> } {
  return draft.keepStored || untouched(draft) ? { keepStored: true } : { values: draft.values };
}

/**
 * The masked tail as a person reads it: the server's `…abcd` becomes `••••abcd`.
 * @param hint - The stored masked tail.
 */
function maskedTail(hint: string): string {
  return `••••${hint.replace(/^…/, '').replace(/^login$/, '')}`;
}

/**
 * Save the connector and its credential in one request. A refusal throws with
 * the sentence the server wrote, for the form to show as it is.
 * @param connector - Connector slug.
 * @param config - What the person filled in.
 * @param draft - The credential choice.
 */
export async function addConnectorWithCredential(connector: string, config: Record<string, unknown>, draft: CredentialDraft): Promise<void> {
  await client.connect.addConnector({ connector, config, credential: credentialChoiceOf(draft) });
}

/**
 * Press Show on the stored credential: ask the server (admin-only, audited) for
 * the value and open it as editable inputs. The value lives in this draft only.
 * @param connector - Connector slug.
 * @param setDraft - Updates the form's credential state.
 */
async function showStored(connector: string, setDraft: (update: (current: CredentialDraft) => CredentialDraft) => void): Promise<void> {
  setDraft(current => ({ ...current, revealing: true, revealNote: null }));
  try {
    const revealed = await noStoreClient.connect.revealStoredCredential({ connector });
    if (revealed.status === 'ok') {
      setDraft(current => ({ ...current, keepStored: false, values: revealed.values, snapshot: revealed.values, shown: true, revealing: false }));
      return;
    }
    const note = revealed.status === 'no-token' ? 'There is no token to show for this login.' : 'There is no saved credential to show any more.';
    setDraft(current => ({ ...current, revealing: false, revealNote: note }));
  } catch (error) {
    // The server words its refusals ("Could not read the stored credential."); a network failure has its own message.
    setDraft(current => ({ ...current, revealing: false, revealNote: error instanceof Error ? error.message : 'Could not reach the server. Try again.' }));
  }
}

/**
 * Replace: clear the credential to empty, editable inputs.
 * @param setDraft - Updates the form's credential state.
 */
function replaceStored(setDraft: (update: (current: CredentialDraft) => CredentialDraft) => void): void {
  setDraft(() => ({ keepStored: false, values: {}, snapshot: null, shown: false, revealing: false, revealNote: null }));
}

/**
 * Hide on a revealed value: untouched, it is dropped from the page and the
 * masked line returns; edited, the person's own text stays, masked. On a typed
 * value it only masks.
 * @param setDraft - Updates the form's credential state.
 */
function hideValue(setDraft: (update: (current: CredentialDraft) => CredentialDraft) => void): void {
  setDraft(current => (untouched(current)
    ? { keepStored: true, values: {}, snapshot: null, shown: false, revealing: false, revealNote: null }
    : { ...current, snapshot: null, shown: false }));
}

/**
 * The stored credential as one masked line, with Show (when there is a token
 * to show) and Replace. A login that holds no token says why there is nothing
 * to show instead.
 * @param props - The stored credential and what the buttons do.
 * @param props.stored - Account and masked tail.
 * @param props.providerLabel - The login provider's name.
 * @param props.revealing - A reveal is in flight.
 * @param props.note - Why the last Show showed nothing.
 * @param props.onShow - Show was pressed.
 * @param props.onReplace - Replace was pressed.
 */
function StoredCredentialLine({ stored, providerLabel, revealing, note, onShow, onReplace }: {
  stored: StoredCredentialInfo;
  providerLabel: string | null;
  revealing: boolean;
  note: string | null;
  onShow: () => void;
  onReplace: () => void;
}) {
  const text = stored.revealable
    ? `${stored.kind === 'login' ? `Logged in as ${stored.account ?? 'your account'}` : 'Saved key'} · ${maskedTail(stored.hint)}`
    : `${providerLabel ?? 'App'} App installation · ${stored.account ?? 'your account'}`;
  return (
    <div className="space-y-1.5" data-testid="connect-logged-in">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
        <span className="flex-1 font-mono text-xs sm:text-sm" data-testid="connect-stored-text">{text}</span>
        {stored.revealable
          ? (
              <button type="button" onClick={onShow} disabled={revealing} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60">
                <Eye className="size-3.5" aria-hidden="true" />
                Show
              </button>
            )
          : null}
        <button type="button" onClick={onReplace} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">Replace</button>
      </div>
      {stored.revealable
        ? null
        : <p className="text-xs text-muted-foreground">This login is an app installation, so Vocion asks for a short-lived token each time it reads. There is no token to show; Replace to paste one of your own.</p>}
      {note ? <p role="status" data-testid="connect-reveal-note" className="text-xs text-destructive">{note}</p> : null}
    </div>
  );
}

/**
 * One credential input: secret ones masked, with a show/hide toggle.
 * @param props - The input and the form's state.
 * @param props.input - The input's name, label and whether it is secret.
 * @param props.draft - The form's state.
 * @param props.setDraft - Updates the form's credential state.
 * @param props.focusWhenShown - Put the cursor in this box when it appears.
 */
function CredentialBox({ input, draft, setDraft, focusWhenShown }: {
  input: CredentialInput;
  draft: CredentialDraft;
  setDraft: (update: (current: CredentialDraft) => CredentialDraft) => void;
  focusWhenShown: boolean;
}) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusWhenShown) {
      box.current?.focus();
    }
  }, [focusWhenShown]);
  const masked = input.secret && !draft.shown;
  return (
    <label className="block">
      <span className="text-sm font-medium text-foreground/80">
        {input.label}
        {input.optional ? <span className="ml-1 font-normal text-muted-foreground">(optional)</span> : null}
      </span>
      <span className="mt-1 flex items-center gap-2">
        <input
          type={masked ? 'password' : 'text'}
          autoComplete="off"
          ref={box}
          value={draft.values[input.name] ?? ''}
          onChange={event => setDraft(current => ({ ...current, values: { ...current.values, [input.name]: event.target.value } }))}
          placeholder={masked ? '••••••••••••••••' : ''}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
        />
        {input.secret
          ? (
              <button
                type="button"
                aria-label={`${draft.shown ? 'Hide' : 'Show'} ${input.label}`}
                onClick={() => (draft.shown ? hideValue(setDraft) : setDraft(current => ({ ...current, shown: true })))}
                className="rounded-md border p-2 hover:bg-muted"
              >
                {draft.shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            )
          : null}
      </span>
    </label>
  );
}

/**
 * What the credential needs and where to get one, as helper text under the
 * inputs. Every line comes from the declaration; an empty access list prints
 * no line at all.
 * @param props - The declared paste instructions.
 * @param props.paste - `howToConnect.paste`.
 * @param props.paste.credential
 * @param props.paste.access
 * @param props.paste.getItAt
 * @param props.paste.getItAt.url
 * @param props.paste.getItAt.steps
 */
function PasteHelp({ paste }: { paste: { credential: string; access: readonly string[]; getItAt?: { url: string; steps: readonly string[] } } }) {
  return (
    <div className="space-y-1.5 text-xs text-muted-foreground" data-testid="connect-paste-guide">
      {paste.access.length > 0 && <p>{`Needs access to: ${paste.access.join(', ')}`}</p>}
      {paste.getItAt && (
        <div>
          <span>Get one at </span>
          <a href={paste.getItAt.url} target="_blank" rel="noreferrer" className="font-medium text-brand-amber-deep hover:underline">{paste.getItAt.url}</a>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            {paste.getItAt.steps.map(step => <li key={step}>{step}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

/**
 * The credential part of a connector's add form: log in with the vendor and/or
 * real input boxes to paste into, as the connector declares. A stored login or
 * key fills the field, masked, with Show and Replace. The login is a plain link
 * because the start route is an API redirect, not a page.
 * @param props - The connector and the state of the credential.
 * @param props.connector - Connector slug.
 * @param props.info - What the server said about this connector.
 * @param props.draft - The form's credential state.
 * @param props.setDraft - Updates the form's credential state.
 * @param props.focusFirst - Focus the first input (`?paste=1`).
 */
export function ConnectCredential({ connector, info, draft, setDraft, focusFirst }: {
  connector: string;
  info: ConnectInfo | undefined;
  draft: CredentialDraft;
  setDraft: (update: (current: CredentialDraft) => CredentialDraft) => void;
  focusFirst: boolean;
}) {
  const how = howToConnectFor(connector);
  if (!how) {
    return null;
  }
  const login = offeredLogin(connector, info);
  if (draft.keepStored && info?.stored) {
    return (
      <StoredCredentialLine
        stored={info.stored}
        providerLabel={info.providerLabel}
        revealing={draft.revealing}
        note={draft.revealNote}
        onShow={() => void showStored(connector, setDraft)}
        onReplace={() => replaceStored(setDraft)}
      />
    );
  }
  const href = login ? connectStartHref({ provider: login.provider, connector, returnTo: `/dashboard/connectors?add=${connector}` }) : null;
  return (
    <div className="space-y-3" data-testid="connect-credential">
      {login && href
        ? (
            <div className="space-y-2">
              <a href={href} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90">
                {`Log in with ${info?.providerLabel ?? login.provider}`}
              </a>
              {login.access.length > 0 && (
                <p className="text-xs text-muted-foreground">{`Asks for: ${login.access.join(', ')}`}</p>
              )}
              <p className="text-xs text-muted-foreground" data-testid="connect-after-login">{afterLoginText(login.settingsAfterLogin)}</p>
              <p className="pt-1 text-sm font-medium text-foreground/80">{`or paste a ${how.paste.credential}`}</p>
            </div>
          )
        : null}
      <div className="space-y-3">
        {credentialInputsFor(connector).map((input, index) => (
          <CredentialBox key={input.name} input={input} draft={draft} setDraft={setDraft} focusWhenShown={focusFirst && index === 0} />
        ))}
      </div>
      <PasteHelp paste={how.paste} />
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
