'use client';

import { Mail, Pencil, Plug, Slack, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { InlineTitle } from '@/components/ui/inline-title';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

// `mcp`: a conversation an MCP client opened with ask_workspace (`services/chat/workspaceTurn.ts`).
// `assistant`: a person's own assistant asked this workspace on their behalf (`services/agents/tools/assistant.ts`).
const SURFACE_ICON = { email: Mail, slack: Slack, mcp: Plug, assistant: Sparkles } as const;

/**
 * One thread on /dashboard/conversations. The row is a link into the thread;
 * the pencil beside it renames the thread in place with the same field the
 * chat header uses (`InlineTitle`), so the name a person gives here is the
 * name the header and the rail show. Optimistic: a failed write puts the old
 * name back.
 * @param props
 * @param props.id - The conversation.
 * @param props.title - Its name as the page read it.
 * @param props.snippet - The matched text, when the list is a search.
 * @param props.meta - "3 messages · about a record".
 * @param props.time - When it was last touched, already formatted.
 * @param props.surface - Where it began ('app', 'email', 'slack', 'mcp', 'assistant'); anything but the app gets an icon.
 */
export function ConversationListRow({ id, title, snippet, meta, time, surface }: {
  id: number;
  title: string;
  snippet: string | null;
  meta: string;
  time: string;
  surface: string;
}) {
  const t = useTranslations('Chat');
  const [name, setName] = useState(title);
  const [editing, setEditing] = useState(false);
  const SurfaceIcon = SURFACE_ICON[surface as keyof typeof SURFACE_ICON];

  const rename = async (next: string) => {
    const previous = name;
    setName(next);
    try {
      await client.conversations.rename({ id, title: next });
    } catch (error) {
      console.warn('conversations: could not rename the thread', id, error);
      setName(previous);
    }
  };

  return (
    <div className="group/row flex items-start gap-1 hover:bg-surface-hover" data-testid="conversation-row">
      {editing
        ? (
            <div className="min-w-0 flex-1 px-4 py-2.5">
              <InlineTitle
                value={name}
                onRename={next => void rename(next)}
                label={t('rename_conversation')}
                inputLabel={t('conversation_title')}
                className="text-sm font-medium"
                testId="conversation-row-title"
                editing
                onEditingChange={setEditing}
              />
              <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span>
            </div>
          )
        : (
            <Link href={`/dashboard/chat/${id}`} className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 text-sm">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  {SurfaceIcon && <SurfaceIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={surface} />}
                  <span className="truncate font-medium text-foreground" data-testid="conversation-row-name">{name}</span>
                </span>
                {snippet && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{snippet}</span>}
                <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span>
              </span>
              <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">{time}</span>
            </Link>
          )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`${t('rename_conversation')}: ${name}`}
            data-testid="conversation-row-rename"
            className="mt-2 mr-2 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-60 transition group-hover/row:opacity-100 hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" collisionPadding={8}>{t('rename_conversation')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
