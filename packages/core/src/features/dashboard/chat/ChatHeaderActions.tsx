'use client';

import type { HistoryHit } from './HistoryPopover';
import { SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { chatHotkeyLabel } from './chatHotkeys';
import { ChatMenu } from './ChatMenu';
import { HistoryPopover } from './HistoryPopover';

/**
 * The chat's header controls, the same on the full page and in the rail
 * (Chris, 2026-09-18): New chat and the conversations dropdown as top-level
 * icons, with All conversations the dropdown's last, separated row; the ⋯
 * menu holding the same two verbs only where the row is too narrow for icons
 * (a phone, the rail's sheet). No workspace name — the sidebar already says
 * it; no autonomy rung — that moved into the input bar with the model control.
 * @param props
 * @param props.onNewChat - Start a fresh thread on this surface (and focus the box).
 * @param props.onCopy
 * @param props.history - The conversations dropdown's data, or null when the surface has no history (a scoped rail).
 * @param props.compact - Force the ⋯ menu (the rail's phone sheet); undefined = decided by viewport width.
 */
export function ChatHeaderActions({ onNewChat, onCopy, history, compact }: {
  onNewChat: () => void;
  /** Build the thread as plain text, on demand. Null on a surface with nothing to copy. */
  onCopy?: (() => string) | null;
  history: { recent: HistoryHit[]; currentId: number | null; onPick: (id: number) => void; search: (q: string) => Promise<HistoryHit[]> } | null;
  compact?: boolean;
}) {
  const t = useTranslations('Chat');
  const icons = compact === true ? 'hidden' : compact === false ? 'flex items-center gap-1' : 'hidden items-center gap-1 sm:flex';
  const menu = compact === true ? 'flex' : compact === false ? 'hidden' : 'flex sm:hidden';
  return (
    <div className="flex items-center gap-1" data-testid="chat-header-actions">
      <span className={icons}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onNewChat}
              aria-label={t('new_chat')}
              data-testid="new-chat"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <SquarePen className="size-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" collisionPadding={8}>{`${t('new_chat')} · ${chatHotkeyLabel('new-chat')}`}</TooltipContent>
        </Tooltip>
        {history && <HistoryPopover recent={history.recent} currentId={history.currentId} onPick={history.onPick} search={history.search} />}
      </span>
      <span className={menu}>
        <ChatMenu onNewChat={onNewChat} onCopy={onCopy} />
      </span>
    </div>
  );
}
