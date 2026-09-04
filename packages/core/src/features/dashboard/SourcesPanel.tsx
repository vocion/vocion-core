'use client';

import type { LucideIcon } from 'lucide-react';
import type { ConfigField, ConfigFieldOption, ConfigFieldValue } from '@/libs/sources/configFields';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  CircleAlert,
  Contact,
  Database,
  Eye,
  EyeOff,
  FileJson,
  FileText,
  FolderOpen,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  SquareKanban,
  Trash2,
  Video,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/libs/I18nNavigation';
import {
  buildConfigFromFields,
  configFieldsFor,
  describeMissingFields,
  fieldValuesFromConfig,
  initialFieldValues,
} from '@/libs/sources/configFields';

type Source = {
  id: number;
  slug: string;
  kind: string;
  config: Record<string, unknown>;
  lastSyncedAt: string | null;
  enabled: string;
  createdAt: string;
  authKind: 'none' | 'apikey' | 'oauth';
  objectType: string | null;
  documentCount: number;
  credentialConnected: boolean;
  credentialUpdatedAt: string | null;
  /**
   * Why the credential this connector points at cannot be used, or null when
   * it can. Distinct from `credentialConnected: false`, which means nobody has
   * connected the source yet — one needs a key, the other needs the key it
   * already names put back in service.
   */
  credentialBroken: 'revoked' | 'expired' | 'missing' | null;
  /** The latest sync run for this source, whoever started it. Null if never synced. */
  sync: {
    status: 'running' | 'completed' | 'failed' | 'superseded' | 'abandoned';
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    counts: Record<string, number>;
  } | null;
};

type ConnectorTile = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  authKind: 'none' | 'apikey' | 'oauth';
  /**
   * The stored-credential platform this connector authenticates with, or null
   * when it uses an OAuth grant or needs no credential at all.
   */
  credentialPlatform: string | null;
};

/** How often to re-read the list while a sync is running somewhere. */
const RUNNING_SYNC_POLL_MS = 5000;

/** What a finished sync run reported back, as the panel states it. */
type SyncOutcome = { message: string; hadErrors: boolean };

/** The counts a sync run returns. Mirrors SyncResult on the server. */
type SyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  tombstoned: number;
  errors: number;
  firstError: string | null;
};

/**
 * Turn a sync run's counts into one plain sentence.
 *
 * The counts are the only thing that says a run did nothing useful — a sync
 * that fetched 43 documents and failed to save all 43 still answers 200, and
 * the panel would otherwise show an unchanged document count and no reason.
 * @param result - Counts the sync route returned, if it returned any.
 */
export function describeSyncResult(result: SyncResult | undefined): SyncOutcome {
  if (!result) {
    return { message: 'Sync finished, but the server did not say what it did.', hadErrors: true };
  }
  const saved = result.created + result.updated;
  const parts: string[] = [];
  if (result.created > 0) {
    parts.push(`${result.created} added`);
  }
  if (result.updated > 0) {
    parts.push(`${result.updated} updated`);
  }
  if (result.unchanged > 0) {
    parts.push(`${result.unchanged} unchanged`);
  }
  if (result.tombstoned > 0) {
    parts.push(`${result.tombstoned} removed`);
  }
  const summary = parts.length > 0 ? parts.join(', ') : 'nothing changed';
  if (result.errors === 0) {
    return { message: `Sync finished: ${summary}.`, hadErrors: false };
  }
  const reason = result.firstError ? ` First failure: ${result.firstError}` : '';
  return {
    message: `Sync finished with ${result.errors} document(s) it could not save (${saved} saved, ${summary}).${reason}`,
    hadErrors: true,
  };
}

