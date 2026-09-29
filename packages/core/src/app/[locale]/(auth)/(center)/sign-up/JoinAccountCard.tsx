'use client';

import type { InviteSummary } from '@/services/InviteAcceptance';
import { signOut } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from '@/libs/I18nNavigation';

type Props = {
  /** From ?invite=… */
  inviteToken: string;
  /** What the token names, for the signed-in person; null when it names no invite. */
  invite: InviteSummary | null;
  /** The email they are signed in with, so a mismatch can say which login this is. */
  signedInEmail: string | null;
};

/** `openPath` is null when they joined but hold no workspace there yet. */
type AcceptResponse = { ok: true; openPath: string | null } | { ok: false; error: string; signInAgain?: boolean };

/**
 * Accept the invite on the signed-in login.
 * @param inviteToken - The invite token from the link.
 * @returns Where to go next, or the refusal to show.
 */
async function acceptInvite(inviteToken: string): Promise<AcceptResponse> {
  let res: Response;
  try {
    res = await fetch('/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteToken }),
    });
  } catch (error) {
    console.error('[JoinAccountCard] accepting the invite did not reach the server', error);
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    return { ok: true, openPath: typeof body.openPath === 'string' ? body.openPath : null };
  }
  return {
    ok: false,
    error: typeof body.error === 'string' ? body.error : 'Could not accept the invite. Try again.',
    // The session ran out between loading the page and clicking.
    signInAgain: res.status === 401,
  };
}

/**
 * Sign-in that comes back to this invite.
 * @param inviteToken - The invite token from the link.
 */
function signInToAccept(inviteToken: string): string {
  return `/sign-in?callbackUrl=${encodeURIComponent(`/sign-up?invite=${encodeURIComponent(inviteToken)}`)}`;
}

/**
 * What to tell someone who joined, or was already in, an account where they
 * hold no workspace yet: there is nothing to open, and `/dashboard` would put
 * them back in their other account.
 * @param props - The account.
 * @param props.accountName - Its name.
 * @param props.title - The heading.
 */
function NoWorkspaceYet({ accountName, title }: { accountName: string; title: string }) {
  return (
    <Card title={title}>
      <p className="text-sm text-muted-foreground">
        {`You don't have a workspace in ${accountName} yet. Once an admin there gives you one, it shows in your workspace switcher.`}
      </p>
      <Link className="text-sm underline" href="/dashboard">Go to your dashboard</Link>
    </Card>
  );
}

/**
 * A card with a heading, a line of explanation and whatever actions fit.
 * @param props - The card's parts.
 * @param props.title - The heading.
 * @param props.children - The explanation and actions.
 */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm space-y-4 px-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

/**
 * The invite page for someone already signed in (vocion-core#128): join the
 * invite's account on the login they have, rather than making a second login.
 * The server decides where they stand (`describeInviteForUser`); this only
 * explains it and offers the one action that fits.
 * @param props - See {@link Props}.
 * @param props.inviteToken
 * @param props.invite
 * @param props.signedInEmail
 */
export function JoinAccountCard({ inviteToken, invite, signedInEmail }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [signInAgain, setSignInAgain] = useState(false);
  const [joinedWithoutWorkspace, setJoinedWithoutWorkspace] = useState(false);
  const who = signedInEmail ?? 'this login';

  if (!invite) {
    return (
      <Card title="Invite not found">
        <p className="text-sm text-muted-foreground">This invite link isn't valid. Check you copied all of it, or ask an admin for a new one.</p>
        <Link className="text-sm underline" href="/dashboard">Go to your dashboard</Link>
      </Card>
    );
  }

  if (joinedWithoutWorkspace) {
    return <NoWorkspaceYet accountName={invite.accountName} title={`You joined ${invite.accountName}`} />;
  }

  if (invite.standing === 'member' && !invite.openPath) {
    return <NoWorkspaceYet accountName={invite.accountName} title={`You're already in ${invite.accountName}`} />;
  }

  if (invite.standing === 'member') {
    return (
      <Card title={`You're already in ${invite.accountName}`}>
        <p className="text-sm text-muted-foreground">{`${who} is already a member, so there's nothing to accept.`}</p>
        <Button asChild className="w-full">
          <a href={invite.openPath ?? undefined}>{`Open ${invite.accountName}`}</a>
        </Button>
      </Card>
    );
  }

  if (invite.standing === 'accepted' || invite.standing === 'expired') {
    return (
      <Card title={invite.standing === 'accepted' ? 'Invite already used' : 'Invite expired'}>
        <p className="text-sm text-muted-foreground">{`Ask an admin of ${invite.accountName} for a new invite link.`}</p>
        <Link className="text-sm underline" href="/dashboard">Go to your dashboard</Link>
      </Card>
    );
  }

  if (invite.standing === 'other-email') {
    return (
      <Card title="This invite is for a different email">
        <p className="text-sm text-muted-foreground">
          {`You're signed in as ${who}, but this invite to ${invite.accountName} was sent to another email. Sign out, then sign in or sign up with the invited email.`}
        </p>
        <Button className="w-full" variant="outline" onClick={() => signOut({ callbackUrl: `/sign-up?invite=${encodeURIComponent(inviteToken)}` })}>
          Sign out and continue
        </Button>
      </Card>
    );
  }

  // A click handler that sets this component's state has no module-level
  // form, so it is the one function declared in here; the request itself is
  // `acceptInvite` above.
  const onJoin = async () => {
    setError(null);
    setJoining(true);
    const result = await acceptInvite(inviteToken);
    if (result.ok && result.openPath) {
      window.location.href = result.openPath;
      return;
    }
    if (result.ok) {
      setJoinedWithoutWorkspace(true);
      return;
    }
    setError(result.error);
    setSignInAgain(Boolean(result.signInAgain));
    setJoining(false);
  };

  return (
    <Card title={`Join ${invite.accountName}`}>
      <p className="text-sm text-muted-foreground">
        {`You've been invited as ${invite.role === 'admin' ? 'an admin' : 'a member'}. You'll join with the login you're using now, ${who}, and ${invite.accountName}'s workspaces will show in your workspace switcher next to the ones you already have.`}
      </p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
          {signInAgain && (
            <>
              {' '}
              <Link className="underline" href={signInToAccept(inviteToken)}>Sign in again</Link>
            </>
          )}
        </p>
      )}
      <Button className="w-full" disabled={joining} onClick={onJoin}>
        {joining ? 'Joining…' : `Join ${invite.accountName}`}
      </Button>
    </Card>
  );
}
