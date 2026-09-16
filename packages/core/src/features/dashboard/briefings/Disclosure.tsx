'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/utils/Helpers';

/**
 * One disclosure, used everywhere the briefing hides depth: "View full
 * pipeline ↓", the agent-activity expansion, *Sources & run details*, the
 * "Why?" behind an unavailable metric, the changes the attention budget
 * folded away.
 *
 * It exists so progressive disclosure looks and behaves the same in all five
 * places — hide complexity, never hide truth (manifesto §12) — rather than
 * five slightly different `<details>` elements.
 * @param props
 * @param props.label - What the closed state says.
 * @param props.children - What opens.
 * @param props.count - A quiet count beside the label.
 * @param props.tone - `quiet` for the collapsed provenance at the foot of the page.
 * @param props.className - Extra classes for the wrapper.
 */
export function Disclosure({ label, children, count, tone = 'default', className }: {
  label: ReactNode;
  children: ReactNode;
  count?: number;
  tone?: 'default' | 'quiet';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('not-prose', className)}>
      <CollapsibleTrigger
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-md py-1 text-left text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
          tone === 'quiet' ? 'text-muted-foreground hover:text-foreground' : 'text-foreground hover:text-brand-amber-deep',
        )}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        <span>{label}</span>
        {count !== undefined && <span className="text-muted-foreground tabular-nums">{count}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pb-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}