export function SourcesPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [connectors, setConnectors] = useState<ConnectorTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [addingKind, setAddingKind] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [connectingSource, setConnectingSource] = useState<Source | null>(null);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [deletingSource, setDeletingSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncOutcome, setSyncOutcome] = useState<SyncOutcome | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/rpc/sources');
      const data = await res.json();
      setSources(data.sources ?? []);
      setConnectors(data.connectors ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Re-read the list without blanking the page — used by the while-syncing poll. */
  const refreshQuietly = useCallback(async () => {
    const res = await fetch('/rpc/sources');
    const data = await res.json();
    setSources(data.sources ?? []);
    setConnectors(data.connectors ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A run in another tab (or one still going after a reload) finishes without
  // this tab doing anything, so poll while one is in flight — and only while,
  // since an idle Sources page has nothing to watch for.
  const someoneIsSyncing = sources.some(source => source.sync?.status === 'running');
  useEffect(() => {
    if (!someoneIsSyncing) {
      return;
    }
    const timer = setInterval(() => {
      void refreshQuietly();
    }, RUNNING_SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [someoneIsSyncing, refreshQuietly]);

  const handleSync = useCallback(async (id: number) => {
    setSyncingId(id);
    setError(null);
    setSyncOutcome(null);
    try {
      const res = await fetch(`/rpc/sources/${id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Sync failed');
      } else {
        // A sync that saved some documents and dropped others returns 200, so
        // without this the dropped ones are invisible and the source just looks
        // short. Always report what the run actually did.
        setSyncOutcome(describeSyncResult(data.result as SyncResult | undefined));
        await refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncingId(null);
    }
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Each connector crawls a system and feeds chunks into the org's knowledge base. Native pgvector retrieval — no external services.
        </p>
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          <Plus className="size-4" />
          Add connector
        </button>
      </div>

      {error
        ? (
            <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )
        : null}

      {syncOutcome
        ? (
            <div
              className={syncOutcome.hadErrors
                ? 'flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-500'
                : 'flex items-start gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'}
            >
              {syncOutcome.hadErrors ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
              {syncOutcome.message}
            </div>
          )
        : null}

      {loading
        ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading connectors…
            </div>
          )
        : sources.length === 0
          ? (
              <EmptyState
                icon={Globe}
                title="No connectors yet"
                description="Add a web URL, file upload, or connect a third-party system to populate this org's knowledge base."
                action={{ label: 'Add connector', onClick: () => setPicker(true) }}
              />
            )
          : (
              <div className="grid gap-3 sm:grid-cols-2">
                {sources.map(s => (
                  <SourceRow
                    key={s.id}
                    source={s}
                    syncing={syncingId === s.id}
                    onSync={() => handleSync(s.id)}
                    onEdit={() => setEditingSource(s)}
                    onDelete={() => setDeletingSource(s)}
                    onConnect={() => setConnectingSource(s)}
                  />
                ))}
              </div>
            )}

      {picker
        ? (
            <ConnectorPicker
              connectors={connectors}
              onClose={() => setPicker(false)}
              onPick={(slug) => {
                setPicker(false);
                setAddingKind(slug);
              }}
            />
          )
        : null}
      {addingKind
        ? (
            <AddSourceDialog
              kind={addingKind}
              connector={connectors.find(c => c.slug === addingKind) ?? null}
              onClose={() => setAddingKind(null)}
              onAdded={async () => {
                setAddingKind(null);
                await refresh();
              }}
            />
          )
        : null}
      {editingSource
        ? (
            <AddSourceDialog
              kind={connectorSlugFor(editingSource)}
              connector={connectors.find(c => c.slug === connectorSlugFor(editingSource)) ?? null}
              existing={editingSource}
              onClose={() => setEditingSource(null)}
              onAdded={async () => {
                const editedId = editingSource.id;
                setEditingSource(null);
                await refresh();
                // New settings, new picture: the saved edit already stopped any
                // run reading the old config, so read the source again now
                // rather than leaving stale documents until someone notices.
                await handleSync(editedId);
              }}
            />
          )
        : null}
      {deletingSource
        ? (
            <DeleteSourceDialog
              source={deletingSource}
              onClose={() => setDeletingSource(null)}
              onDeleted={async () => {
                setDeletingSource(null);
                await refresh();
              }}
            />
          )
        : null}
      {connectingSource
        ? (
            <ConnectCredentialDialog
              source={connectingSource}
              onClose={() => setConnectingSource(null)}
              onConnected={async () => {
                setConnectingSource(null);
                await refresh();
              }}
            />
          )
        : null}
    </div>
  );
}

/**
 * One input on the credential form.
 *
 * The server's platform descriptor supplies these for every connector that
 * authenticates with a stored workspace credential. The fallback below covers
 * a connector with no descriptor — a plugin-registered one — where a single
 * token is the only reasonable guess.
 */
type CredField = { key: string; label: string; optional?: boolean };

/** What the form asks for when the server describes no fields for this connector. */
const UNDESCRIBED_CONNECTOR_FIELDS: { help: string; fields: CredField[] } = {
  help: 'Paste the connector access token.',
  fields: [{ key: 'token', label: 'Token' }],
};

/**
 * Whether a form field holds a secret and should therefore be masked.
 *
 * The platform descriptor says so outright when there is one. Without it —
 * every OAuth connector, whose fields come from this file's own table — every
 * value is a token, so masking everything is right.
 * @param platformFields - Field descriptions from the server, or null.
 * @param field - The field being rendered.
 * @param index - Its position, used to line up with the server's list.
 */
function isSecretField(
  platformFields: PlatformField[] | null,
  field: CredField,
  index: number,
): boolean {
  if (!platformFields) {
    return true;
  }
  const described = platformFields[index]?.name === field.key
    ? platformFields[index]
    : platformFields.find(candidate => candidate.name === field.key);
  return described?.secret ?? true;
}

/**
 * The non-empty values for `fields`, keyed by field name. Blank optional fields
 * are left out rather than sent as empty strings.
 * @param fields - The fields the form rendered.
 * @param values - What was typed into them.
 */
function collectCredentialValues(fields: CredField[], values: Record<string, string>): Record<string, string> {
  const collected: Record<string, string> = {};
  for (const field of fields) {
    const value = (values[field.key] ?? '').trim();
    if (value !== '') {
      collected[field.key] = value;
    }
  }
  return collected;
}

/**
 * A credential the workspace already holds for this connector's platform and
 * no other connector is using, as the picker shows it. Name and masked hint
 * only — nothing decrypted.
 */
type StoredCredentialOption = {
  id: string;
  name: string;
  keyHint: string | null;
  expiresAt: string | null;
};

/** One input a platform's credential is made of, as the server describes it. */
type PlatformField = {
  name: string;
  label: string;
  shapeHint: string;
  secret: boolean;
  /** Whether the credential is complete without this value. */
  optional?: boolean;
};

/**
 * Which credential the dialog opens on.
 *
 * The one the connector already names, when the workspace is still offering
 * it — that is the answer needing no typing. When it is not offered, nothing
 * is preselected: a connector whose credential was revoked still names it, and
 * starting on it would show "nothing to change here" above a form with no
 * fields and a button that fails. Nothing preselected puts the fields on
 * screen, which is the only thing that fixes a revoked key.
 *
 * A connector naming nothing yet starts on the newest credential the
 * workspace holds, or on the empty form when it holds none.
 * @param linkedCredentialId - The credential this connector names, or null.
 * @param offered - The credentials the workspace is offering for this platform.
 */
export function initialCredentialChoice(
  linkedCredentialId: string | null,
  offered: StoredCredentialOption[],
): string | null {
  if (linkedCredentialId !== null) {
    const stillOffered = offered.some(option => option.id === linkedCredentialId);
    return stillOffered ? linkedCredentialId : null;
  }
  return offered[0]?.id ?? null;
}

/**
 * The credential dialog: pick a credential the workspace already holds, or
 * supply one.
 *
 * The picker is the point. A workspace that saved its Jira key under API
 * credentials should not be asked for it a second time — and a key supplied
 * here becomes a workspace credential too, listed and rotatable alongside the
 * rest.
 *
 * Only credentials no other connector is using are offered. One credential
 * belongs to one connector, because a key is issued for the single instance or
 * account its connector talks to.
 *
 * The form's fields come from the server's platform descriptor when the
 * connector has one (that is how Strapi's instance URL and Jira's email get
 * asked for), and from this file's own table for the OAuth connectors, whose
 * grants are still per-install.
 * @param props - Component props.
 * @param props.source - The source being connected.
 * @param props.onClose - Called when the dialog is dismissed.
 * @param props.onConnected - Called after a credential is stored or picked.
 */
function ConnectCredentialDialog({ source, onClose, onConnected }: {
  source: Source;
  onClose: () => void;
  onConnected: () => Promise<void> | void;
}) {
  const fallbackSpec = UNDESCRIBED_CONNECTOR_FIELDS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredCredentialOption[]>([]);
  const [platformFields, setPlatformFields] = useState<PlatformField[] | null>(null);
  const [platformHelp, setPlatformHelp] = useState<string | null>(null);
  const [credentialName, setCredentialName] = useState('');
  // Null means "supply a new credential". An id means "use that stored one".
  const [pickedCredentialId, setPickedCredentialId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadStoredCredentials = async () => {
      try {
        const res = await fetch(`/rpc/sources/${source.id}/credentials`);
        const data = await res.json();
        if (cancelled || !res.ok) {
          return;
        }
        setStored(data.available ?? []);
        setPlatformFields(Array.isArray(data.fields) && data.fields.length > 0 ? data.fields : null);
        setPlatformHelp(data.helpText ?? null);
        setPickedCredentialId(initialCredentialChoice(
          typeof data.linkedCredentialId === 'string' ? data.linkedCredentialId : null,
          data.available ?? [],
        ));
      } catch (err) {
        // Not fatal: the form still works by supplying a credential, which is
        // exactly what it did before there was anything to pick.
        console.error('[ConnectCredentialDialog] could not load stored credentials', err);
      }
    };
    loadStoredCredentials();
    return () => {
      cancelled = true;
    };
  }, [source.id]);

  const fields: CredField[] = platformFields
    ? platformFields.map(field => ({ key: field.name, label: field.label, optional: field.optional === true }))
    : fallbackSpec.fields;
  const help = platformHelp ?? fallbackSpec.help;
  const usingStored = pickedCredentialId !== null;
  const complete = usingStored || fields.every(f => f.optional || (values[f.key] ?? '').trim() !== '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body = usingStored
        ? { apiTokenId: pickedCredentialId }
        : { credentials: collectCredentialValues(fields, values), credentialName: credentialName.trim() || undefined };
      const res = await fetch(`/rpc/sources/${source.id}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to store credential');
        return;
      }
      await onConnected();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-xl rounded-xl border bg-background shadow-xl">
        <form onSubmit={submit}>
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <KeyRound className="size-4 text-muted-foreground" />
            <h3 className="font-display text-lg">
              Connect
              {' '}
              {source.slug}
            </h3>
          </div>
          <div className="space-y-4 p-4">
            {stored.length > 0
              ? (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-foreground/80">Credential</legend>
                    <p className="text-xs text-muted-foreground">
                      This workspace already stores credentials for this platform. Pick one, or add another.
                    </p>
                    {stored.map(option => (
                      <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <input
                          type="radio"
                          name="credential-choice"
                          checked={pickedCredentialId === option.id}
                          onChange={() => setPickedCredentialId(option.id)}
                        />
                        <span className="truncate font-medium">{option.name}</span>
                        {option.keyHint
                          ? <span className="font-mono text-xs text-muted-foreground">{option.keyHint}</span>
                          : null}
                      </label>
                    ))}
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name="credential-choice"
                        checked={pickedCredentialId === null}
                        onChange={() => setPickedCredentialId(null)}
                      />
                      <span className="font-medium">Add a new credential</span>
                    </label>
                  </fieldset>
                )
              : null}
            {usingStored
              ? (
                  <p className="text-xs text-muted-foreground">
                    Rotating this credential under API credentials updates this connector — nothing to change here.
                  </p>
                )
              : (
                  <>
                    <p className="text-xs text-muted-foreground">{help}</p>
                    {platformFields
                      ? (
                          <label className="block">
                            <span className="text-sm font-medium text-foreground/80">Credential name</span>
                            <input
                              type="text"
                              value={credentialName}
                              onChange={e => setCredentialName(e.target.value)}
                              placeholder="e.g. Strapi — production"
                              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                            <span className="mt-1 block text-[11px] text-muted-foreground">
                              How this credential is listed, and how you tell it apart from the next one.
                            </span>
                          </label>
                        )
                      : null}
                    {fields.map((field, index) => (
                      <label key={field.key} className="block">
                        <span className="text-sm font-medium text-foreground/80">
                          {field.label}
                          {field.optional
                            ? <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
                            : null}
                        </span>
                        <input
                          // A non-secret value — an instance URL, an account
                          // email — stays readable while it is typed. Masking
                          // it would only make a typo harder to see.
                          type={isSecretField(platformFields, field, index) ? 'password' : 'text'}
                          required={!field.optional}
                          autoComplete="off"
                          value={values[field.key] ?? ''}
                          onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                          placeholder={isSecretField(platformFields, field, index) ? '••••••••••••••••' : ''}
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                        />
                      </label>
                    ))}
                    <p className="text-[11px] text-muted-foreground">
                      {platformFields
                        ? 'Stored AES-GCM encrypted at rest, and listed under API credentials so you can rotate it there.'
                        : 'Stored AES-GCM encrypted at rest — the token never touches logs or the browser again.'}
                    </p>
                  </>
                )}
            {error
              ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )
              : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
            <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !complete}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-3 animate-spin" /> : <KeyRound className="size-3" />}
              {usingStored ? 'Use this credential' : 'Save credential'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Sentence for a credential that exists but cannot be used.
 * @param reason - Why it cannot be used.
 */
function describeBrokenCredential(reason: 'revoked' | 'expired' | 'missing'): string {
  if (reason === 'revoked') {
    return 'Credential revoked';
  }
  if (reason === 'expired') {
    return 'Credential expired';
  }
  return 'Credential missing';
}

/**
 * The credential state on a connector row.
 *
 * Three states, not two. A connector nobody has connected needs a key; one
 * pointing at a credential somebody revoked needs that key put back in service,
 * and saying "needs credentials" for it would hide what actually happened.
 * @param props - Component props.
 * @param props.source - The source whose credential state is being shown.
 */
function CredentialBadge({ source }: { source: Source }) {
  if (source.credentialBroken) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
        <AlertTriangle className="size-3.5" />
        {describeBrokenCredential(source.credentialBroken)}
      </span>
    );
  }
  if (source.credentialConnected) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" />
        Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      <KeyRound className="size-3.5" />
      Needs credentials
    </span>
  );
}

function SourceRow({ source, syncing, onSync, onEdit, onDelete, onConnect }: {
  source: Source;
  syncing: boolean;
  onSync: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onConnect: () => void;
}) {
  const last = source.lastSyncedAt ? new Date(source.lastSyncedAt) : null;
  const lastLabel = last ? formatRelative(last) : 'never';
  const needsCreds = source.authKind !== 'none' && !source.credentialConnected;
  // A run this tab did not start still holds the source — another tab, the
  // scheduler, or one still going after a reload. Pressing Sync now would only
  // earn a 409, so show it as busy instead of letting the operator find out.
  const runningElsewhere = source.sync?.status === 'running';
  const busy = syncing || runningElsewhere;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 flex-shrink-0 items-center justify-center rounded-md bg-amber-100/60 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          <Globe className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/connectors/${source.slug}`} className="truncate font-display hover:underline">{source.slug}</Link>
            <Badge variant="outline" className="font-mono text-[10px]">{source.kind}</Badge>
            {source.objectType
              ? <Badge variant="outline" className="font-mono text-[10px]">{source.objectType}</Badge>
              : null}
          </div>
          <p className="mt-1 text-xs font-medium text-foreground/70">
            {source.documentCount > 0
              ? `${source.documentCount.toLocaleString()} document${source.documentCount === 1 ? '' : 's'} ingested`
              : 'No documents yet'}
          </p>
          <SyncRunLine sync={source.sync} />
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {describeSourceConfig(source.config)}
          </p>
        </div>
        {source.authKind !== 'none'
          ? <CredentialBadge source={source} />
          : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          Last sync ·
          {' '}
          {lastLabel}
        </Badge>
        <div className="flex items-center gap-2">
          {/* Connect is only for a source with nothing stored yet — that is a
              call to action. Once a credential exists, Edit changes it along
              with everything else, so a separate "Update key" was one more
              button doing a job the edit form already does. */}
          {needsCreds
            ? (
                <button
                  type="button"
                  onClick={onConnect}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/50"
                >
                  <KeyRound className="size-3" />
                  Connect
                </button>
              )
            : null}
          <button
            type="button"
            onClick={onEdit}
            title="Edit this connector's settings"
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/50"
          >
            <Pencil className="size-3" />
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete this connector and everything ingested from it"
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/5"
          >
            <Trash2 className="size-3" />
            Delete
          </button>
          <button
            type="button"
            onClick={onSync}
            disabled={busy || needsCreds}
            title={needsCreds
              ? 'Connect credentials first'
              : (runningElsewhere ? 'This connector is already syncing. Wait for it to finish, then try again.' : undefined)}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            {busy
              ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Syncing…
                  </>
                )
              : (
                  <>
                    <RefreshCw className="size-3" />
                    Sync now
                  </>
                )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One line about this source's latest sync run — busy, failed, or finished with
 * documents it could not save.
 *
 * This is the only place a run started somewhere else shows up, and the only
 * place a failure survives a page reload: the panel's own banner is gone as
 * soon as the operator navigates away.
 * @param root0 - Props.
 * @param root0.sync - The latest run for this source, or null if it never ran.
 */
function SyncRunLine({ sync }: { sync: Source['sync'] }) {
  if (!sync) {
    return null;
  }
  if (sync.status === 'running') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Syncing now — started
        {' '}
        {formatRelative(new Date(sync.startedAt))}
      </p>
    );
  }
  if (sync.status === 'abandoned') {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        A sync started
        {' '}
        {formatRelative(new Date(sync.startedAt))}
        {' '}
        never finished — its process stopped. Sync now will take over.
      </p>
    );
  }
  if (sync.status === 'superseded') {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        A sync stopped when the settings changed; a fresh one runs with the new settings.
      </p>
    );
  }
  if (sync.status === 'failed') {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        Last sync failed:
        {' '}
        {sync.error ?? 'no reason was recorded'}
      </p>
    );
  }
  const errorCount = sync.counts.errors ?? 0;
  if (errorCount > 0) {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        Last sync could not save
        {' '}
        {errorCount}
        {' '}
        document
        {errorCount === 1 ? '' : 's'}
        .
      </p>
    );
  }
  return null;
}

/**
 * Which connector a configured source belongs to.
 *
 * Sources are all stored with kind `plugin`; the connector is in the config as
 * `_connector`, falling back to the slug for rows written before that key.
 * @param source - The configured source row.
 */
function connectorSlugFor(source: Source): string {
  return (source.config?._connector as string | undefined) ?? source.kind ?? source.slug;
}

/**
 * Confirm deleting a source, saying exactly what goes with it.
 *
 * Deleting cascades to every document ingested from the source and their
 * embeddings, and there is no undo — so the count is stated up front and the
 * confirm button is the destructive-coloured one.
 * @param root0 - Props.
 * @param root0.source - The source to delete.
 * @param root0.onClose - Close without deleting.
 * @param root0.onDeleted - Called after a successful delete.
 */
function DeleteSourceDialog({ source, onClose, onDeleted }: {
  source: Source;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      const message = await deleteSourceById(source.id);
      if (message) {
        setError(message);
        return;
      }
      await onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-xl border bg-background shadow-xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Trash2 className="size-4 text-destructive" />
          <h3 className="font-display text-lg">
            Delete
            {' '}
            {source.slug}
            ?
          </h3>
        </div>
        <div className="space-y-3 p-4 text-sm">
          <p>
            This removes the connector and the
            {' '}
            {source.documentCount.toLocaleString()}
            {' '}
            document
            {source.documentCount === 1 ? '' : 's'}
            {' '}
            ingested from it, so they stop appearing in search. It cannot be undone.
          </p>
          <p className="text-muted-foreground">
            Nothing changes in
            {' '}
            {source.kind}
            {' '}
            itself, and the stored credential stays — other sources on the same connector keep working.
          </p>
        </div>
        <div className="border-t px-4 py-3">
          {error
            ? (
                <div role="alert" className="mb-3 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              )
            : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleting
                ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      Deleting…
                    </>
                  )
                : 'Delete connector'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function describeSourceConfig(config: Record<string, unknown>): string {
  const c = config as { urls?: string[]; crawl?: { startUrl?: string; maxPages?: number } };
  if (c.crawl?.startUrl) {
    return `Crawl ${c.crawl.startUrl} · up to ${c.crawl.maxPages ?? 50} pages`;
  }
  if (c.urls?.length) {
    return c.urls.length === 1 ? c.urls[0]! : `${c.urls.length} URLs`;
  }
  return 'Configured connector';
}

/**
 * How many connector cards render before the picker asks for a click to show
 * more. The registry is small today but grows with every connector shipped, and
 * a modal that paints a hundred cards on open is the cost nobody notices until
 * it is slow. Rendering a page at a time keeps the open instant without pulling
 * in a virtual-list dependency; the search box is what makes a long list usable.
 */
const CONNECTOR_PAGE_SIZE = 25;

/**
 * The Lucide icons connectors name in their `icon` field (`libs/sources/*.ts`).
 * Listed explicitly rather than looked up off the whole Lucide namespace, which
 * would pull every icon in the library into the client bundle. A connector whose
 * icon is missing here gets the generic plug rather than nothing.
 */
const CONNECTOR_ICONS: Record<string, LucideIcon> = {
  BarChart3,
  Calendar,
  Contact,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  Globe,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Pencil,
  SquareKanban,
  Video,
};

/**
 * A connector's icon. The `icon` field carries a Lucide icon NAME, so rendering
 * it as text used to print its first letter — "D" on the Strapi tile, from
 * `Database`, which reads like a shortcut key and means nothing.
 * @param props.name - The Lucide icon name from the connector's tile data.
 * @param root0
 * @param root0.name
 */
function ConnectorIcon({ name }: { name: string }) {
  const Icon = CONNECTOR_ICONS[name] ?? Plug;
  return <Icon className="size-4" aria-hidden="true" />;
}

/**
 * Connectors whose name, slug or description contains every word in the query,
 * sorted A–Z by name. Word-at-a-time (rather than one substring match) so
 * "google ads" finds the Google Ads tile whichever order the words are typed.
 * An empty query matches everything, which is what the picker shows on open.
 *
 * Alphabetical rather than registry order: the registry is append-ordered by
 * when each connector shipped, which tells an operator scanning the list
 * nothing, and the order shifts under them every time one is added.
 * @param connectors - Every connector the server offers as a tile.
 * @param query - What the operator typed in the picker's search box.
 */
export function filterConnectors(connectors: ConnectorTile[], query: string): ConnectorTile[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 0);
  const matches = words.length === 0
    ? [...connectors]
    : connectors.filter((connector) => {
        const haystack = `${connector.name} ${connector.slug} ${connector.description}`.toLowerCase();
        return words.every(word => haystack.includes(word));
      });
  return matches.sort((left, right) => left.name.localeCompare(right.name));
}

function ConnectorPicker({
  connectors,
  onClose,
  onPick,
}: {
  connectors: ConnectorTile[];
  onClose: () => void;
  onPick: (slug: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(CONNECTOR_PAGE_SIZE);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The picker opens for this input — typing straight away is the point. Done
  // with a ref rather than `autoFocus`, which the a11y lint rules bar.
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const matches = useMemo(() => filterConnectors(connectors, query), [connectors, query]);
  const visible = matches.slice(0, visibleCount);
  const hiddenCount = matches.length - visible.length;

  // A new query starts a fresh page — otherwise a search run after "Show more"
  // would keep the taller list height for a two-result match.
  const changeQuery = (next: string) => {
    setQuery(next);
    setVisibleCount(CONNECTOR_PAGE_SIZE);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-display text-lg">Pick a connector</h3>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
        <div className="border-b px-4 py-3">
          <label className="relative block">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={e => changeQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onClose();
                }
              }}
              placeholder="Search connectors — name or what it ingests"
              aria-label="Search connectors"
              className="w-full rounded-md border border-input bg-background py-2 pr-3 pl-9 text-sm"
            />
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            {matches.length === connectors.length
              ? `${connectors.length} connectors`
              : `${matches.length} of ${connectors.length} connectors`}
          </p>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto p-4">
          {visible.map(c => (
            <button
              type="button"
              key={c.slug}
              onClick={() => onPick(c.slug)}
              className="rounded-lg border p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex size-7 items-center justify-center rounded-md bg-amber-100/60 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                  <ConnectorIcon name={c.icon} />
                </span>
                <span className="font-medium">{c.name}</span>
                {c.authKind !== 'none'
                  ? (
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {c.authKind === 'oauth' ? 'OAuth' : 'API key'}
                      </Badge>
                    )
                  : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{c.description}</p>
            </button>
          ))}
          {matches.length === 0
            ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No connector matches “
                  {query}
                  ”.
                </p>
              )
            : null}
          {hiddenCount > 0
            ? (
                <button
                  type="button"
                  onClick={() => setVisibleCount(count => count + CONNECTOR_PAGE_SIZE)}
                  className="rounded-lg border border-dashed py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  Show
                  {' '}
                  {Math.min(hiddenCount, CONNECTOR_PAGE_SIZE)}
                  {' '}
                  more (
                  {hiddenCount}
                  {' '}
                  hidden)
                </button>
              )
            : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Split a typed collection list into the array the Strapi connector's config
 * schema wants. Commas and newlines both separate, so a pasted list works, and
 * blanks from a trailing comma are dropped rather than failing validation.
 * @param raw
 */
export function parseStrapiCollections(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

/**
 * POST a new source row, reporting the new id so a caller can keep working with
 * it — storing a token, say. `error` carries the server's message on failure.
 * @param kind - Connector slug.
 * @param configJson - The connector's own config blob.
 */
async function createSourceReturningId(
  kind: string,
  configJson: Record<string, unknown>,
): Promise<{ id: number | null; error: string | null }> {
  const res = await fetch('/rpc/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, configJson }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { id: null, error: data.error ?? 'Failed to create connector' };
  }
  const newId = data.source?.id;
  return { id: typeof newId === 'number' ? newId : null, error: null };
}

/**
 * PATCH one source's config. Returns the server's message on failure, null on success.
 * @param sourceId - Source to update.
 * @param configJson - The connector's own config blob, replacing the stored one.
 */
async function updateSourceConfig(sourceId: number, configJson: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`/rpc/sources/${sourceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configJson }),
  });
  const data = await res.json();
  return res.ok ? null : (data.error ?? 'Failed to save the connector');
}

/**
 * DELETE one source, along with everything ingested from it.
 * @param sourceId - Source to remove.
 */
async function deleteSourceById(sourceId: number): Promise<string | null> {
  const res = await fetch(`/rpc/sources/${sourceId}`, { method: 'DELETE' });
  const data = await res.json();
  return res.ok ? null : (data.error ?? 'Failed to delete the connector');
}

/**
 * POST a new source row. Returns the server's message on failure, null on success.
 * @param kind - Connector slug.
 * @param configJson - The connector's own config blob.
 */
async function createSource(kind: string, configJson: Record<string, unknown>): Promise<string | null> {
  const { error } = await createSourceReturningId(kind, configJson);
  return error;
}

/**
 * The chrome every add-source form shares: title, error strip, Cancel and the
 * submit button's pending state. The fields themselves differ per connector —
 * a web crawl needs a start URL, Strapi needs an instance and its collections —
 * so each form owns its own state and hands its config to `onSubmit`.
 * @param root0
 * @param root0.title
 * @param root0.error
 * @param root0.requirement
 * @param root0.notice
 * @param root0.submitLabel
 * @param root0.submitting
 * @param root0.canSubmit
 * @param root0.onClose
 * @param root0.onSubmit
 * @param root0.children
 */
function AddSourceDialogFrame({
  title,
  error,
  requirement,
  notice,
  submitLabel,
  submitting,
  canSubmit,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  error: string | null;
  requirement: string | null;
  /** A standing note about what saving will do, shown above the fields. */
  notice: string | null;
  /** Wording for the submit button — "Add connector" when adding, "Save changes" when editing. */
  submitLabel: string;
  submitting: boolean;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      {/* Header and footer are pinned and only the fields scroll, so a validation
          error — which lands in the footer, next to the button that triggered it —
          is visible wherever the operator has scrolled to. */}
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border bg-background shadow-xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="font-display text-lg">{title}</h3>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {notice
              ? (
                  <p className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {notice}
                  </p>
                )
              : null}
            {children}
          </div>
          <div className="border-t px-4 py-3">
            {error
              ? (
                  <div
                    role="alert"
                    className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </div>
                )
              : null}
            <div className="flex items-center justify-between gap-3">
              {/* What is still missing, said out loud rather than left for the
                  operator to infer from a greyed-out button. */}
              {requirement
                ? (
                    // Announced, because a screen-reader user gets no other
                    // signal that the submit button is refusing and why.
                    <p role="status" aria-live="polite" className="flex items-start gap-1.5 text-sm text-destructive">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      {`Still needed: ${requirement}`}
                    </p>
                  )
                : <span />}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                {/* The title rides the wrapper, not the button: a disabled button
                    swallows its own hover events, so its tooltip never opens. */}
                <span title={canSubmit ? undefined : (requirement ?? undefined)}>
                  <button
                    type="submit"
                    disabled={submitting || !canSubmit}
                    className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                  >
                    {submitting
                      ? (
                          <>
                            <Loader2 className="size-3 animate-spin" />
                            Saving…
                          </>
                        )
                      : submitLabel}
                  </button>
                </span>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const FIELD_CLASS = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/** Ties the Strapi token label to its input without nesting the eye button inside the label. */
const TOKEN_INPUT_ID = 'strapi-api-token';

/** How long the URL and token must sit unchanged before collections load on their own. */
const AUTO_LOAD_DEBOUNCE_MS = 700;

/**
 * One key for a URL plus token, so an instance already read is not read again.
 * The separator is a NUL because it cannot appear in either value.
 * @param baseUrl - Instance URL as typed, trimmed.
 * @param token - API token as typed, trimmed.
 */
function credentialPairKey(baseUrl: string, token: string): string {
  return `${baseUrl}\u0000${token}`;
}

/**
 * True when a check ran and the instance would not hand over the collection.
 * An absent check means nothing was verified yet, which is not a failure.
 * @param check - Verdict for one collection, or undefined when unchecked.
 */
function isUnreadable(check: CollectionCheck | undefined): check is CollectionCheck {
  return check !== undefined && check.status !== 'ok';
}

/** Row-sized wording for a failed collection check; the full message goes in the title. */
const COLLECTION_STATUS_LABELS: Record<CollectionCheck['status'], string> = {
  'ok': 'reads',
  'not-found': 'No such collection',
  'unauthorized': 'Token rejected',
  'forbidden': 'No read permission',
  'error': 'Check failed',
};

/**
 * Plain-English name for whatever is still missing before a Strapi source can be
 * added, in the order the form is filled. Null once nothing is missing.
 *
 * This is the disabled Add connector button's explanation — both as a line in the
 * footer and as its hover tooltip — so it has to read like an instruction, not
 * like a validation code.
 * @param state - What the form holds right now.
 * @param state.baseUrl - Instance URL as typed.
 * @param state.token - API token as typed.
 * @param state.chosenCount - How many collections are ticked or typed.
 * @param state.hasCatalogue - Whether the instance listed its collections, so they are ticked rather than typed.
 * @param state.failedChecks - Chosen collections this instance would not read.
 */
function describeMissingPiece(state: {
  baseUrl: string;
  token: string;
  chosenCount: number;
  hasCatalogue: boolean;
  failedChecks: CollectionCheck[];
}): string | null {
  if (state.baseUrl.trim() === '') {
    return 'the Strapi instance URL';
  }
  if (state.token.trim() === '') {
    return 'an API token';
  }
  if (state.chosenCount === 0) {
    return state.hasCatalogue
      ? 'at least one collection ticked in the list above'
      : 'at least one collection — type its plural api id above';
  }
  if (state.failedChecks.length > 0) {
    const named = state.failedChecks
      .map(check => `${check.collection} (${COLLECTION_STATUS_LABELS[check.status].toLowerCase()})`)
      .join(', ');
    return `a fix for ${named} — this instance won't read it, so syncing it would store nothing`;
  }
  return null;
}

function AddWebSourceDialog({ kind, title, existing, onClose, onAdded }: {
  kind: string;
  title: string;
  /** The source being edited, or null when adding a new one. */
  existing: Source | null;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const existingConfig = (existing?.config ?? {}) as {
    urls?: string[];
    crawl?: { startUrl?: string; maxPages?: number };
  };
  const [url, setUrl] = useState(existingConfig.crawl?.startUrl ?? existingConfig.urls?.[0] ?? '');
  const [crawl, setCrawl] = useState(existing ? existingConfig.crawl !== undefined : true);
  const [maxPages, setMaxPages] = useState(existingConfig.crawl?.maxPages ?? 20);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const configJson = crawl
        ? { crawl: { startUrl: url, maxDepth: 1, maxPages } }
        : { urls: [url] };
      const message = existing
        ? await updateSourceConfig(existing.id, configJson)
        : await createSource(kind, configJson);
      if (message) {
        setError(message);
        return;
      }
      await onAdded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AddSourceDialogFrame
      title={title}
      error={error}
      requirement={url.trim().length > 0 ? null : 'a URL to read'}
      submitLabel={existing ? 'Save changes' : 'Add connector'}
      notice={existing ? 'Saving restarts this connector\'s sync: a run in progress stops, and a fresh one reads it with the new settings.' : null}
      submitting={submitting}
      canSubmit={url.trim().length > 0}
      onClose={onClose}
      onSubmit={submit}
    >
      <label className="block">
        <span className="text-sm font-medium text-foreground/80">URL</span>
        <input
          type="url"
          required
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://example.com/docs"
          className={FIELD_CLASS}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={crawl} onChange={e => setCrawl(e.target.checked)} />
        Crawl linked pages on the same origin
      </label>
      {crawl
        ? (
            <label className="block">
              <span className="text-sm font-medium text-foreground/80">Max pages</span>
              <input
                type="number"
                min={1}
                max={200}
                value={maxPages}
                onChange={e => setMaxPages(Math.max(1, Math.min(200, Number.parseInt(e.target.value, 10) || 1)))}
                className={FIELD_CLASS}
              />
            </label>
          )
        : null}
    </AddSourceDialogFrame>
  );
}

/**
 * A select field's choices, with the value currently held added to the end when
 * the connector no longer offers it.
 *
 * Without this the browser shows the first choice while the form state still
 * holds the old value, so the dropdown says one thing and saving does another.
 * @param field - The select field being rendered.
 * @param value - What the form currently holds for it.
 */
function optionsIncludingCurrent(field: ConfigField, value: ConfigFieldValue | undefined): ConfigFieldOption[] {
  const declared = field.options ?? [];
  const current = String(value ?? '');
  if (current === '' || declared.some(option => option.value === current)) {
    return [...declared];
  }
  return [...declared, { value: current, label: `${current} (no longer offered)` }];
}

/**
 * One input on a schema-driven add-source form.
 *
 * The shape of the input follows the field's declared type: a checkbox for a
 * yes/no setting, a dropdown for a fixed set of choices, a bounded number box,
 * and a comma-separated text box for a list. Required fields carry a marker,
 * because before this the only sign a field was needed was a submit button
 * that stayed disabled without saying why.
 * @param props - Component props.
 * @param props.field - What to ask for.
 * @param props.value - What the input currently holds.
 * @param props.onChange - Called with the new value as it is typed.
 */
function SourceConfigInput({ field, value, onChange }: {
  field: ConfigField;
  value: ConfigFieldValue | undefined;
  onChange: (value: ConfigFieldValue) => void;
}) {
  // The asterisk is decoration; `required` on the input is what a screen
  // reader announces, so both are set from the same flag.
  const isRequired = field.required === true;
  const labelText = (
    <span className="text-sm font-medium text-foreground/80">
      {field.label}
      {isRequired ? <span className="ml-0.5 text-destructive" aria-hidden="true">*</span> : null}
    </span>
  );
  const helpText = field.help ? <span className="mt-1 block text-xs text-muted-foreground">{field.help}</span> : null;

  if (field.type === 'boolean') {
    return (
      <label className="block">
        <span className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === true}
            required={isRequired}
            onChange={e => onChange(e.target.checked)}
          />
          {labelText}
        </span>
        {helpText}
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <label className="block">
        {labelText}
        <select
          value={String(value ?? '')}
          required={isRequired}
          onChange={e => onChange(e.target.value)}
          className={FIELD_CLASS}
        >
          {/* A saved value the connector no longer offers is listed rather than
              dropped. Dropping it would leave the box showing the first choice
              while the form still held — and would save — the old one. */}
          {optionsIncludingCurrent(field, value).map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {helpText}
      </label>
    );
  }

  if (field.type === 'number') {
    return (
      <label className="block">
        {labelText}
        {/* min/step keep the obvious mistakes — 0, a negative, a decimal — from
            reaching a schema that only accepts whole numbers above zero. */}
        <input
          type="number"
          step={1}
          required={isRequired}
          min={field.min}
          max={field.max}
          value={value === undefined ? '' : String(value)}
          onChange={e => onChange(e.target.value)}
          className={FIELD_CLASS}
        />
        {helpText}
      </label>
    );
  }

  if (field.type === 'stringArray') {
    return (
      <label className="block">
        {labelText}
        <input
          type="text"
          required={isRequired}
          value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
          placeholder={field.placeholder}
          onChange={e => onChange(e.target.value)}
          className={FIELD_CLASS}
        />
        {helpText}
      </label>
    );
  }

  return (
    <label className="block">
      {labelText}
      <input
        type={field.type === 'url' ? 'url' : 'text'}
        required={isRequired}
        value={String(value ?? '')}
        placeholder={field.placeholder}
        onChange={e => onChange(e.target.value)}
        className={FIELD_CLASS}
      />
      {helpText}
    </label>
  );
}

/**
 * The add-source form for every connector whose settings are a plain list of
 * inputs — which is all of them but `web` and `strapi`.
 *
 * What to ask for comes from `configFields.ts`, keyed by connector slug, so
 * each connector gets the fields its own config schema actually reads. Before
 * this, every connector but Strapi was handed the web crawler's form, and a
 * Jira or S3 source was created from a URL the connector never looked at.
 *
 * Overrides almost nobody touches — API base URLs pointed at a sandbox or an
 * EU region — sit behind "Advanced settings" so the form opens on the handful
 * of settings that matter.
 * @param props - Component props.
 * @param props.kind - Connector slug.
 * @param props.title - Dialog heading.
 * @param props.fields - The fields this connector asks for.
 * @param props.existing - The source being edited, or null when adding a new one.
 * @param props.onClose - Called when the dialog is dismissed.
 * @param props.onAdded - Called after the source is saved.
 */
function AddConfigurableSourceDialog({ kind, title, fields, existing, onClose, onAdded }: {
  kind: string;
  title: string;
  fields: ConfigField[];
  existing: Source | null;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const [values, setValues] = useState<Record<string, ConfigFieldValue>>(() => (
    existing
      ? fieldValuesFromConfig(fields, (existing.config ?? {}) as Record<string, unknown>)
      : initialFieldValues(fields)
  ));

  const [advancedShown, setAdvancedShown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The saved config goes in so an edit carries through settings this form has
  // no input for, instead of deleting them.
  const savedConfig = (existing?.config ?? {}) as Record<string, unknown>;
  const { config, missingLabels } = buildConfigFromFields(fields, values, savedConfig);
  const everydayFields = fields.filter(field => field.advanced !== true);
  const advancedFields = fields.filter(field => field.advanced === true);

  const setFieldValue = (key: string, value: ConfigFieldValue) => {
    setValues(current => ({ ...current, [key]: value }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missingLabels.length > 0) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const message = existing
        ? await updateSourceConfig(existing.id, config)
        : await createSource(kind, config);
      if (message) {
        setError(message);
        return;
      }
      await onAdded();
    } catch (err) {
      // A network failure throws rather than returning a message. Without this
      // the dialog sat on a spinner that never resolved and said nothing.
      console.error('[AddConfigurableSourceDialog] could not save the connector', err);
      setError(err instanceof Error ? err.message : 'Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AddSourceDialogFrame
      title={title}
      error={error}
      requirement={describeMissingFields(missingLabels)}
      submitLabel={existing ? 'Save changes' : 'Add connector'}
      notice={existing ? 'Saving restarts this connector\'s sync: a run in progress stops, and a fresh one reads it with the new settings.' : null}
      submitting={submitting}
      canSubmit={missingLabels.length === 0}
      onClose={onClose}
      onSubmit={submit}
    >
      {everydayFields.map(field => (
        <SourceConfigInput
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={value => setFieldValue(field.key, value)}
        />
      ))}

      {advancedFields.length > 0
        ? (
            <div className="rounded-lg border border-dashed">
              <button
                type="button"
                onClick={() => setAdvancedShown(shown => !shown)}
                aria-expanded={advancedShown}
                className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Advanced settings
                <span aria-hidden="true">{advancedShown ? '−' : '+'}</span>
              </button>
              {advancedShown
                ? (
                    <div className="space-y-4 border-t px-3 py-3">
                      {advancedFields.map(field => (
                        <SourceConfigInput
                          key={field.key}
                          field={field}
                          value={values[field.key]}
                          onChange={value => setFieldValue(field.key, value)}
                        />
                      ))}
                    </div>
                  )
                : null}
            </div>
          )
        : null}
    </AddSourceDialogFrame>
  );
}

/** One collection's verdict from the inspect call. Mirrors `StrapiCollectionCheck`. */
type CollectionCheck = {
  collection: string;
  status: 'ok' | 'not-found' | 'forbidden' | 'unauthorized' | 'error';
  entryCount: number | null;
  message: string | null;
  /** True when the collection reads without any credential, so the read proves nothing about the token. */
  publiclyReadable?: boolean;
};

/** What the inspect route reported about an instance. */
type StrapiInspection = {
  reachable: boolean;
  authorized: boolean;
  detectedVersion: 4 | 5 | null;
  collections: string[] | null;
  enumerationNote: string | null;
  checks: CollectionCheck[];
  error: string | null;
};

/**
 * Ask the server to look at a Strapi instance with these details. The call goes
 * through our own API rather than the browser because a partner's Strapi will
 * not allow a cross-origin request, and the token should not leave our origin.
 * @param baseUrl - Instance root as typed.
 * @param token - The API token as typed.
 * @param collections - Names to verify; empty asks only for the catalogue.
 */
async function inspectStrapi(
  baseUrl: string,
  token: string,
  collections: string[],
): Promise<{ inspection: StrapiInspection | null; error: string | null }> {
  const res = await fetch('/rpc/connectors/strapi/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { baseUrl }, credentials: { token }, collections }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { inspection: null, error: data.error ?? 'Could not reach that Strapi instance' };
  }
  return { inspection: data.inspection as StrapiInspection, error: null };
}

/**
 * Store the API token against a freshly created source, so adding a Strapi
 * source is one pass instead of add-then-Connect.
 * @param sourceId - The id returned by the create call.
 * @param token - The API token to store in the vault.
 */
/** A source's stored credential, as an Edit form needs to see it. */
type LoadedSourceCredential = {
  token: string | null;
  /** Instance URL, for a platform that keeps one with its token (Strapi). */
  baseUrl: string | null;
  /** The stored credential the install points at, when it points at one. */
  apiTokenId: string | null;
  error: string | null;
};

/**
 * Read back a source's stored credential so an Edit form can load it.
 *
 * Returns nulls when there is nothing stored, and the server's message when the
 * read failed — a credential that will not decrypt must not look like an empty
 * field, or the operator would save an edit believing the old token still works.
 * @param sourceId - Source whose credential to read.
 */
async function loadSourceCredential(sourceId: number): Promise<LoadedSourceCredential> {
  const res = await fetch(`/rpc/sources/${sourceId}/credentials`);
  const data = await res.json();
  if (!res.ok) {
    return { token: null, baseUrl: null, apiTokenId: null, error: data.error ?? 'Could not read the stored token' };
  }
  const stored = data.credentials as { token?: string; baseUrl?: string } | null;
  return {
    token: stored?.token ?? null,
    baseUrl: stored?.baseUrl ?? null,
    apiTokenId: (data.linkedCredentialId as string | null) ?? null,
    // A credential the install names but cannot use comes back with its own
    // reason, and the form has to show it rather than an empty token field.
    error: (data.error as string | undefined) ?? null,
  };
}

/**
 * Store or rotate the credential a source authenticates with.
 *
 * With `apiTokenId` this rotates that credential in place, so every install
 * pointing at it picks the new value up. Without one it stores a new
 * workspace credential and points this install at it.
 * @param sourceId - The source the credential is for.
 * @param credentials - The values, keyed by the platform's field names.
 * @param apiTokenId - The credential to rotate, or null to store a new one.
 */
async function storeSourceCredential(
  sourceId: number,
  credentials: Record<string, string>,
  apiTokenId: string | null,
): Promise<string | null> {
  const res = await fetch(`/rpc/sources/${sourceId}/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apiTokenId ? { apiTokenId, credentials } : { credentials }),
  });
  const data = await res.json();
  if (!res.ok) {
    return data.error ?? 'The connector was created but its credential could not be stored';
  }
  return null;
}

/**
 * What one collection's check says, rendered beside the collection's own name:
 * an entry count when it reads, the reason when it doesn't.
 * @param root0 - Component props.
 * @param root0.check - The verdict for this collection, or undefined before any check ran.
 */
function CollectionVerdict({ check }: { check: CollectionCheck | undefined }) {
  if (!check) {
    return null;
  }
  if (check.status === 'ok') {
    return (
      <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        {check.entryCount ?? 0}
        {check.entryCount === 1 ? ' entry' : ' entries'}
      </span>
    );
  }
  // Short label on the row, full sentence on hover — the panel's own note above
  // carries the long version, so a row does not need to wrap to three lines.
  return (
    <span
      title={check.message ?? check.status}
      className="ml-auto flex items-center gap-1 text-right text-xs text-destructive"
    >
      <CircleAlert className="size-3.5 shrink-0" />
      {COLLECTION_STATUS_LABELS[check.status]}
    </span>
  );
}

/**
 * Strapi's own fields. The operator gives the instance URL and an API token
 * first; the server then looks the instance up and, where the instance allows
 * it, hands back a list of collections to tick rather than plural api ids to
 * type from memory. Instances that keep their content-type list behind the admin
 * API cannot be enumerated with an API token, so the typed list stays available
 * and each name typed there is verified against the instance.
 *
 * One source covers every collection on one instance — `ensureSource` keys a row
 * on (org, connector slug), so a second Strapi source would resolve back to the
 * first (see `libs/sources/strapi.ts`). That is why collections are a list here
 * rather than a source each.
 * @param root0 - Component props.
 * @param root0.kind - Connector slug, always `strapi` here.
 * @param root0.title - Dialog heading.
 * @param root0.existing
 * @param root0.onClose - Dismiss without creating anything.
 * @param root0.onAdded - Called after the source and its token are stored.
 */
function AddStrapiSourceDialog({ kind, title, existing, onClose, onAdded }: {
  kind: string;
  title: string;
  /** The source being edited, or null when adding a new one. */
  existing: Source | null;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const existingConfig = (existing?.config ?? {}) as {
    baseUrl?: string;
    collections?: string[];
    populate?: string;
    pageSize?: number;
  };
  // The token is never sent back to the browser, so an edit starts with the
  // field empty and keeps whatever is stored unless something is typed.
  const tokenAlreadyStored = existing?.credentialConnected ?? false;
  const [baseUrl, setBaseUrl] = useState(existingConfig.baseUrl ?? '');
  const [token, setToken] = useState('');
  /** The token as stored, so saving an untouched field writes no new credential. */
  const [storedToken, setStoredToken] = useState<string | null>(null);
  /** The instance URL as stored, for the same reason — it rotates with the token. */
  const [storedBaseUrl, setStoredBaseUrl] = useState<string | null>(null);
  /**
   * The stored credential this install points at, when it has one. Rotating
   * that row rather than storing another is what keeps a second Strapi
   * credential from appearing every time somebody edits the token.
   */
  const [linkedCredentialId, setLinkedCredentialId] = useState<string | null>(null);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [collectionsText, setCollectionsText] = useState((existingConfig.collections ?? []).join(', '));
  const [selected, setSelected] = useState<string[]>(existingConfig.collections ?? []);
  const [inspection, setInspection] = useState<StrapiInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [populate, setPopulate] = useState(existingConfig.populate ?? '*');
  const [pageSize, setPageSize] = useState(existingConfig.pageSize ?? 100);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inspectRequestRef = useRef(0);
  const lastLoadedPairRef = useRef<string | null>(null);

  // Load the stored token when editing, so the field shows what will be used
  // rather than an empty box that reads as if the token had been dropped. Once
  // it lands, the URL and token are both present and the collections re-check
  // themselves, which is exactly what an operator opening Edit wants to see.
  const editingSourceId = existing?.id ?? null;
  useEffect(() => {
    if (editingSourceId === null) {
      return;
    }
    let stillOpen = true;
    const load = async () => {
      const loaded = await loadSourceCredential(editingSourceId);
      if (!stillOpen) {
        return;
      }
      setLinkedCredentialId(loaded.apiTokenId);
      if (loaded.error) {
        setError(loaded.error);
        return;
      }
      if (loaded.token) {
        setStoredToken(loaded.token);
        setToken(loaded.token);
      }
      // The instance URL now travels with the token. An install migrated off
      // its config copy has it here and nowhere else, so this is what fills the
      // field the operator is about to edit.
      if (loaded.baseUrl) {
        setStoredBaseUrl(loaded.baseUrl);
        setBaseUrl(loaded.baseUrl);
      }
    };
    void load();
    return () => {
      stillOpen = false;
    };
  }, [editingSourceId]);

  const typedCollections = parseStrapiCollections(collectionsText);
  const catalogue = inspection?.collections ?? null;
  const hasCatalogue = catalogue !== null;
  const chosen = catalogue ? selected : typedCollections;
  const connectionReady = baseUrl.trim().length > 0 && (token.trim().length > 0 || tokenAlreadyStored);

  /**
   * This collection's verdict from the last check, so a count can sit beside the
   * collection's own name instead of in a list of its own.
   * @param collection - Plural api id to look up.
   */
  function checkFor(collection: string): CollectionCheck | undefined {
    return inspection?.checks.find(check => check.collection === collection);
  }

  // A collection the instance could not read is not worth saving: the sync would
  // hit the same 404 or 403 on every run. Only a check that actually ran counts,
  // so typed ids that have never been checked still submit.
  const failedChecks = chosen
    .map(collection => checkFor(collection))
    .filter(isUnreadable);

  const requirement = describeMissingPiece({
    baseUrl,
    token: token.trim() === '' && tokenAlreadyStored ? 'stored' : token,
    chosenCount: chosen.length,
    hasCatalogue,
    failedChecks,
  });

  /**
   * Reads the instance and replaces the catalogue. Safe to call again while an
   * earlier read is still in flight: each call takes the next request number and
   * only the newest one is allowed to write state, so a slow first answer can't
   * land on top of a fresh refresh.
   */
  const runInspect = useCallback(async () => {
    const instanceUrl = baseUrl.trim();
    const apiToken = token.trim();
    // Claim this pair before awaiting, so the auto-load effect does not queue a
    // second identical read behind this one.
    lastLoadedPairRef.current = credentialPairKey(instanceUrl, apiToken);
    const requestNumber = inspectRequestRef.current + 1;
    inspectRequestRef.current = requestNumber;
    setInspecting(true);
    setError(null);
    const { inspection: found, error: message } = await inspectStrapi(
      instanceUrl,
      apiToken,
      hasCatalogue ? [] : parseStrapiCollections(collectionsText),
    );
    if (inspectRequestRef.current !== requestNumber) {
      return;
    }
    setInspecting(false);
    if (message) {
      setError(message);
      setInspection(null);
      return;
    }
    setInspection(found);
    // A reload can turn a collection that read fine into one that no longer
    // does — a revoked permission, a renamed type. Untick those rather than
    // leaving a dead choice ticked and the submit button mysteriously off.
    const rejected = (found?.checks ?? []).filter(isUnreadable).map(check => check.collection);
    if (rejected.length > 0) {
      setSelected(current => current.filter(collection => !rejected.includes(collection)));
    }
    // A reachable instance with a caveat — a rejected token, or collections
    // that are public so the token stays unproven — belongs in the panel's own
    // note, not the dialog's red failure strip.
    setError(found && !found.reachable ? found.error : null);
  }, [baseUrl, token, collectionsText, hasCatalogue]);

  // Pasting a URL and a token is the whole instruction, so read the instance as
  // soon as both are present rather than waiting for a button. Debounced because
  // typing a URL by hand would otherwise fire a read per keystroke, and skipped
  // once a pair has been read so a manual refresh isn't immediately repeated.
  useEffect(() => {
    if (baseUrl.trim() === '' || token.trim() === '') {
      return;
    }
    if (lastLoadedPairRef.current === credentialPairKey(baseUrl.trim(), token.trim())) {
      return;
    }
    const timer = setTimeout(() => {
      void runInspect();
    }, AUTO_LOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [baseUrl, token, runInspect]);

  const toggleCollection = (collection: string) => {
    setSelected(current => (
      current.includes(collection)
        ? current.filter(entry => entry !== collection)
        : [...current, collection]
    ));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const instanceUrl = baseUrl.trim().replace(/\/+$/, '');
      // Write a credential only when something about it actually changed: an
      // empty token field means "keep what is stored", and re-saving the values
      // we just loaded would rotate a credential to itself. The URL counts as a
      // change too, because it is half of the same credential.
      const tokenIsNew = token.trim() !== '' && token.trim() !== storedToken;
      const urlIsNew = storedBaseUrl !== null && instanceUrl !== storedBaseUrl;
      const credentialIsNew = tokenIsNew || urlIsNew || storedBaseUrl === null;
      const willWriteCredential = credentialIsNew && token.trim() !== '';

      // No `baseUrl` in the config: a Strapi token only works against the
      // instance that issued it, so the URL is part of the credential and
      // rotates with it.
      //
      // Except while no credential holds it. A connector set up before the URL
      // moved keeps it in the config, and this save replaces the whole config —
      // so dropping it without putting it anywhere would leave the connector
      // with an instance URL in neither place and every sync refusing. Keeping
      // it is also what lets the backfill migrate the connector later.
      const configJson = {
        collections: chosen,
        populate: populate.trim() === '' ? '*' : populate.trim(),
        pageSize,
        ...(willWriteCredential || instanceUrl === '' ? {} : { baseUrl: instanceUrl }),
      };

      if (existing) {
        // Credential first, config second. The config write is what drops the
        // legacy `baseUrl`, so a credential write failing after it would strand
        // a connector that was working a moment ago.
        if (willWriteCredential) {
          const credentialError = await storeSourceCredential(
            existing.id,
            { baseUrl: instanceUrl, token: token.trim() },
            linkedCredentialId,
          );
          if (credentialError) {
            setError(credentialError);
            return;
          }
        }
        const message = await updateSourceConfig(existing.id, configJson);
        if (message) {
          setError(message);
          return;
        }
      } else {
        // A new connector has to exist before a credential can name it.
        const created = await createSourceReturningId(kind, configJson);
        if (created.error || created.id === null) {
          setError(created.error ?? 'Failed to create connector');
          return;
        }
        if (willWriteCredential) {
          const credentialError = await storeSourceCredential(
            created.id,
            { baseUrl: instanceUrl, token: token.trim() },
            linkedCredentialId,
          );
          if (credentialError) {
            setError(credentialError);
            return;
          }
        }
      }
      await onAdded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AddSourceDialogFrame
      title={title}
      error={error}
      requirement={requirement}
      submitLabel={existing ? 'Save changes' : 'Add connector'}
      notice={existing ? 'Saving restarts this connector\'s sync: a run in progress stops, and a fresh one reads it with the new settings.' : null}
      submitting={submitting}
      canSubmit={connectionReady && chosen.length > 0 && failedChecks.length === 0}
      onClose={onClose}
      onSubmit={submit}
    >
      <p className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">How this works:</span>
        {' '}
        fill in the instance URL and an API token and this reads the instance on its own — both are needed, the token
        says you're allowed in and the URL says which instance to ask.
        {' '}
        <span className="font-medium">Reload collections</span>
        {' '}
        reads it again whenever you want a fresh look. Most instances won't hand out their list of collections (Strapi
        keeps that behind its admin API), so you'll usually type the plural ids yourself and each one gets checked
        against the instance — that check is the part worth watching.
      </p>

      <label className="block">
        <span className="text-sm font-medium text-foreground/80">Strapi URL</span>
        <input
          type="url"
          required
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setInspection(null);
          }}
          placeholder="https://cms.partner.org"
          className={FIELD_CLASS}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          The instance root, not the /api path. Works with Strapi v4 and v5 — the version is detected from the response.
        </span>
      </label>

      {/* The token field is labelled by `htmlFor` rather than by nesting, so the
          eye button and the help text below stay out of the input's accessible
          name — a nested label folds every word inside it into that name. */}
      <div className="block">
        <label htmlFor={TOKEN_INPUT_ID} className="text-sm font-medium text-foreground/80">API token</label>
        <div className="relative mt-1">
          <input
            id={TOKEN_INPUT_ID}
            type={tokenVisible ? 'text' : 'password'}
            // Required only when there is nothing stored: on an edit an empty
            // field means "keep the token you already have", and marking it
            // required would block the form with no visible reason.
            required={!tokenAlreadyStored}
            autoComplete="off"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setInspection(null);
            }}
            placeholder={tokenAlreadyStored
              ? 'Stored — type a new token to replace it'
              : 'Strapi admin → Settings → API Tokens'}
            className="w-full rounded-md border border-input bg-background py-2 pr-10 pl-3 text-sm"
          />
          <button
            type="button"
            onClick={() => setTokenVisible(visible => !visible)}
            aria-label={tokenVisible ? 'Hide token' : 'Show token'}
            title={tokenVisible ? 'Hide token' : 'Show token'}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            {tokenVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Read-only is enough — it only ever reads the collections you pick. A full-access token gets you nothing extra
          here: no API token can list an instance's collections, so scope won't change that. Show it with the eye to
          check a paste. Stored encrypted against this source, so there is no separate Connect step.
          {tokenAlreadyStored ? ' Leave it empty to keep the token already stored.' : ''}
        </p>
      </div>

      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground/80">Collections</span>
          {/* Stays clickable while a read is in flight — it is a refresh, not a
              pending state, and the newest click is the one that wins. */}
          <button
            type="button"
            onClick={runInspect}
            disabled={!connectionReady}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {inspecting
              ? <Loader2 className="size-3 animate-spin" />
              : <RefreshCw className="size-3" />}
            {catalogue ? 'Reload collections' : 'Load collections'}
          </button>
        </div>

        {inspection?.authorized && inspection.detectedVersion
          ? (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                Connected — Strapi v
                {inspection.detectedVersion}
                , token accepted.
              </p>
            )
          : null}

        {inspection?.reachable && inspection.error
          ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {inspection.error}
              </p>
            )
          : null}

        {!inspection && !connectionReady
          ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Add the instance URL and an API token above and the collections load themselves.
              </p>
            )
          : null}

        {!inspection && connectionReady
          ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {inspecting
                  ? 'Reading this instance…'
                  : 'Ready — reading this instance, or type the plural ids below yourself.'}
              </p>
            )
          : null}

        {catalogue
          ? (
              <>
                <p className="mt-2 text-xs text-muted-foreground">
                  {catalogue.length}
                  {' '}
                  collections on this instance, with how many entries each holds. Tick the ones to sync.
                </p>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {catalogue.map(collection => (
                    <li key={collection}>
                      <label className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60 has-[input:disabled]:text-muted-foreground">
                        {/* A collection the instance would not read stays listed —
                            that is the answer to "where is my collection?" — but
                            it cannot be ticked, so nothing unreadable is synced. */}
                        <input
                          type="checkbox"
                          checked={selected.includes(collection)}
                          disabled={isUnreadable(checkFor(collection))}
                          onChange={() => toggleCollection(collection)}
                        />
                        {collection}
                        <CollectionVerdict check={checkFor(collection)} />
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )
          : (
              <>
                {/* Skipped when the note above already says the same thing — a
                    rejected token surfaces through both. */}
                {inspection?.enumerationNote && !inspection.error
                  ? <p className="mt-2 text-xs text-muted-foreground">{inspection.enumerationNote}</p>
                  : null}
                <textarea
                  required
                  rows={2}
                  value={collectionsText}
                  onChange={e => setCollectionsText(e.target.value)}
                  placeholder="events, venues"
                  aria-label="Collections"
                  className={FIELD_CLASS}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Plural API ids, comma separated — find them in Strapi under Content-Type Builder. Reload collections
                  checks each name against the instance and shows how many entries it holds.
                </span>
                {typedCollections.length > 0
                  ? (
                      <ul className="mt-2 space-y-1">
                        {typedCollections.map(collection => (
                          <li
                            key={collection}
                            className="flex items-center gap-2 rounded-md px-1 py-1 text-sm"
                          >
                            {collection}
                            <CollectionVerdict check={checkFor(collection)} />
                          </li>
                        ))}
                      </ul>
                    )
                  : null}
              </>
            )}
      </div>

      <label className="block">
        <span className="text-sm font-medium text-foreground/80">Include linked records</span>
        <input
          type="text"
          value={populate}
          onChange={e => setPopulate(e.target.value)}
          placeholder="*"
          className={FIELD_CLASS}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Strapi calls this “populate”. An entry's links to other records — an event's venue, its category, its images —
          come back as bare id numbers unless you ask for them. Leave it as
          {' '}
          <span className="font-mono">*</span>
          {' '}
          to pull one level of links, so a synced event reads “at The Fillmore” instead of “venue 42”. Name specific
          links instead (
          <span className="font-mono">venue,category</span>
          ) to keep the documents smaller, or clear it to store ids only.
        </span>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-foreground/80">Entries per page</span>
        <input
          type="number"
          min={1}
          max={100}
          value={pageSize}
          onChange={e => setPageSize(Math.max(1, Math.min(100, Number.parseInt(e.target.value, 10) || 1)))}
          className={FIELD_CLASS}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Strapi caps a page at 100 by default. The sync walks every page until the collection is exhausted.
        </span>
      </label>
    </AddSourceDialogFrame>
  );
}

/**
 * Route each connector to the form its config schema actually needs.
 * @param root0
 * @param root0.kind
 * @param root0.connector
 * @param root0.existing
 * @param root0.onClose
 * @param root0.onAdded
 */
function AddSourceDialog({
  kind,
  connector,
  existing,
  onClose,
  onAdded,
}: {
  kind: string;
  connector: ConnectorTile | null;
  /** The source being edited, or null when adding a new one. */
  existing?: Source | null;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}) {
  const connectorName = connector?.name ?? kind;
  const source = existing ?? null;
  // One form per connector, used for both jobs: an edit that could not offer the
  // same fields as the add would be a second place for the config to drift.
  const title = source ? `Edit ${connectorName} source` : `Add ${connectorName} source`;
  if (kind === 'strapi') {
    return <AddStrapiSourceDialog kind={kind} title={title} existing={source} onClose={onClose} onAdded={onAdded} />;
  }
  // Named rather than inferred from an empty field list, so a connector left
  // out of CONFIG_FIELDS by mistake does not quietly get the crawler's form.
  // `web`'s crawl toggle hides and shows a second field, which a flat list of
  // inputs cannot express.
  if (kind === 'web') {
    return <AddWebSourceDialog kind={kind} title={title} existing={source} onClose={onClose} onAdded={onAdded} />;
  }
  // Every other connector describes its own fields, so one form renders them all.
  const fields = configFieldsFor(kind);
  return <AddConfigurableSourceDialog kind={kind} title={title} fields={fields} existing={source} onClose={onClose} onAdded={onAdded} />;
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) {
    return 'just now';
  }
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
