import type { ResultLink } from '@/libs/actions/resultLinks';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';

/**
 * What a done run made, one link each — the ONE place that draws them, for
 * the chat card's settled state and the review receipt alike
 * (`libs/actions/resultLinks.ts` reads them off the run's result).
 * Renders nothing when the run named nothing.
 * @param props - The links and where they sit.
 * @param props.links - From `resultLinks`.
 * @param props.className - Placement from the caller; the links keep their own look.
 */
export function ResultLinks({ links, className }: { links: readonly ResultLink[]; className?: string }) {
  if (links.length === 0) {
    return null;
  }
  const look = 'inline-flex shrink-0 items-center gap-1 font-medium text-brand-amber-deep hover:opacity-90';
  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ${className ?? ''}`} data-testid="result-links">
      {links.map(l => l.external
        ? (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={look} data-testid="result-link">
              {l.label}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )
        : (
            <Link key={l.href} href={l.href} className={look} data-testid="result-link">
              {`Open ${l.label}`}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          ))}
    </span>
  );
}
