'use client';

import type { SignInMethods } from '@/services/auth/signInMethods';
import { signIn } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { client } from '@/libs/Orpc';
import { SignInMethodsList } from './SignInMethodsList';

/** The profile page's "Sign-in methods" section. */
export function SignInMethodsSection() {
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMethods(await client.profile.signInMethods());
      setLoadError(null);
    } catch {
      setLoadError('Could not load your sign-in methods.');
    }
  }, []);

  useEffect(() => {
    // False positive: every setState in refresh() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onUnlink = async (provider: string): Promise<string | null> => {
    try {
      await client.profile.unlinkSignInMethod({ provider });
      await refresh();
      return null;
    } catch (err) {
      return err instanceof Error && err.message ? err.message : 'Could not unlink it.';
    }
  };

  return (
    <DashboardSection
      title="Sign-in methods"
      description="The ways you can sign in. Keep at least one besides the one you remove."
    >
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {!loadError && !methods && <p className="text-sm text-muted-foreground">Loading…</p>}
      {methods && (
        <SignInMethodsList
          methods={methods}
          onUnlink={onUnlink}
          onLink={provider => void signIn(provider, { callbackUrl: window.location.href })}
        />
      )}
    </DashboardSection>
  );
}
