'use client';

import { Brain, ChevronDown } from 'lucide-react';
import { useState } from 'react';

/**
 * A `<scratch>` block that reached a stored text run, folded.
 *
 * The live turn never shows one — the streamer routes the block to the trace
 * as reasoning (`services/agents/answerStream.ts`). This is for the text a
 * reload hands back: a turn persisted before the streamer watched the whole
 * reply, or a harness whose loop we do not gate. The block is the model
 * thinking, so it reads the way the trace's reasoning line does — one muted
 * line, "Thinking", that opens on tap into monospace — never as prose.
 * @param props
 * @param props.text - The block's contents, tags removed.
 */
export function ScratchFold({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.split('\n').find(l => l.trim().length > 0)?.trim() ?? '';
  return (
    <div className="not-prose my-1.5" data-testid="scratch-fold">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={open ? 'Hide thinking' : 'Show thinking'}
        className="group/scratch flex w-full items-center gap-2 py-1 text-left text-xs text-muted-foreground/75 transition hover:text-foreground"
      >
        <Brain className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">Thinking</span>
          {!open && preview && (
            <span className="text-muted-foreground/60">{` · ${preview}`}</span>
          )}
        </span>
        <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground/50 transition group-hover/scratch:text-muted-foreground ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          data-testid="scratch-fold-body"
          className="mt-1 ml-6 max-h-72 overflow-y-auto rounded-lg bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground"
        >
          {text.trim()}
        </div>
      )}
    </div>
  );
}
