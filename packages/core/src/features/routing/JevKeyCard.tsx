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
import { SystemKeyCard } from './SystemKeyCard';

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
  const openrouter = props.onFile?.provider === 'openrouter';
  return (
    <SystemKeyCard
      service="jev"
      scope={props.scope}
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
    />
  );
}
