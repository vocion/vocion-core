'use client';

import type { ReactNode } from 'react';
import { createContext, use } from 'react';

/**
 * A bordered surface — the ONE card in the system, and the guard that keeps
 * it from containing another one.
 *
 * **Never: a bordered surface contains another bordered surface.** A border
 * says "this is a thing"; a border inside a border says it twice and means it
 * once, and the reader pays for the second frame in noise
 * (MANIFESTO §4 — one obvious thing, not five possible ones; §16 — hierarchy
 * comes from space, not from chrome). Nesting is expressed with a HAIRLINE, a
 * gap and an eyebrow label instead: `<SurfaceSection eyebrow="…">`.
 *
 * The rule is enforced where rules actually hold — at runtime, in
 * development. `Surface` publishes its depth through context; a `Surface`
 * that renders at depth ≥ 1 warns in the console with both names. It is a
 * warning, never a throw: a design rule must not be able to take a page down.
 * Production ships the plain element with no context read cost worth naming.
 *
 * See `docs/design/patterns.md`.
 */

/** How many `Surface` ancestors are above this point in the React tree. */
const SurfaceDepthContext = createContext(0);

/** The border+radius+ground every bordered surface in the app shares. */
export const SURFACE_CLASS = 'rounded-xl border border-border bg-card';

/** Warn once per pair, so a list of 40 rows does not print 40 identical lines. */
const warned = new Set<string>();

/**
 * The console line a nested surface prints. Exported so the test asserts the
 * rule's wording rather than a substring of it.
 * @param name - The inner surface's name.
 * @returns The warning text.
 */
export function nestedSurfaceWarning(name: string): string {
  return `Nested bordered surface: <Surface name="${name}"> is rendered inside another Surface. A bordered surface never contains another bordered surface — nest with hairlines, spacing and eyebrows instead (docs/design/patterns.md).`;
}

export type SurfaceProps = {
  /** What this surface is, for the dev warning: "guided review", "brief". */
  name: string;
  /** Extra classes — padding, width, a tint. The border/radius/ground come from `SURFACE_CLASS`. */
  className?: string;
  children?: ReactNode;
  /** Render as a `section`/`article` when the surface is a landmark. */
  as?: 'div' | 'section' | 'article' | 'aside';
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>;

/**
 * A bordered surface. Renders one box and forbids another inside it.
 * @param props - Surface props.
 * @param props.name - What this surface is, used by the dev warning.
 * @param props.className - Extra classes beside `SURFACE_CLASS`.
 * @param props.children - The surface's content.
 * @param props.as - The element to render.
 */
export function Surface({ name, className = '', children, as: Tag = 'div', ...rest }: SurfaceProps) {
  const depth = use(SurfaceDepthContext);
  if (process.env.NODE_ENV !== 'production' && depth > 0 && !warned.has(name)) {
    warned.add(name);
    console.warn(nestedSurfaceWarning(name));
  }
  return (
    <SurfaceDepthContext value={depth + 1}>
      <Tag className={`${SURFACE_CLASS} ${className}`.trim()} {...rest}>
        {children}
      </Tag>
    </SurfaceDepthContext>
  );
}

/**
 * A block INSIDE a surface: a hairline above it, an eyebrow label, content.
 * This is what a nested card becomes — the same grouping, none of the chrome.
 * @param props - Section props.
 * @param props.eyebrow - The small uppercase label naming the block.
 * @param props.title - An optional bold line under the eyebrow.
 * @param props.actions - Buttons for this block, laid out under the content.
 * @param props.children - The block's content.
 * @param props.className - Extra classes on the block.
 * @param props.first - True for the first block, which takes no hairline.
 */
export function SurfaceSection({ eyebrow, title, actions, children, className = '', first = false }: {
  eyebrow?: string;
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  first?: boolean;
}) {
  return (
    <div className={`${first ? '' : 'border-t border-rule pt-3'} ${className}`.trim()}>
      {eyebrow && (
        <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{eyebrow}</div>
      )}
      {title && <div className="mt-0.5 text-[13.5px] font-bold">{title}</div>}
      {children}
      {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Reset the once-per-name warning ledger. Tests only — a second test that
 * renders the same nesting needs the warning to fire again.
 */
export function resetSurfaceWarnings(): void {
  warned.clear();
}
