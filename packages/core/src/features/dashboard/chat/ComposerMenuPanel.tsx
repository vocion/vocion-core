'use client';

import type { ComposerMenuItem, ComposerMenuMode, ComposerMenuSection } from './composerMenu';
import { Check, CircleHelp, Paperclip, Slash } from 'lucide-react';
import { selectableItems, TAG_ICON } from './composerMenu';

/**
 * The composer's one panel (`composerMenu.ts` decides its contents). Sits
 * above the input, left-aligned with it, whichever way it was opened — a
 * typed `/` or `@`, the (+) button, the ? button. Sections are hairline
 * separated; the highlighted row follows the arrow keys; the mouse picks on
 * mousedown so the caret never leaves the box.
 * @param props
 * @param props.mode - Which door opened it (drives test hooks and the aria label).
 * @param props.sections - What to show.
 * @param props.cursor - Index into `selectableItems(sections)` of the highlighted row.
 * @param props.onPick - A selectable row was chosen.
 * @param props.onHover - The pointer moved over a selectable row (moves the highlight).
 */
export function ComposerMenuPanel({ mode, sections, cursor, onPick, onHover }: {
  mode: ComposerMenuMode;
  sections: ComposerMenuSection[];
  cursor: number;
  onPick: (item: ComposerMenuItem) => void;
  onHover: (index: number) => void;
}) {
  if (sections.length === 0) {
    return null;
  }
  // Row → arrow-key index, precomputed: the shortcut rows are skipped.
  const order = new Map(selectableItems(sections).map((it, i) => [it.id, i]));
  const label = mode === 'tag' ? 'Tag a record' : mode === 'slash' ? 'Commands' : mode === 'help' ? 'Shortcuts' : 'Add to this turn';
  return (
    <div
      role="listbox"
      aria-label={label}
      data-testid={mode === 'slash' ? 'slash-menu' : 'composer-menu'}
      data-composer-menu={mode}
      className="absolute bottom-full left-0 z-20 mb-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-background p-1 text-sm shadow-(--shadow-pop)"
    >
      {sections.map((section, si) => (
        <div key={section.id} className={si > 0 ? 'mt-1 border-t border-border/60 pt-1' : undefined}>
          <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{section.title}</div>
          <ul>
            {section.items.map((item) => {
              if (item.kind === 'shortcut') {
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-2 py-1 text-xs">
                    <span className="text-muted-foreground">{item.label}</span>
                    <kbd className="shrink-0 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">{item.keys}</kbd>
                  </li>
                );
              }
              const i = order.get(item.id) ?? -1;
              const selected = i === cursor;
              const Icon = item.kind === 'command' ? Slash : item.kind === 'file' ? Paperclip : item.kind === 'help' ? CircleHelp : item.kind === 'setting' ? null : TAG_ICON[item.ref.type];
              return (
                <li key={item.id} role="option" aria-selected={selected} data-setting-selected={item.kind === 'setting' && item.selected ? 'true' : undefined}>
                  <button
                    type="button"
                    data-testid={item.kind === 'tag' && mode === 'plus' ? 'composer-attach-item' : undefined}
                    onMouseEnter={() => onHover(i)}
                    // mousedown, not click: a click lands after the box has
                    // blurred, and the caret position the pick needs is gone.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick(item);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${selected ? 'bg-muted' : 'hover:bg-muted/60'}`}
                  >
                    {Icon
                      ? <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      : <span className="flex size-3.5 shrink-0 items-center justify-center">{item.kind === 'setting' && item.selected && <Check className="size-3.5 text-foreground" aria-hidden />}</span>}
                    <span className="min-w-0 flex-1 truncate">
                      <span className={item.kind === 'command' ? 'font-medium' : undefined}>{item.label}</span>
                      {item.hint && <span className="ml-2 text-[12px] text-muted-foreground">{item.hint}</span>}
                    </span>
                    {item.kind === 'command' && item.shortcut && <span className="shrink-0 text-[11px] tracking-widest text-muted-foreground">{item.shortcut}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
