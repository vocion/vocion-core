'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  /** From ?invite=… — the only way to reach the form. */
  inviteToken: string | null;
};

export function SignUpForm({ inviteToken }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!inviteToken) {
    return (
      <div className="w-full max-w-sm space-y-4 px-4 text-center">
        <h1 className="text-2xl font-semibold">Invite required</h1>
        <p className="text-sm text-muted-foreground">
          Accounts on this instance are created by invitation. Ask an admin for an invite link to join the team.
        </p>
        <p className="text-sm">
          Already have an account?
          {' '}
          <a className="underline" href="/sign-in">Sign in</a>
        </p>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, email, password, inviteToken }),
    });
    if (!res.ok) {
      const { error: msg } = await res.json().catch(() => ({ error: 'Sign-up failed.' }));
      setError(msg ?? 'Sign-up failed.');
      setSubmitting(false);
      return;
    }
    // Sign-up created the user — now sign them in
    const signin = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl: '/dashboard',
    });
    setSubmitting(false);
    if (signin?.error) {
      setError('Account created, but sign-in failed. Try signing in manually.');
      window.location.href = '/sign-in';
    } else {
      window.location.href = signin?.url ?? '/dashboard';
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Accept invite</h1>
        <p className="text-sm text-muted-foreground">
          You've been invited to join. Set a password to continue.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" type="text" value={name} onChange={e => setName(e.target.value)} required autoComplete="name" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" minLength={8} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Accept invite + sign in'}
        </Button>
        <p className="text-center text-sm">
          Already have an account?
          {' '}
          <a className="underline" href="/sign-in">Sign in</a>
        </p>
      </form>
    </div>
  );
}
