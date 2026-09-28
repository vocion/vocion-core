'use client';

import { Sparkles } from 'lucide-react';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { useRouter } from '@/libs/I18nNavigation';

export type PagePrompt = { label: string; prompt: string; agent?: string };

/**
 * A page's own asks, as buttons (`prompts:` in the page YAML): each opens a
 * NEW chat with its prompt already sent to the named agent, so the answer is
 * already coming by the time the rail is open (Chris, 2026-09-25: "click to
 * new chat with first prompt pre-pended and already thinking"). The words
 * live in the workspace, where a person can change them, never in core.
 * @param props
 * @param props.prompts - The page's declared prompts.
 * @param props.page - The page's title, attached as the chat's context.
 */
export function PagePrompts({ prompts, page }: { prompts: PagePrompt[]; page: string }) {
  const router = useRouter();
  if (prompts.length === 0) {
    return null;
  }
  return (
    <div className="mb-4 flex flex-wrap gap-2" data-testid="page-prompts">
      {prompts.map(p => (
        <button
          key={p.label}
          type="button"
          onClick={() => openAgentSurface({ prompt: p.prompt, send: true, newChat: true, agentSlug: p.agent, context: { path: window.location.pathname, title: page } }, href => router.push(href))}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Sparkles className="size-3.5 text-brand-amber" aria-hidden />
          {p.label}
        </button>
      ))}
    </div>
  );
}
