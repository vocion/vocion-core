'use client';

import type { ConnectSource } from './types';
import { AlertTriangle, Calendar, CheckCircle2, Contact, Database, FileText, FolderOpen, Globe, KeyRound, Loader2, Mail, MessageSquare, NotebookText, Plug, SquareKanban, Video } from 'lucide-react';
import { useState } from 'react';

/**
 * The connect card — a connector the turn needed, offered where the person is
 * already looking.
 *
 * Beside `RecommendedActionCard`, with the same boundary validator in front of
 * it (`connectSource.ts`): a payload that cannot name a real connector never
 * becomes a card. Core decides to show it, never the model — the model decided
 * to attempt the work, and a tool call with no credential behind it is that
 * decision.
 *
 * Four rules hold this together, and each one is visible in the markup:
 *
 *   1. **The scope line is a required field, not copy.** Nobody should have to
 *      wonder whether they just handed the company their mailbox.
 *   2. **Every skippable card states the way around it.** The agent honours
 *      the skip; the line under the card is what tells the person there is one.
 *   3. **One card per connector per turn**, and a decline is remembered for the
 *      conversation (`ConnectSourceStack`).
 *   4. **A key connector shows the same form Settings shows**, writing the same
 *      rows through the same vault.
 */

/** The Lucide tile a connector draws with, matched to the Sources page. */
const ICONS: Record<string, typeof Plug> = {
  Mail,
  Calendar,
  FolderOpen,
  Database,
  Globe,
  Contact,
  SquareKanban,
  NotebookText,
  MessageSquare,
  Video,
  FileText,
  KeyRound,
};

