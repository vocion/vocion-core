'use client';

/**
 * Admin surface for an org's API credentials, in both directions.
 *
 * **Vocion tokens.** Issuing a credential no longer needs shell access: an
 * admin names a token, picks how long it should live, copies the secret once,
 * and pastes it into whatever outside tool needs to call Vocion. The secret is
 * shown exactly once, right after creation — after a reload only the hash
 * exists, so the row can never show it again. An org may hold as many of these
 * as it has integrations.
 *
 * **Platform keys.** The org's own OpenAI or Anthropic key, pasted here so
 * their model runs bill their account. Exactly one live key per platform: the
 * database enforces it, and this panel says so before you save and again when
 * you are about to replace one, because the replacement takes effect instantly
 * and silently otherwise.
 */

import type { TokenSummary } from '@/services/ApiTokenService';
import { AlertTriangle, Check, Copy, KeyRound, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { client } from '@/libs/Orpc';

/**
 * The expiry choices offered in the create form. A numeric value is a day
 * count from today; `never` issues a token with no expiry, and `custom`
 * reveals a date field.
 */
const EXPIRY_CHOICES: Array<{ value: string; label: string }> = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'Never' },
  { value: 'custom', label: 'Custom date…' },
];

type FreshToken = { id: string; token: string; name: string };

/** A platform option exactly as `apiTokens.listPlatforms` returns it. */
type PlatformOption = {
  id: string;
  label: string;
  keySource: 'minted' | 'supplied';
  keyShapeHint: string;
  helpText: string;
  fields: PlatformField[];
};

/** One input a platform's credential is made of, as the server describes it. */
type PlatformField = {
  name: string;
  label: string;
  shapeHint: string;
  /** A non-secret field (an AWS access key id) is shown back in full. */
  secret: boolean;
};

/** The platform selected by default, and the only one Vocion mints itself. */
const VOCION_PLATFORM_ID = 'vocion';

/** Bounds for the custom date field, matching what the router will accept. */
const CUSTOM_EXPIRY_MAX_YEARS = 10;

/** What a token row is doing right now, in the order the checks matter. */
type TokenState = 'revoked' | 'expired' | 'active';

/**
 * Classify a token for display. Revoked wins over expired: a revoked token was
 * deliberately killed, and that is the more useful thing to show.
 * @param token - The token row as the router returned it.
 */
function tokenState(token: TokenSummary): TokenState {
  if (token.revokedAt) {
    return 'revoked';
  }
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return 'active';
}

/**
 * The live credential a platform currently holds, or undefined when it holds
 * none. "Live" means neither revoked nor expired — the same test the server
 * applies when it goes looking for the org's key, so what this panel says is
 * on file is what a model run will actually use.
 * @param tokens - Every credential row for the org.
 * @param platformId - The platform being asked about.
 */
function liveKeyFor(tokens: TokenSummary[], platformId: string): TokenSummary | undefined {
  return tokens.find(token => token.platform === platformId && tokenState(token) === 'active');
}

/**
 * The display name for a platform id. Falls back to the raw id so a row stored
 * by an older build still renders something recognisable rather than blank.
 * @param platforms - The options the server offered.
 * @param platformId - The id stored on the credential row.
 */
function platformLabel(platforms: PlatformOption[], platformId: string): string {
  return platforms.find(platform => platform.id === platformId)?.label ?? platformId;
}

/**
 * Turn a day count into the ISO datetime the router expects.
 * @param days - How many days from today the token should last.
 */
function isoDaysFromNow(days: number): string {
  const when = new Date();
  when.setDate(when.getDate() + days);
  return when.toISOString();
}

/**
 * Resolve the create form's expiry selection into the router's `expiresAt`
 * input: an ISO datetime, or null for a token that never expires.
 * @param choice - The selected value from {@link EXPIRY_CHOICES}.
 * @param customDate - The `yyyy-mm-dd` value of the custom date field.
 */
function selectedExpiry(choice: string, customDate: string): string | null {
  if (choice === 'never') {
    return null;
  }
  if (choice === 'custom') {
    if (!customDate) {
      throw new Error('Pick a date for the custom expiry.');
    }
    // End of the chosen day, so a token dated today still works today.
    const expiresAt = new Date(`${customDate}T23:59:59`);
    // The field's `min` stops the picker at today, but a typed date can still
    // land in the past — refuse it here rather than round-tripping to the
    // router for the same answer.
    if (expiresAt.getTime() <= Date.now()) {
      throw new Error('Pick a date in the future.');
    }
    return expiresAt.toISOString();
  }
  return isoDaysFromNow(Number.parseInt(choice, 10));
}

/**
 * A `yyyy-mm-dd` string for the date picker's bounds, built from local time so
 * the field agrees with the calendar the person is looking at rather than UTC.
 * @param yearsFromNow - Whole years to add; 0 gives today.
 */
function dateFieldValue(yearsFromNow: number): string {
  const day = new Date();
  day.setFullYear(day.getFullYear() + yearsFromNow);
  const month = `${day.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${day.getDate()}`.padStart(2, '0');
  return `${day.getFullYear()}-${month}-${dayOfMonth}`;
}

