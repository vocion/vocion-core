'use client';

import type { PendingInvite, TeamMember } from '@/services/MembersService';
import { Check, Copy, Link2, Trash2, UserPlus } from 'lucide-react';
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

type Props = {
  isAdmin: boolean;
  currentUserId: string;
};

function inviteUrl(token: string): string {
  return `${window.location.origin}/sign-up?invite=${token}`;
}

function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(inviteUrl(token));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [token]);
  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

export function MembersPanel({ isAdmin, currentUserId }: Props) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [creating, setCreating] = useState(false);
  const [freshInvite, setFreshInvite] = useState<PendingInvite | null>(null);
  const [freshCopied, setFreshCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([
        client.members.list(),
        isAdmin ? client.members.invites() : Promise.resolve([]),
      ]);
      setMembers(m);
      setInvites(i);
      setError(null);
    } catch {
      setError('Could not load members.');
    }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    // False positive: every setState in refresh() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const invite = await client.members.invite({ email: inviteEmail, role: inviteRole });
      setFreshInvite(invite);
      setFreshCopied(false);
      setInviteEmail('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not create invite.');
    }
    setCreating(false);
  };

  const copyFresh = async () => {
    if (!freshInvite) {
      return;
    }
    await navigator.clipboard.writeText(inviteUrl(freshInvite.token));
    setFreshCopied(true);
    setTimeout(() => setFreshCopied(false), 2000);
  };

  const onChangeRole = async (userId: string, role: 'admin' | 'member') => {
    setError(null);
    try {
      await client.members.changeRole({ userId, role });
      await refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not change role.');
    }
  };

  const onRemove = async (userId: string, email: string) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove ${email} from this account? They will lose access immediately.`)) {
      return;
    }
    setError(null);
    try {
      await client.members.remove({ userId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not remove member.');
    }
  };

  const onRevoke = async (inviteId: string) => {
    setError(null);
    try {
      await client.members.revokeInvite({ inviteId });
      await refresh();
    } catch {
      setError('Could not revoke invite.');
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading members…</p>;
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            {isAdmin && <TableHead className="w-24" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map(m => (
            <TableRow key={m.userId}>
              <TableCell className="font-medium">
                {m.name ?? '—'}
                {m.userId === currentUserId && (
                  <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                )}
              </TableCell>
              <TableCell>{m.email}</TableCell>
              <TableCell>
                {isAdmin && m.userId !== currentUserId
                  ? (
                      <select
                        className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                        value={m.role}
                        onChange={e => onChangeRole(m.userId, e.target.value as 'admin' | 'member')}
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                      </select>
                    )
                  : <Badge variant={m.role === 'admin' ? 'default' : 'secondary'}>{m.role}</Badge>}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}
              </TableCell>
              {isAdmin && (
                <TableCell>
                  {m.userId !== currentUserId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemove(m.userId, m.email)}
                      title="Remove member"
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {isAdmin && (
        <div className="space-y-4">
          {!showInvite && (
            <Button onClick={() => setShowInvite(true)}>
              <UserPlus className="size-4" />
              Invite member
            </Button>
          )}

          {showInvite && (
            <form onSubmit={onInvite} className="max-w-md space-y-3 rounded-md border border-border p-4">
              <div className="text-sm font-semibold">Invite a member</div>
              <div className="space-y-1">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  className="block rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                No email is sent — you'll get a link to copy and share directly (Slack, DM).
              </p>
              <div className="flex gap-2">
                <Button type="submit" disabled={creating}>
                  {creating ? 'Creating…' : 'Create invite link'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowInvite(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {freshInvite && (
            <div className="max-w-xl space-y-2 rounded-md border border-border bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Link2 className="size-4" />
                Invite link for
                {' '}
                {freshInvite.email}
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={inviteUrl(freshInvite.token)} className="font-mono text-xs" onFocus={e => e.target.select()} />
                <Button variant="outline" onClick={copyFresh}>
                  {freshCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {freshCopied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this link with them directly — it expires
                {' '}
                {new Date(freshInvite.expiresAt).toLocaleDateString()}
                {' '}
                and can be used once, only with
                {' '}
                {freshInvite.email}
                .
              </p>
            </div>
          )}

          {invites.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold">Pending invites</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-52" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.email}</TableCell>
                      <TableCell><Badge variant="secondary">{inv.role}</Badge></TableCell>
                      <TableCell className={inv.expired ? 'text-destructive' : 'text-muted-foreground'}>
                        {inv.expired ? 'Expired' : new Date(inv.expiresAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {!inv.expired && <CopyLinkButton token={inv.token} />}
                          <Button variant="ghost" size="sm" onClick={() => onRevoke(inv.id)}>
                            Revoke
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