function ConnectorTile({ icon }: { icon: string }) {
  const Icon = ICONS[icon] ?? Plug;
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-muted text-foreground">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

/**
 * The scope line — who this connection is for. Always rendered; never inferred
 * from anything else on the card.
 * @param props - Component props.
 * @param props.connect - The connect payload.
 */
function ScopeLine({ connect }: { connect: ConnectSource }) {
  if (connect.state === 'needs-admin') {
    return <span className="text-[10px] font-medium tracking-[0.08em] text-brand-amber-deep uppercase">An admin connects this once</span>;
  }
  const label = connect.scope === 'user' ? 'Connects for you only' : 'Connects for the whole workspace';
  const scopes = connect.requestedScopes.length > 0
    ? ` · ${connect.requestedScopes.map(s => s.split('/').pop()).join(', ')}`
    : '';
  return (
    <span className="text-[10px] font-medium tracking-[0.08em] text-brand-amber-deep uppercase">
      {label}
      {scopes}
    </span>
  );
}

type Phase = { status: 'idle' | 'form' | 'saving' | 'done' | 'error'; message?: string };

export function ConnectSourceCard({ connect, onConnected, onSkip }: {
  connect: ConnectSource;
  /** Fired once a credential is stored, so the turn can be resumed. */
  onConnected?: (connect: ConnectSource) => void;
  /** Fired when the person declines — remembered for the rest of the conversation. */
  onSkip?: (connect: ConnectSource) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ status: 'idle' });
  const [values, setValues] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<Array<{ name: string; label: string; secret?: boolean; optional?: boolean; shapeHint?: string }>>([]);
  const [help, setHelp] = useState<string | null>(null);

  const needsAdmin = connect.state === 'needs-admin';
  const verb = connect.state === 'reconnect' ? 'Reconnect' : 'Connect';

  const openForm = async () => {
    setPhase({ status: 'saving' });
    try {
      const res = await fetch(`/rpc/connectors/${connect.connectorSlug}/connect`);
      const data = await res.json();
      if (!res.ok) {
        setPhase({ status: 'error', message: data.error ?? 'Could not open the connection form.' });
        return;
      }
      setFields(data.fields ?? []);
      setHelp(data.helpText ?? null);
      setPhase({ status: 'form' });
    } catch (err) {
      setPhase({ status: 'error', message: (err as Error).message });
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhase({ status: 'saving' });
    try {
      const res = await fetch(`/rpc/connectors/${connect.connectorSlug}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: values }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase({ status: 'error', message: data.error ?? 'Could not save the credential.' });
        return;
      }
      setPhase({ status: 'done' });
      onConnected?.(connect);
    } catch (err) {
      setPhase({ status: 'error', message: (err as Error).message });
    }
  };

  const startOauth = () => {
    // Phase 3 lands the browser flow. Until then an OAuth connector is
    // connected from Settings, and saying so beats a button that goes nowhere.
    setPhase({
      status: 'error',
      message: `${connect.name} signs in through your browser. Connect it under Settings → Connectors, then ask again.`,
    });
  };

  const complete = fields.length > 0 && fields.every(f => f.optional || (values[f.name] ?? '').trim() !== '');

  return (
    <div className="mt-2 max-w-xl rounded-xl border border-border bg-background">
      {connect.reason && phase.status !== 'done' && (
        <p className="border-b border-border px-3 py-2 text-[13px] leading-snug text-foreground/80">{connect.reason}</p>
      )}

      <div className="flex items-center gap-3 px-3 py-3">
        <ConnectorTile icon={connect.icon} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold">{connect.name}</span>
          <span className="text-[11.5px] leading-snug text-muted-foreground">
            {phase.status === 'done'
              ? 'Connected.'
              : connect.state === 'reconnect'
                ? 'The stored credential can no longer be used.'
                : needsAdmin
                  ? 'Not connected for this workspace.'
                  : 'Not connected yet.'}
          </span>
          <ScopeLine connect={connect} />
        </div>

        {phase.status === 'done'
          ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/45 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Connected
              </span>
            )
          : needsAdmin
            ? (
                <span className="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold text-muted-foreground">
                  Ask an admin
                </span>
              )
            : phase.status === 'form'
              ? null
              : (
                  <button
                    type="button"
                    onClick={connect.authKind === 'oauth' ? startOauth : openForm}
                    disabled={phase.status === 'saving'}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-amber/50 bg-brand-amber/15 px-3.5 py-1.5 text-xs font-semibold text-brand-amber-deep transition hover:bg-brand-amber/25 disabled:opacity-50"
                  >
                    {phase.status === 'saving' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plug className="size-3.5" aria-hidden="true" />}
                    {verb}
                  </button>
                )}
      </div>

      {/* The same fields Settings asks for, from the same platform descriptor,
          written through the same vault. Chat-connect and Settings-connect
          leave the workspace in the same state. */}
      {phase.status === 'form' && (
        <form onSubmit={save} className="space-y-3 border-t border-border px-3 py-3">
          {help && <p className="text-[11.5px] text-muted-foreground">{help}</p>}
          {fields.map(field => (
            <label key={field.name} className="block">
              <span className="text-[12px] font-medium text-foreground/80">
                {field.label}
                {field.optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
              </span>
              <input
                // A non-secret value — an instance URL, an account email —
                // stays readable while it is typed; masking it would only make
                // a typo harder to see.
                type={field.secret ? 'password' : 'text'}
                required={!field.optional}
                autoComplete="off"
                value={values[field.name] ?? ''}
                onChange={e => setValues(prev => ({ ...prev, [field.name]: e.target.value }))}
                placeholder={field.secret ? '••••••••••••••••' : ''}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[13px]"
              />
            </label>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Stored AES-GCM encrypted at rest — the value never touches logs or the browser again.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setPhase({ status: 'idle' })} className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!complete}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
            >
              <KeyRound className="size-3" aria-hidden="true" />
              Save credential
            </button>
          </div>
        </form>
      )}

      {phase.status === 'error' && (
        <div className="flex items-start gap-2 border-t border-border px-3 py-2 text-[12px] text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{phase.message}</span>
        </div>
      )}

      {/* Rule 2: every skippable card states the way around it. A card that
          only an admin can act on has no skip — there is nothing this person
          could have done instead. */}
      {!needsAdmin && phase.status !== 'done' && onSkip && (
        <button
          type="button"
          onClick={() => onSkip(connect)}
          className="w-full border-t border-border px-3 py-2 text-left text-[12px] text-muted-foreground transition hover:text-foreground"
        >
          Skip — answer without
          {' '}
          {connect.name}
          .
        </button>
      )}

      {connect.workspaceGrantAvailable && phase.status === 'idle' && (
        <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
          A colleague already connected
          {' '}
          {connect.name}
          {' '}
          for this workspace — you can use that instead.
        </p>
      )}
    </div>
  );
}