const EARLIEST_EXPIRY_DATE = dateFieldValue(0);
const LATEST_EXPIRY_DATE = dateFieldValue(CUSTOM_EXPIRY_MAX_YEARS);

/**
 * The submit button's text. It says what is about to happen, because "Save" on
 * a platform that already holds a key would hide the fact that saving throws
 * the old key away.
 * @param isMinted - Whether Vocion generates this credential.
 * @param replacing - Whether a live key for this platform is about to be replaced.
 * @param busy - Whether the request is in flight.
 */
function submitLabel(isMinted: boolean, replacing: boolean, busy: boolean): string {
  if (isMinted) {
    return busy ? 'Creating…' : 'Create token';
  }
  if (replacing) {
    return busy ? 'Replacing…' : 'Replace key';
  }
  return busy ? 'Saving…' : 'Save key';
}

/**
 * Human-readable label for a token's state.
 * @param state - The classified state from {@link tokenState}.
 */
function stateLabel(state: TokenState): string {
  if (state === 'active') {
    return 'Active';
  }
  if (state === 'expired') {
    return 'Expired';
  }
  return 'Revoked';
}

function formatDate(value: Date | string | null): string {
  if (!value) {
    return 'Never';
  }
  return new Date(value).toLocaleDateString();
}

/**
 * The one-time secret display. Dismissing it is the only way to close it.
 * @param props - Component props.
 * @param props.fresh - The token just created, including its plaintext secret.
 * @param props.onDismiss - Called once the admin says they have saved it.
 */
function FreshTokenNotice({ fresh, onDismiss }: { fresh: FreshToken; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(fresh.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fresh.token]);

  return (
    <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-4">
      <p className="text-sm font-medium">
        {`Token “${fresh.name}” created`}
      </p>
      <p className="text-sm text-muted-foreground">
        Copy it now. This is the only time it will be shown — Vocion stores only a
        hash, so it cannot be recovered later. Revoke and create a new one if you
        lose it.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
          {fresh.token}
        </code>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        I have saved it
      </Button>
    </div>
  );
}

