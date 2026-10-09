'use client';

import type { OpeningHint } from '@/libs/chat/openingHints';
import { ArrowRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/**
 * The opening hint by the composer of an empty conversation: usually one
 * quiet chip, two at most, stacked (`libs/chat/openingHints.ts` ranks them).
 * Clicking starts the flow in chat — it sends the ask, or opens setup or a
 * connection through the page they already live on. "Why this?" is the
 * reason, on hover or keyboard focus on a desktop and on a long press on a
 * phone. × hides that item for 7 days and lowers its type for this person.
 * Shown, clicked and dismissed are recorded (`chat.hint_*`) so the weights
 * can be tuned.
 * @param props - The hints and what to do with an ask.
 * @param props.hints - The ranked hints, best first.
 * @param props.onSend - Sends an ask in this conversation.
 */
export function OpeningHints({ hints, onSend }: { hints: readonly OpeningHint[]; onSend: (prompt: string) => void }) {
  const router = useRouter();
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [why, setWhy] = useState<string | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const shown = hints.filter(h => !gone.has(h.key));
  const wire = (h: OpeningHint, i: number) => ({ key: h.key, type: h.type, score: h.score, rank: i + 1 });

  useEffect(() => {
    if (hints.length > 0) {
      void client.chat.hintEvent({ event: 'shown', hints: hints.map(wire) }).catch(() => {});
    }
  }, [hints]);

  if (shown.length === 0) {
    return null;
  }

  const act = (h: OpeningHint, i: number) => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    void client.chat.hintEvent({ event: 'clicked', hints: [wire(h, i)] }).catch(() => {});
    setGone(g => new Set([...g, h.key]));
    if (h.action.kind === 'send') {
      onSend(h.action.prompt);
    } else {
      router.push(h.action.href);
    }
  };
  const dismiss = (h: OpeningHint, i: number) => {
    void client.chat.hintEvent({ event: 'dismissed', hints: [wire(h, i)] }).catch(() => {});
    setGone(g => new Set([...g, h.key]));
  };

  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-1.5" data-testid="opening-hints">
      {shown.map((h, i) => (
        <div key={h.key} className="flex w-full min-w-0 flex-col items-center">
          {/* Readable whole at 390px (founder, 2026-10-09: "Tough to tell what
              the hint chip said. Important parts were cut off"): the words wrap
              to two lines rather than cutting mid-word, and the × stands apart
              from them. */}
          <span data-testid="opening-hint" data-type={h.type} className="flex max-w-full min-w-0 animate-in items-center gap-1 text-[12.5px] text-muted-foreground fade-in">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => act(h, i)}
                  onPointerDown={(e) => {
                    if (e.pointerType !== 'touch') {
                      return;
                    }
                    longPressed.current = false;
                    press.current = setTimeout(() => {
                      longPressed.current = true;
                      setWhy(h.key);
                    }, 500);
                  }}
                  onPointerUp={() => press.current && clearTimeout(press.current)}
                  onPointerLeave={() => press.current && clearTimeout(press.current)}
                  onContextMenu={e => e.preventDefault()}
                  aria-describedby={`hint-why-${i}`}
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-2xl border border-border/70 bg-background py-1.5 pr-2.5 pl-3 text-left transition-colors [-webkit-touch-callout:none] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none max-md:min-h-11"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-brand-amber" aria-hidden />
                  <span className="line-clamp-2 min-w-0 leading-snug break-words" data-testid="opening-hint-label">{h.label.replace(/ →$/, '')}</span>
                  <ArrowRight className="size-3.5 shrink-0" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>{`Why this? ${h.reason}`}</TooltipContent>
            </Tooltip>
            <button
              type="button"
              onClick={() => dismiss(h, i)}
              aria-label={`Not now: ${h.label.replace(/ →$/, '')}`}
              data-testid="opening-hint-dismiss"
              className="grid size-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none max-md:size-11"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
          <span id={`hint-why-${i}`} className={why === h.key ? 'mt-1 max-w-xs text-center text-[11.5px] text-muted-foreground' : 'sr-only'} data-testid={why === h.key ? 'opening-hint-why' : undefined}>
            {`Why this? ${h.reason}`}
          </span>
        </div>
      ))}
    </div>
  );
}
