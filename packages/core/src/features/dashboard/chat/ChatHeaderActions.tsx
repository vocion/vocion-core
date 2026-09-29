'use client';

import type { HistoryHit } from './HistoryPopover';
import { Maximize2, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/libs/I18nNavigation';
import { composerSurfaceOf, focusAgentComposer } from './agentSurface';
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
 * @param props.fullPageHref - The rail's thread on the full chat page (Chris, 2026-09-29: "I don't have a sidebar button to open chat in a full page"); absent on the full page itself.
 * @param props.compact - Fold the conversations control into the ⋯ menu (the rail's phone sheet); undefined = decided by viewport width. New chat never folds.
 */
export function ChatHeaderActions({ onNewChat, onCopy, history, compact, fullPageHref }: {
  onNewChat: () => void;
  fullPageHref?: string | null;
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
      {/* New chat is the most common first move when the sheet opens on a new
          page, so it is a visible icon at EVERY width — never a row inside ⋯
          (Chris, 2026-09-24: "promote that icon out of the context menu"). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // Starting over lands the caret in THIS surface's box, whichever
            // surface it is (Chris, 2026-09-29: "clicking new chat button
            // should auto focus the compose bar").
            onClick={(e) => {
              const surface = composerSurfaceOf(e.currentTarget);
              onNewChat();
              focusAgentComposer(surface);
            }}
            aria-label={t('new_chat')}
            data-testid="new-chat"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <SquarePen className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" collisionPadding={8}>{`${t('new_chat')} · ${chatHotkeyLabel('new-chat')}`}</TooltipContent>
      </Tooltip>
      {fullPageHref && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={fullPageHref}
              aria-label={t('open_full_chat')}
              data-testid="open-full-chat"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <Maximize2 className="size-4" aria-hidden />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" collisionPadding={8}>{t('open_full_chat')}</TooltipContent>
        </Tooltip>
      )}
      <span className={icons}>
        {history && <HistoryPopover recent={history.recent} currentId={history.currentId} onPick={history.onPick} search={history.search} />}
      </span>
      {/* The ⋯ menu carries what is left: Copy conversation, All conversations. */}
      <span className={menu}>
        <ChatMenu onCopy={onCopy} />
      </span>
    </div>
  );
}
