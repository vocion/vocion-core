'use client';

import type { ReactNode } from 'react';
import type { Tint } from '@/libs/tints';
import { ArrowRight } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Link } from '@/libs/I18nNavigation';
import { TINT_BG } from '@/libs/tints';
import { cn } from '@/utils/Helpers';

/**
 * CatalogCard — the Front doors archetype (`docs/design/patterns.md` § Front
 * doors). A card is a door you choose or start from — an app, an agent to
 * hire, a connector to add, the first thing to do on an empty page — never a
 * record you are working on. Records are rows (`ListRow`).
 *
 * The anatomy is fixed, and short on purpose:
 *
 *   [lead]  KICKER                                   [badge]
 *           Title
 *           One sentence: the job it does.
 *           Action label →
 *   [visual — optional, small]
 *
 * - **kicker** — what kind of thing it is ("App", "Agent", "Connector").
 * - **title** — its name.
 * - **job** — ONE sentence, in the reader's terms: what it does for them.
 *   Not a feature list, not two sentences.
 * - **action** — ONE arrow link (or a button, for a door that opens a dialog).
 *   The whole card is its click target; the label is what it does.
 * - **lead** — a small mark: `LetterTile`, `AgentDot`. **visual** — an
 *   optional small picture under the text. **badge** — a `StatusBadge`.
 * - **tint** — the soft colour block the thing wears (`libs/tints.ts`).
 *   Without one the card is the hairline surface.
 *
 * It is a `Surface`, so a card inside another bordered surface warns in
 * development. No display type, no glow, no shadow.
 */

export type CatalogCardAction
  = | { label: string; href: string }
    | { label: string; onClick: () => void };

export type CatalogCardProps = {
  kicker?: ReactNode;
  title: string;
  /** One sentence: the job this does for the reader. */
  job: ReactNode;
  action: CatalogCardAction;
  lead?: ReactNode;
  badge?: ReactNode;
  visual?: ReactNode;
  tint?: Tint;
  /** Dim the card: a door that is not open yet (Coming). Still readable, still AA. */
  muted?: boolean;
  className?: string;
};

export function CatalogCard(props: CatalogCardProps) {
  const { action } = props;
  const label = (
    <>
      {action.label}
      <span className="sr-only">{` ${props.title}`}</span>
      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </>
  );
  // The action stretches over the card (`after:absolute after:inset-0`), so the
  // whole card is one target and there is still exactly one link in it.
  const actionClass = 'mt-3 inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] font-medium text-foreground outline-hidden after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring/50 sm:min-h-0';
  return (
    <Surface
      name="catalog-card"
      as="article"
      data-pattern="catalog-card"
      data-tint={props.tint}
      className={cn(
        'group relative flex flex-col rounded-2xl p-5 transition-colors',
        props.tint ? [TINT_BG[props.tint], 'border-transparent hover:brightness-[0.98] dark:hover:brightness-110'] : 'hover:bg-surface-hover',
        props.muted && 'opacity-80',
        props.className,
      )}
    >
      <div className="flex items-start gap-3">
        {props.lead && <div className="shrink-0">{props.lead}</div>}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {props.kicker && <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{props.kicker}</p>}
              <h3 className={cn('text-[15px] leading-snug font-semibold text-foreground', props.kicker && 'mt-0.5')}>{props.title}</h3>
            </div>
            {props.badge && <div className="relative z-[1] shrink-0">{props.badge}</div>}
          </div>
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{props.job}</p>
          {'href' in action
            ? <Link href={action.href} className={actionClass}>{label}</Link>
            : <button type="button" onClick={action.onClick} className={actionClass}>{label}</button>}
        </div>
      </div>
      {props.visual && <div className="mt-4">{props.visual}</div>}
    </Surface>
  );
}

/**
 * The grid front doors sit in: one column on a phone, two, then three.
 * @param props
 * @param props.children - `CatalogCard`s.
 * @param props.className
 */
export function CatalogCards({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-pattern="catalog-cards" className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}>{children}</div>;
}
