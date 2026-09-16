import type { ReactNode } from 'react';
import { cn } from '@/utils/Helpers';
import { citationLabel, evidenceSource, isCitationUrl } from './evidence';

/**
 * EvidenceList — what the research rests on, one claim per row: the claim,
 * then a `Fact | Inference` chip and the citation. Every claim carries its
 * kind and where it came from — an unsourced claim is not a claim, and a fact
 * and an inference are not the same thing. Hairline-divided rows, no box.
 */

export type EvidenceItem = {
  text: ReactNode;
  kind: string;
  source: string;
  date?: string;
  key?: string;
};

const SOURCE_CHIP: Record<'fact' | 'inference' | 'other', string> = {
  fact: 'bg-brand-pass-bg text-brand-pass',
  inference: 'bg-brand-borderline-bg text-brand-borderline',
  other: 'bg-surface-soft text-muted-foreground',
};

/**
 * @param props
 * @param props.kind
 * @param props.className
 */
export function SourceChip(props: { kind: string; className?: string }) {
  const src = evidenceSource(props.kind);
  return (
    <span data-pattern="source-chip" data-tone={src.tone} className={cn('inline-flex h-[18px] items-center rounded-full px-1.5 text-[10px] font-semibold tracking-wide uppercase', SOURCE_CHIP[src.tone], props.className)}>
      {src.label}
    </span>
  );
}

/**
 * `renderSource` lets a page make its citations openable — see
 * `features/preview`. The pattern stays pure: it decides the layout, the page
 * decides whether a citation is a link, a peek, or just text.
 * @param props
 * @param props.items
 * @param props.empty
 * @param props.renderSource - Render one citation; falls back to the label.
 * @param props.className
 */
export function EvidenceList(props: { items: readonly EvidenceItem[]; empty?: ReactNode; renderSource?: (source: string) => ReactNode; className?: string }) {
  if (props.items.length === 0) {
    return props.empty ? <p className="text-muted-foreground">{props.empty}</p> : null;
  }
  return (
    <ul data-pattern="evidence-list" className={cn('divide-y divide-rule', props.className)}>
      {props.items.map((item, i) => (
        <li key={item.key ?? `${item.kind}-${item.source}-${i}`} className="py-2.5">
          <div className="text-sm leading-relaxed text-foreground">{item.text}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <SourceChip kind={item.kind} />
            {props.renderSource
              ? props.renderSource(item.source)
              : isCitationUrl(item.source)
                ? (
                    <a href={item.source} target="_blank" rel="noopener noreferrer" className="truncate underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground">
                      {citationLabel(item.source)}
                    </a>
                  )
                : <span className="truncate">{citationLabel(item.source)}</span>}
            {item.date && <span className="tabular-nums">{item.date}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
