'use client';

import type { SignInProviderOption } from '@/libs/identity/signInProviders';
import { KeyRound } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  /** The providers this deployment offers, as the server listed them. */
  providers: SignInProviderOption[];
  /** Where to land once signed in. */
  callbackUrl: string;
  /** The button's words; "Continue with <label>" by default. */
  verb?: (label: string) => string;
};

/**
 * "Continue with Google" / "Continue with Microsoft" — one button per
 * provider the server says is configured, nothing otherwise. The sign-in
 * page, the invite page and the profile page all use these, so a provider
 * looks and behaves the same wherever it is offered.
 * @param props - The providers and where to land.
 * @param props.providers - From `signInProviderOptions()` on the server.
 * @param props.callbackUrl - Where to land once signed in.
 * @param props.verb - The button's words.
 */
export function ProviderButtons({ providers, callbackUrl, verb = label => `Continue with ${label}` }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  if (providers.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2">
      {providers.map(provider => (
        <Button
          key={provider.id}
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending !== null}
          onClick={() => {
            setPending(provider.id);
            void signIn(provider.id, { callbackUrl });
          }}
        >
          <ProviderIcon id={provider.id} />
          {pending === provider.id ? `Opening ${provider.label}…` : verb(provider.label)}
        </Button>
      ))}
    </div>
  );
}

/** A thin "or" rule between the provider buttons and the email form. */
export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * The provider's mark, or a key for a provider core does not draw.
 * @param props - The provider.
 * @param props.id - Auth.js's provider id.
 */
export function ProviderIcon({ id }: { id: string }) {
  if (id === 'google') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
        <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84Z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
      </svg>
    );
  }
  if (id === 'microsoft-entra-id') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
        <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
        <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
        <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
      </svg>
    );
  }
  return <KeyRound className="size-4" aria-hidden />;
}