export function ApiTokensPanel() {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [platforms, setPlatforms] = useState<PlatformOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [platformId, setPlatformId] = useState(VOCION_PLATFORM_ID);
  const [name, setName] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [expiryChoice, setExpiryChoice] = useState('90');
  const [customDate, setCustomDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<FreshToken | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rows, options] = await Promise.all([
        client.apiTokens.list(),
        client.apiTokens.listPlatforms(),
      ]);
      setTokens(rows);
      setPlatforms(options);
      setError(null);
    } catch (err) {
      console.error('[ApiTokensPanel] could not load credentials', err);
      setError('Could not load API credentials.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // False positive: every setState in refresh() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const selectedPlatform = platforms.find(platform => platform.id === platformId);
  const isMinted = (selectedPlatform?.keySource ?? 'minted') === 'minted';
  // Only meaningful for a supplied platform: a Vocion row is allowed to have
  // as many siblings as the org wants.
  const existingKey = isMinted ? undefined : liveKeyFor(tokens, platformId);

  /**
   * Reset the create form back to its opening state. Called after a successful
   * save so a stale key never sits in a field, and on cancel for the same
   * reason.
   */
  const resetForm = () => {
    setName('');
    setFieldValues({});
    setCustomDate('');
    setShowCreate(false);
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (existingKey) {
      // eslint-disable-next-line no-alert
      const proceed = window.confirm(
        `${selectedPlatform?.label} already has a key on file (${existingKey.keyHint ?? 'saved'}).\n\n`
        + 'Saving this one replaces it. The old key stops being used immediately and cannot be recovered.',
      );
      if (!proceed) {
        return;
      }
    }
    setCreating(true);
    setError(null);
    try {
      if (isMinted) {
        const created = await client.apiTokens.create({
          name,
          expiresAt: selectedExpiry(expiryChoice, customDate),
        });
        setFresh({ id: created.id, token: created.token, name: created.name });
      } else {
        // No expiry: the platform that issued the key owns its lifetime.
        await client.apiTokens.createPlatformKey({ name, platform: platformId, values: fieldValues });
      }
      resetForm();
      await refresh();
    } catch (err) {
      console.error('[ApiTokensPanel] could not save credential', err);
      setError(err instanceof Error && err.message ? err.message : 'Could not save the credential.');
    }
    setCreating(false);
  };

  const onRevoke = async (token: TokenSummary) => {
    const consequence = token.platform === VOCION_PLATFORM_ID
      ? 'Anything using it stops working immediately.'
      : 'This workspace goes back to running on the Vocion server key immediately.';
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Revoke “${token.name}”? ${consequence}`)) {
      return;
    }
    setError(null);
    try {
      await client.apiTokens.revoke({ tokenId: token.id });
      await refresh();
    } catch (err) {
      console.error('[ApiTokensPanel] could not revoke token', err);
      setError('Could not revoke the token.');
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading API credentials…</p>;
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {fresh && <FreshTokenNotice fresh={fresh} onDismiss={() => setFresh(null)} />}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="whitespace-nowrap">Last used</TableHead>
            <TableHead className="whitespace-nowrap">Created</TableHead>
            {/* The revoke action, right-aligned so it sits at the edge of the
                card rather than floating in the middle of a wide table. */}
            <TableHead className="w-24 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => {
            const state = tokenState(token);
            return (
              <TableRow key={token.id}>
                <TableCell className="font-medium">{token.name}</TableCell>
                <TableCell>{platformLabel(platforms, token.platform)}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {token.keyHint ?? 'Vocion-issued'}
                </TableCell>
                <TableCell>
                  <Badge variant={state === 'active' ? 'default' : 'secondary'}>
                    {stateLabel(state)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {token.platform === VOCION_PLATFORM_ID
                    ? formatDate(token.expiresAt)
                    // A supplied key has no expiry of ours, and printing
                    // "Never" would overclaim — the platform that issued it can
                    // still expire it out from under us.
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{token.lastUsedAt ? formatDate(token.lastUsedAt) : 'Never used'}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(token.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {state !== 'revoked' && (
                    <Button variant="ghost" size="sm" onClick={() => onRevoke(token)}>
                      <Trash2 className="size-3.5" />
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {tokens.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-sm text-muted-foreground">
                No API credentials yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {showCreate
        ? (
            <form onSubmit={onCreate} className="space-y-4 rounded-md border p-4">
              <div className="space-y-2">
                <Label htmlFor="token-platform">Platform</Label>
                <select
                  id="token-platform"
                  value={platformId}
                  onChange={e => setPlatformId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {platforms.map(platform => (
                    <option key={platform.id} value={platform.id}>{platform.label}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {selectedPlatform?.helpText}
                </p>
                {!isMinted && !existingKey && (
                  <p className="text-xs text-muted-foreground">
                    {`A workspace holds one ${selectedPlatform?.label} key at a time.`}
                  </p>
                )}
                {existingKey && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {`A workspace holds one ${selectedPlatform?.label} key at a time, and this one already has `}
                      <span className="font-mono">{existingKey.keyHint ?? 'a key'}</span>
                      {' on file. Saving replaces it — the old key stops being used immediately.'}
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Veerio admin panel"
                  maxLength={80}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {isMinted
                    ? 'Name it after whatever will use it, so you know what breaks when you revoke it.'
                    : 'Name it after the account the key belongs to, so you know whose bill it lands on.'}
                </p>
              </div>

              {(selectedPlatform?.fields ?? []).map(field => (
                <div key={field.name} className="space-y-2">
                  <Label htmlFor={`platform-field-${field.name}`}>{field.label}</Label>
                  <Input
                    id={`platform-field-${field.name}`}
                    type={field.secret ? 'password' : 'text'}
                    value={fieldValues[field.name] ?? ''}
                    onChange={e => setFieldValues(current => ({ ...current, [field.name]: e.target.value }))}
                    placeholder={field.secret ? 'Paste the value' : field.shapeHint}
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {field.secret
                      ? `Expected shape: ${field.shapeHint}. Stored encrypted — after saving, only the last four characters are ever shown.`
                      : `Expected shape: ${field.shapeHint}. Not a secret, so this one stays readable.`}
                  </p>
                </div>
              ))}

              {!isMinted && (
                <p className="text-xs text-muted-foreground">
                  {`No expiry to set — ${selectedPlatform?.label} decides when this key stops working. Revoke it here, or replace it, when you want Vocion to stop using it.`}
                </p>
              )}

              {isMinted && (
                <div className="space-y-2">
                  <Label htmlFor="token-expiry">Expires</Label>
                  <select
                    id="token-expiry"
                    value={expiryChoice}
                    onChange={e => setExpiryChoice(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    {EXPIRY_CHOICES.map(choice => (
                      <option key={choice.value} value={choice.value}>{choice.label}</option>
                    ))}
                  </select>
                  {expiryChoice === 'custom' && (
                    <>
                      <Input
                        type="date"
                        aria-label="Custom expiry date"
                        value={customDate}
                        onChange={e => setCustomDate(e.target.value)}
                        // The picker cannot reach a past day, and stops at the
                        // same ten-year ceiling the router enforces. Today is
                        // allowed: a custom date expires at the end of that day.
                        min={EARLIEST_EXPIRY_DATE}
                        max={LATEST_EXPIRY_DATE}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        The token expires at the end of the day you pick.
                      </p>
                    </>
                  )}
                  {expiryChoice === 'never' && (
                    <p className="text-xs text-muted-foreground">
                      A token with no expiry works until it is revoked.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={creating}>
                  {submitLabel(isMinted, Boolean(existingKey), creating)}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </form>
          )
        : (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <KeyRound className="size-3.5" />
              Add credential
            </Button>
          )}
    </div>
  );
}
