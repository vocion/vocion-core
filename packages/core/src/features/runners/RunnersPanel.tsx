'use client';

/**
 * The Software Factory section of Workforce › Settings › Developers (Vocion 5.1): where an
 * account admin decides which runners build the account's engineering runs.
 *
 * **Where each workspace builds.** One row for the account's default and one per workspace, each
 * naming one of the installation's targets. A workspace's own choice wins, then the account's;
 * neither is any target. A workspace's runs are then claimed only by that target and started only
 * there, so a company's repository code runs only on capacity meant for it.
 *
 * **Runner tokens.** A runner presents one to claim this account's runs, and is given nothing from
 * any other account. It can be narrowed to some workspaces. Unlike an API token it is shown once,
 * here, right after it is minted, and never again: it is not stored, only its hash is.
 *
 * Reuses the API credentials panel's pieces (`FreshTokenNotice`, `formatDate`, the table), so a
 * freshly minted secret looks and behaves the same everywhere.
 */

import type { FreshToken } from '@/features/api-tokens/ApiTokensPanel';
import { KeyRound, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, FreshTokenNotice } from '@/features/api-tokens/ApiTokensPanel';
import { client } from '@/libs/Orpc';

type Overview = Awaited<ReturnType<typeof client.runners.overview>>;
type RunnerToken = Overview['tokens'][number];

const KIND_LABEL: Record<string, string> = { 'on-box': 'on the app\'s own box', 'aws-fargate': 'AWS Fargate' };

const EXPIRY_CHOICES: Array<{ value: string; label: string; days: number | null }> = [
  { value: '90', label: '90 days', days: 90 },
  { value: '365', label: '1 year', days: 365 },
  { value: 'never', label: 'Never', days: null },
];

/**
 * "Revoked", "Expired" or "Active", by what happened first.
 * @param token - The listed runner token.
 */
function tokenState(token: RunnerToken): 'active' | 'expired' | 'revoked' {
  if (token.revokedAt) {
    return 'revoked';
  }
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return 'active';
}

/**
 * A target select. `none` is what an empty choice means on this row.
 * @param props - The select's props.
 * @param props.id - The element id, for its label.
 * @param props.value - The target named, or null.
 * @param props.none - What null means on this row.
 * @param props.targets - The installation's targets.
 * @param props.busy - Whether a save is in flight.
 * @param props.onChange - Save a new choice.
 */
function TargetSelect({ id, value, none, targets, busy, onChange }: { id: string; value: string | null; none: string; targets: Overview['targets']; busy: boolean; onChange: (target: string | null) => void }) {
  // A target the installation no longer declares stays visible, so the row never claims a choice
  // it does not hold; saving anything else moves off it.
  const stale = value !== null && !targets.some(t => t.name === value);
  return (
    <select
      id={id}
      value={value ?? ''}
      disabled={busy}
      onChange={e => onChange(e.target.value || null)}
      className="h-8 w-full max-w-xs rounded-md border border-input bg-transparent px-2 text-sm"
    >
      <option value="">{none}</option>
      {targets.map(t => (
        <option key={t.name} value={t.name}>{`${t.name} (${KIND_LABEL[t.kind] ?? t.kind})`}</option>
      ))}
      {stale && <option value={value}>{`${value} (not declared on this installation)`}</option>}
    </select>
  );
}

