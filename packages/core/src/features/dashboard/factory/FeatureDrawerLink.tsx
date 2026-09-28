'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import type { FeatureDrawerKey } from '@/services/factory/featureReport';
import { useOpenPreviewRef, usePreviewOpener } from '@/features/preview/previewState';
import { previewKey } from '@/libs/preview/types';
import { featureDrawerId } from '@/services/factory/featureDrawer';
import { cn } from '@/utils/Helpers';

/**
 * OPEN THE REST, IN THE PANE. Every "View plan", "View all activity" and
 * criterion on the feature page opens the full record in the one preview
 * pane (`features/preview`) — a side panel at a desk, a bottom sheet on a
 * phone, `?preview=` in the URL so it is linkable and Back closes it. This is
 * only the trigger; there is no second drawer.
 */

const LOOK = {
  primary: 'inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90',
  quiet: 'inline-flex h-8 items-center rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground',
  link: 'text-[13px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground',
  row: 'block w-full min-w-0 rounded-md text-left hover:bg-surface-hover',
} as const;

/**
 * A button that opens one preview.
 * @param props
 * @param props.recordRef - What to open.
 * @param props.look - How the trigger is drawn.
 * @param props.className - Extra classes.
 * @param props.children - The label.
 * @param props.testId - A test hook.
 */
export function PreviewOpen(props: { recordRef: Pick<RecordRef, 'type' | 'id'>; look?: keyof typeof LOOK; className?: string; children: React.ReactNode; testId?: string }) {
  const open = usePreviewOpener(props.recordRef);
  const active = useOpenPreviewRef();
  const isOpen = active !== null && previewKey(active) === previewKey(props.recordRef);
  return (
    <button
      type="button"
      onClick={open}
      aria-expanded={isOpen}
      data-testid={props.testId}
      data-preview-key={previewKey(props.recordRef)}
      className={cn(LOOK[props.look ?? 'link'], isOpen && 'text-foreground', props.className)}
    >
      {props.children}
    </button>
  );
}

/**
 * A feature drawer's trigger — `feature_section:<requestId>.<key>`.
 * @param props
 * @param props.requestId - The request.
 * @param props.drawer - Which drawer.
 * @param props.look - How the trigger is drawn.
 * @param props.className - Extra classes.
 * @param props.children - The label.
 * @param props.testId - A test hook.
 */
export function FeatureDrawerLink(props: { requestId: number; drawer: FeatureDrawerKey; look?: keyof typeof LOOK; className?: string; children: React.ReactNode; testId?: string }) {
  return (
    <PreviewOpen recordRef={{ type: 'feature_section', id: featureDrawerId(props.requestId, props.drawer) }} look={props.look} className={props.className} testId={props.testId ?? `drawer-${props.drawer}`}>
      {props.children}
    </PreviewOpen>
  );
}
