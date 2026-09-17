'use client';

import type { ChatComposerProps, ComposerCopy } from './ChatComposer';
import type { QueuedMessage } from './queueReducer';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

/** The slice of `useChatSession` the queue affordance needs. */
export type QueueBearingSession = {
  composerValue: string;
  queuedMessages: QueuedMessage[];
  queueHeld: boolean;
  queueMessage: (text: string) => void;
  dropQueued: (id: string) => void;
  editQueued: (id: string) => void;
  releaseQueueNotice: () => void;
  sendNow: (text: string) => void | Promise<void>;
};

type QueueProps = Pick<
  ChatComposerProps,
  'queued' | 'onQueue' | 'onDropQueued' | 'onEditQueued' | 'onSendNow' | 'queueHeld' | 'onDismissHeld' | 'copy'
>;

/**
 * Every ChatComposer prop the send queue needs, translated, in one spread —
 * plus the composer's other translated strings, which ride in the same `copy`
 * object because `copy` is one prop.
 *
 * Three surfaces render the same composer — the full page (`ChatShell`), the
 * rail (`ChatDock`) and the canvas (`CanvasView`) — and a queue that only
 * worked on one of them would be worse than none, because the rail is where
 * people actually type mid-turn. One hook keeps the three honest.
 * @param session - The `useChatSession` return (or the slice above).
 */
export function useComposerQueueProps(session: QueueBearingSession): QueueProps {
  const t = useTranslations('Chat');
  const copy: Partial<ComposerCopy> = useMemo(() => ({
    streamingPlaceholder: t('queue_placeholder'),
    queuedLabel: t('queue_label'),
    removeQueued: t('queue_remove'),
    editQueued: t('queue_edit'),
    moreQueued: (count: number) => t('queue_more', { count }),
    queueAction: t('queue_action'),
    heldNotice: t('queue_held'),
    dismiss: t('queue_dismiss'),
    // `copy` is ONE prop, so it travels with the queue spread rather than
    // splitting into a second one the surfaces would have to remember.
    attach: t('attach'),
  }), [t]);

  return {
    queued: session.queuedMessages,
    queueHeld: session.queueHeld,
    onQueue: session.queueMessage,
    onDropQueued: session.dropQueued,
    onEditQueued: session.editQueued,
    onDismissHeld: session.releaseQueueNotice,
    onSendNow: (text: string) => void session.sendNow(text),
    copy,
  };
}