export function RunnersPanel() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [allWorkspaces, setAllWorkspaces] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('365');
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<FreshToken | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await client.runners.overview({ includeRevoked: showRevoked });
      setOverview(next);
      setError(null);
    } catch (err) {
      console.error('[RunnersPanel] could not load runners', err);
      setError('Could not load this account\'s runners.');
    }
  }, [showRevoked]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- every setState in refresh() runs after its await
    void refresh();
  }, [refresh]);

  const saveTarget = async (key: string, save: () => Promise<unknown>) => {
    setSaving(key);
    setError(null);
    try {
      await save();
      await refresh();
    } catch (err) {
      console.error('[RunnersPanel] could not save the target', err);
      setError(err instanceof Error && err.message ? err.message : 'Could not save the target.');
    }
    setSaving(null);
  };

  const resetForm = () => {
    setName('');
    setAllWorkspaces(true);
    setPicked([]);
    setExpiry('365');
    setShowCreate(false);
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const days = EXPIRY_CHOICES.find(c => c.value === expiry)?.days ?? null;
      const created = await client.runners.createToken({
        name,
        projectIds: allWorkspaces ? null : picked,
        expiresAt: days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString(),
      });
      setFresh({ id: created.id, token: created.token, name: created.name });
      resetForm();
      await refresh();
    } catch (err) {
      console.error('[RunnersPanel] could not mint the runner token', err);
      setError(err instanceof Error && err.message ? err.message : 'Could not create the runner token.');
    }
    setCreating(false);
  };

  const onRevoke = async (token: RunnerToken) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Revoke “${token.name}”? A runner holding it claims nothing from now on. A run it already took finishes on that run's own token.`)) {
      return;
    }
    setError(null);
    try {
      await client.runners.revokeToken({ id: token.id });
      await refresh();
    } catch (err) {
      console.error('[RunnersPanel] could not revoke the runner token', err);
      setError('Could not revoke the runner token.');
    }
  };

  if (!overview) {
    return error ? <p className="text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">Loading runners…</p>;
  }

  const accountDefault = overview.account.target;
  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Where each workspace builds</h3>
        <p className="max-w-prose text-[13px] text-muted-foreground">
          {overview.current.target
            ? `This workspace's runs are built on ${overview.current.target}, set by ${overview.current.from === 'workspace' ? 'the workspace' : 'the account'}. No other target takes them.`
            : 'This workspace\'s runs are built on any of the installation\'s targets.'}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Built on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">
                <Label htmlFor="runner-target-account">{`Every workspace of ${overview.account.name || 'this account'}`}</Label>
              </TableCell>
              <TableCell>
                <TargetSelect id="runner-target-account" value={accountDefault} none="Any target" targets={overview.targets} busy={saving === 'account'} onChange={target => saveTarget('account', () => client.runners.setAccountTarget({ target }))} />
              </TableCell>
            </TableRow>
            {overview.workspaces.map(w => (
              <TableRow key={w.id}>
                <TableCell>
                  <Label htmlFor={`runner-target-${w.id}`} className="font-normal">
                    {w.name}
                    {w.id === overview.currentWorkspaceId && <span className="text-muted-foreground"> (this workspace)</span>}
                  </Label>
                </TableCell>
                <TableCell>
                  <TargetSelect id={`runner-target-${w.id}`} value={w.target} none={accountDefault ? `As the account (${accountDefault})` : 'As the account (any target)'} targets={overview.targets} busy={saving === w.id} onChange={target => saveTarget(w.id, () => client.runners.setWorkspaceTarget({ projectId: w.id, target }))} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Runner tokens</h3>
        <p className="max-w-prose text-[13px] text-muted-foreground">
          {overview.multiTenant
            ? 'A runner claims this account\'s runs with one of these, and is never given another account\'s. This installation serves several accounts, so these are the only tokens that claim runs here.'
            : 'A runner claims this account\'s runs with one of these, and is never given another account\'s. The installation\'s own runner token also builds every workspace here.'}
        </p>

        {fresh && (
          <FreshTokenNotice
            fresh={fresh}
            onDismiss={() => setFresh(null)}
            note="Put it in the runner's secrets now, as VOCION_RUNNER_TOKEN. Only its hash is kept, so it cannot be shown again; if it is lost, revoke it and make another."
          />
        )}

        <div className="flex justify-end">
          <Label htmlFor="runner-show-revoked" className="text-sm font-normal text-muted-foreground">
            <input id="runner-show-revoked" type="checkbox" checked={showRevoked} onChange={e => setShowRevoked(e.target.checked)} className="size-3.5 accent-primary" />
            Show revoked
          </Label>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Claims for</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="whitespace-nowrap">Last used</TableHead>
              <TableHead className="whitespace-nowrap">Created</TableHead>
              <TableHead className="w-24 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.tokens.map((token) => {
              const state = tokenState(token);
              return (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell>{token.workspaces ? token.workspaces.map(w => w.name).join(', ') : 'Every workspace'}</TableCell>
                  <TableCell className="font-mono text-xs">{token.keyHint ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={state === 'active' ? 'default' : 'secondary'}>{state === 'active' ? 'Active' : state === 'expired' ? 'Expired' : 'Revoked'}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(token.expiresAt)}</TableCell>
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
            {overview.tokens.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-sm text-muted-foreground">
                  {showRevoked ? 'No runner tokens yet.' : 'No runner tokens in use. Turn on “Show revoked” to see any that were revoked.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {showCreate
          ? (
              <form onSubmit={onCreate} className="space-y-4 rounded-md border p-4">
                <div className="space-y-2">
                  <Label htmlFor="runner-token-name">Name</Label>
                  <Input id="runner-token-name" value={name} onChange={e => setName(e.target.value)} placeholder="Northwind Fargate runners" maxLength={80} required />
                  <p className="text-xs text-muted-foreground">Which runner holds it, so its row says what stops when it is revoked.</p>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Claims for</legend>
                  <Label className="text-sm font-normal">
                    <input type="radio" name="runner-token-scope" checked={allWorkspaces} onChange={() => setAllWorkspaces(true)} className="accent-primary" />
                    Every workspace of the account, including ones added later
                  </Label>
                  <Label className="text-sm font-normal">
                    <input type="radio" name="runner-token-scope" checked={!allWorkspaces} onChange={() => setAllWorkspaces(false)} className="accent-primary" />
                    Only these workspaces
                  </Label>
                  {!allWorkspaces && (
                    <div className="space-y-1 pl-5">
                      {overview.workspaces.map(w => (
                        <Label key={w.id} className="text-sm font-normal">
                          <input
                            type="checkbox"
                            checked={picked.includes(w.id)}
                            onChange={e => setPicked(current => (e.target.checked ? [...current, w.id] : current.filter(id => id !== w.id)))}
                            className="size-3.5 accent-primary"
                          />
                          {w.name}
                        </Label>
                      ))}
                    </div>
                  )}
                </fieldset>
                <div className="space-y-2">
                  <Label htmlFor="runner-token-expiry">Expires</Label>
                  <select id="runner-token-expiry" value={expiry} onChange={e => setExpiry(e.target.value)} className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 text-sm">
                    {EXPIRY_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={creating || (!allWorkspaces && picked.length === 0)}>
                    {creating ? 'Creating…' : 'Create runner token'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
                </div>
              </form>
            )
          : (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <KeyRound className="size-3.5" />
                Create runner token
              </Button>
            )}
      </div>
    </div>
  );
}
