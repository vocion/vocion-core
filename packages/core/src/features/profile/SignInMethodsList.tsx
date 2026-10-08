'use client';

import type { SignInMethods } from '@/services/auth/signInMethods';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ProviderIcon } from '@/features/auth/ProviderButtons';

type ListProps = {
  methods: SignInMethods;
  /** Unlink a provider; resolves to an error sentence, or null when done. */
  onUnlink: (provider: string) => Promise<string | null>;
  /** Start linking a provider (leaves the page for the provider). */
  onLink: (provider: string) => void;
};

/**
 * One way in, as a row: what it is, where it stands, and the one thing to do
 * with it.
 * @param props - The row.
 * @param props.icon - Leading mark.
 * @param props.name - The method.
 * @param props.status - Where it stands.
 * @param props.note - A line under it, when there is something to explain.
 * @param props.action - The button, if any.
 */
function MethodRow(props: { icon?: React.ReactNode; name: string; status: string; note?: string | null; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="flex size-5 items-center justify-center">{props.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{props.name}</p>
        <p className="text-xs text-muted-foreground">{props.status}</p>
        {props.note && <p className="mt-0.5 text-xs text-muted-foreground">{props.note}</p>}
      </div>
      {props.action}
    </li>
  );
}

/**
 * The person's ways in: password, each provider this deployment offers (or
 * that is still linked), and the email link when mail is set up. A linked
 * provider can be unlinked unless it is the last way in; an unlinked one can
 * be linked by signing in with it.
 * @param props - See {@link ListProps}.
 * @param props.methods - The person's ways in.
 * @param props.onUnlink - Unlink a provider.
 * @param props.onLink - Start linking a provider.
 */
export function SignInMethodsList({ methods, onUnlink, onLink }: ListProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unlink = async (provider: string) => {
    setBusy(provider);
    setError(null);
    setError(await onUnlink(provider));
    setBusy(null);
  };

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border/70">
        <MethodRow
          name="Password"
          status={methods.password ? 'Set' : 'Not set'}
        />
        {methods.emailLink && (
          <MethodRow
            name="Email link"
            status={`Available — a link sent to ${methods.email}`}
          />
        )}
        {methods.providers.map(provider => (
          <MethodRow
            key={provider.id}
            icon={<ProviderIcon id={provider.id} />}
            name={provider.label}
            status={provider.linked ? (provider.offered ? 'Linked' : 'Linked — not offered on this server') : 'Not linked'}
            note={provider.linked
              ? provider.unlinkProblem
              : `Sign in with the ${provider.label} account for ${methods.email} to link it.`}
            action={provider.linked
              ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null || provider.unlinkProblem !== null}
                    onClick={() => void unlink(provider.id)}
                  >
                    {busy === provider.id ? 'Unlinking…' : 'Unlink'}
                  </Button>
                )
              : provider.offered && (
                <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => onLink(provider.id)}>
                  Link
                </Button>
              )}
          />
        ))}
      </ul>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
