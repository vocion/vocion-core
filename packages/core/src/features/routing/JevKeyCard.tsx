'use client';

/**
 * The key that turns dynamic routing on (ADR 0006), at one level: the
 * instance (System) or this workspace (Developers), as a System Keys card.
 * Write-only: the card shows the last four characters of a saved key and
 * never reads one back. Saving replaces the key at that level; removing it
 * falls back to the next level (workspace → instance → off).
 */

import type { KeyOnFile, KeyScope } from '@/services/routing/jevKey';
import { Route } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { client } from '@/libs/Orpc';
import { ApiKeyCard } from './ApiKeyCard';

export type JevKeyCardProps = {
  scope: KeyScope;
  /** The key saved or set at this level, or null. */
  onFile: KeyOnFile | null;
  /** A short muted line under the blurb, or null. */
  note: string | null;
  /** Whether this viewer may save or remove it. */
  canEdit: boolean;
  /** Why it cannot be edited here, when it cannot (shown instead of the form). */
  lock: string | null;
};

export function JevKeyCard(props: JevKeyCardProps) {
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

  const openrouter = props.onFile?.provider === 'openrouter';
  return (
    <ApiKeyCard
      testId={`jev-key-${props.scope}`}
      name="Jev by TypeSafe"
      blurb="Picks the right model, engine and effort for each run."
      icon={Route}
      tint="violet"
      note={props.note}
      hint={props.onFile?.hint ?? null}
      source={props.onFile?.source ?? null}
      console={openrouter ? { href: 'https://openrouter.ai/settings/keys', label: 'openrouter.ai' } : { href: 'https://typesafe.ai', label: 'typesafe.ai' }}
      canEdit={props.canEdit}
      lock={props.lock}
      busy={busy}
      error={error}
      onSave={key => act(() => client.routing.saveKey({ scope: props.scope, key }))}
      onRemove={async () => {
        await act(() => client.routing.removeKey({ scope: props.scope }));
      }}
    />
  );
}
