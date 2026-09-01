'use client';

/**
 * Admin surface for tenant API tokens (`vcn_live_…`).
 *
 * The whole point of this panel is that issuing a credential no longer needs
 * shell access: an admin names a token, picks how long it should live, copies
 * the secret once, and pastes it into whatever outside tool needs to call
 * Vocion. The secret is shown exactly once, right after creation — after a
 * reload only the hash exists, so the row can never show it again.
 */

import type { TokenSummary } from '@/services/ApiTokenService';
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';
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
    return new Date(`${customDate}T23:59:59`).toISOString();
  }
  return isoDaysFromNow(Number.parseInt(choice, 10));
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [expiryChoice, setExpiryChoice] = useState('90');
  const [customDate, setCustomDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<FreshToken | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTokens(await client.apiTokens.list());
      setError(null);
    } catch (err) {
      console.error('[ApiTokensPanel] could not load tokens', err);
      setError('Could not load API tokens.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // False positive: every setState in refresh() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const expiresAt = selectedExpiry(expiryChoice, customDate);
      const created = await client.apiTokens.create({ name, expiresAt });
      setFresh({ id: created.id, token: created.token, name: created.name });
      setName('');
      setCustomDate('');
      setShowCreate(false);
      await refresh();
    } catch (err) {
      console.error('[ApiTokensPanel] could not create token', err);
      setError(err instanceof Error && err.message ? err.message : 'Could not create the token.');
    }
    setCreating(false);
  };

  const onRevoke = async (token: TokenSummary) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Revoke “${token.name}”? Anything using it stops working immediately.`)) {
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
    return <p className="text-sm text-muted-foreground">Loading API tokens…</p>;
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {fresh && <FreshTokenNotice fresh={fresh} onDismiss={() => setFresh(null)} />}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => {
            const state = tokenState(token);
            return (
              <TableRow key={token.id}>
                <TableCell className="font-medium">{token.name}</TableCell>
                <TableCell>
                  <Badge variant={state === 'active' ? 'default' : 'secondary'}>
                    {stateLabel(state)}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(token.expiresAt)}</TableCell>
                <TableCell>{token.lastUsedAt ? formatDate(token.lastUsedAt) : 'Never used'}</TableCell>
                <TableCell>{formatDate(token.createdAt)}</TableCell>
                <TableCell>
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
              <TableCell colSpan={6} className="text-sm text-muted-foreground">
                No API tokens yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {showCreate
        ? (
            <form onSubmit={onCreate} className="space-y-4 rounded-md border p-4">
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
                  Name it after whatever will use it, so you know what breaks when you revoke it.
                </p>
              </div>

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
                  <Input
                    type="date"
                    aria-label="Custom expiry date"
                    value={customDate}
                    onChange={e => setCustomDate(e.target.value)}
                    required
                  />
                )}
                {expiryChoice === 'never' && (
                  <p className="text-xs text-muted-foreground">
                    A token with no expiry works until it is revoked.
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={creating}>
                  {creating ? 'Creating…' : 'Create token'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )
        : (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <KeyRound className="size-3.5" />
              Create token
            </Button>
          )}
    </div>
  );
}
