'use client';

/**
 * One System Keys card wired to the routes: save and remove the key for one
 * service (`jev`, `amplitude`) at one level, the instance (System) or this
 * workspace (Developers). Write-only: the card shows the last four characters
 * of a saved key and never reads one back. Removing a key falls back to the
 * next level (workspace, then instance, then the environment, then off).
 */

import type { ApiKeyCardProps } from './ApiKeyCard';
import type { KeyScope } from '@/services/keys/systemKeys';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client } from '@/libs/Orpc';
import { ApiKeyCard } from './ApiKeyCard';

export type SystemKeyCardProps = Omit<ApiKeyCardProps, 'busy' | 'error' | 'onSave' | 'onRemove' | 'testId'> & {
  service: 'jev' | 'amplitude';
  scope: KeyScope;
};

export function SystemKeyCard({ service, scope, ...card }: SystemKeyCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await run();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'That did not work. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <ApiKeyCard
      {...card}
      testId={`${service}-key-${scope}`}
      busy={busy}
      error={error}
      onSave={key => act(() => client.routing.saveKey({ scope, key, service }))}
      onRemove={async () => {
        await act(() => client.routing.removeKey({ scope, service }));
      }}
    />
  );
}
