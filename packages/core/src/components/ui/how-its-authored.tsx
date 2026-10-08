import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/utils/Helpers';

/**
 * HowItsAuthored — where the developer detail goes on a person's page: the
 * folder a thing is authored in, the command that applies it, the manifest
 * key that turns it on. A front door or an empty state says what a thing is
 * and offers one action a person can take in the product; the file paths sit
 * one click behind this quiet disclosure (`docs/design/patterns.md` § Front
 * doors), so the people who author the workspace still find them and nobody
 * else has to read them.
 *
 * A native `<details>`: keyboard and screen reader behaviour for free, no
 * client JavaScript, closed by default.
 * @param props
 * @param props.children - The detail: a sentence or two, `code` welcome.
 * @param props.docsHref - Optional link to the authoring docs, after the detail.
 * @param props.label - The summary's words. Default "How it's authored".
 * @param props.className
 */
export function HowItsAuthored({ children, docsHref, label = 'How it\'s authored', className }: {
  children: ReactNode;
  docsHref?: string;
  label?: string;
  className?: string;
}) {
  return (
    <details data-slot="how-its-authored" className={cn('group/authored text-[12px] text-muted-foreground', className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md transition-colors outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 sm:min-h-0 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform group-open/authored:rotate-90" aria-hidden />
        {label}
      </summary>
      <div className="mt-1.5 leading-relaxed [&_code]:rounded [&_code]:bg-surface-soft [&_code]:px-1 [&_code]:font-mono [&_code]:text-[11px]">
        {children}
        {docsHref && (
          <>
            {' '}
            <a href={docsHref} className="underline decoration-border underline-offset-2 hover:text-foreground">Read the docs</a>
          </>
        )}
      </div>
    </details>
  );
}
