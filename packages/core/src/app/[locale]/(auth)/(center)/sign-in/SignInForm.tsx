'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  callbackUrl: string;
  error: string | null;
  hint: { email: string; password: string } | null;
};

export function SignInForm({ callbackUrl, error: initialError, hint }: Props) {
  const [email, setEmail] = useState(hint?.email ?? '');
  const [password, setPassword] = useState(hint?.password ?? '');
  const [error, setError] = useState<string | null>(initialError);
  const [submitting, setSubmitting] = useState(false);

  const autofillHint = () => {
    if (hint) {
      setEmail(hint.email);
      setPassword(hint.password);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setSubmitting(false);
    if (res?.error) {
      setError('Invalid email or password.');
    } else if (res?.ok) {
      window.location.href = res.url ?? callbackUrl;
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          New here?
          {' '}
          <a className="underline" href="/sign-up">Create an account</a>
        </p>
      </div>

      {hint && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Demo credentials:</strong>
          {' '}
          {hint.email}
          {' '}
          /
          {' '}
          {hint.password}
          {' · '}
          <button type="button" className="underline" onClick={autofillHint}>autofill</button>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
