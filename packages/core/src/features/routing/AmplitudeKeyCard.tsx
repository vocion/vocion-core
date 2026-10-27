'use client';

/**
 * The key that turns Amplitude analytics on (`services/analytics/amplitudeKey.ts`),
 * at one level: the instance (System) or this workspace (Developers), as a
 * System Keys card.
 */

import type { KeyOnFile, KeyScope } from '@/services/keys/systemKeys';
import { ChartLine } from 'lucide-react';
import { SystemKeyCard } from './SystemKeyCard';

export type AmplitudeKeyCardProps = {
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

export function AmplitudeKeyCard(props: AmplitudeKeyCardProps) {
  return (
    <SystemKeyCard
      service="amplitude"
      scope={props.scope}
      name="Amplitude"
      blurb="Product analytics for people and agents: page views, clicks, and every model and tool call, metadata only."
      icon={ChartLine}
      tint="sky"
      note={props.note}
      hint={props.onFile?.hint ?? null}
      source={props.onFile?.source ?? null}
      console={{ href: 'https://app.amplitude.com', label: 'amplitude.com' }}
      canEdit={props.canEdit}
      lock={props.lock}
    />
  );
}
