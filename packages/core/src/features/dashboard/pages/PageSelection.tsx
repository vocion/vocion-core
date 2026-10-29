'use client';

import type { PagePrompt } from './PagePrompts';
import type { RecordRef } from '@/services/chat/pageContext';
import { Sparkles } from 'lucide-react';
import { createContext, use, useMemo, useState } from 'react';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { useRouter } from '@/libs/I18nNavigation';

/** One ticked row: its record id and the name the page shows for it. */
export type SelectedRow = { id: string; label: string };

type Selection = {
  selected: Map<string, SelectedRow>;
  toggle: (row: SelectedRow, on: boolean) => void;
};

const SelectionContext = createContext<Selection | null>(null);

/**
 * The message a selection prompt sends: its words, then each ticked row by
 * name and record id, so the agent can act on exactly those rows. Pure.
 * @param prompt - The page's words.
 * @param rows - The ticked rows, in the order ticked.
 */
export function selectionMessage(prompt: string, rows: readonly SelectedRow[]): string {
  return `${prompt.trim()}\n\n${rows.map(r => `- ${r.label} (record #${r.id})`).join('\n')}`;
}

/**
 * The rows a person ticks on a list page, and what they can ask about them
 * (`selectionPrompts:` in the page YAML). The tables inside draw a checkbox
 * per row ({@link SelectRowBox}); once one is ticked the asks show above the
 * rows. Each opens a NEW chat with its words and the ticked rows already
 * sent to the named agent, the rows handed over as the chat's records — the
 * same way a page's own asks start a chat (`PagePrompts`).
 * @param props - Props.
 * @param props.prompts - The page's selection prompts.
 * @param props.page - The page's title, attached as the chat's context.
 * @param props.objectType - The records' type, so the chat is handed them by kind.
 * @param props.children - The rows.
 */
export function PageSelection({ prompts, page, objectType, children }: { prompts: PagePrompt[]; page: string; objectType?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Map<string, SelectedRow>>(() => new Map());
  const value = useMemo<Selection>(() => ({
    selected,
    toggle: (row, on) => setSelected((prev) => {
      const next = new Map(prev);
      if (on) {
        next.set(row.id, row);
      } else {
        next.delete(row.id);
      }
      return next;
    }),
  }), [selected]);
  const rows = [...selected.values()];
  const ask = (p: PagePrompt) => {
    const refs: RecordRef[] = rows.map(r => ({ type: 'object', id: r.id, label: r.label, href: `/dashboard/objects/${r.id}`, ...(objectType ? { objectType } : {}) }));
    openAgentSurface({ prompt: selectionMessage(p.prompt, rows), send: true, newChat: true, agentSlug: p.agent, context: { path: window.location.pathname, title: page, refs } }, href => router.push(href));
  };
  return (
    <SelectionContext value={value}>
      {rows.length > 0 && (
        <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-2 backdrop-blur" data-testid="page-selection-bar">
          <span className="text-sm font-medium">
            {rows.length}
            {' '}
            selected
          </span>
          {prompts.map(p => (
            <button
              key={p.label}
              type="button"
              onClick={() => ask(p)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Sparkles className="size-3.5 text-muted-foreground" aria-hidden />
              {p.label}
            </button>
          ))}
          <button type="button" onClick={() => setSelected(new Map())} className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline">
            Clear
          </button>
        </div>
      )}
      {children}
    </SelectionContext>
  );
}

/**
 * A row's checkbox, inside a {@link PageSelection}; nothing outside one. Its
 * click and keys stay with it: the row around it opens the record.
 * @param props - Props.
 * @param props.id - The record id.
 * @param props.label - The name the page shows for the row.
 */
export function SelectRowBox({ id, label }: SelectedRow) {
  const selection = use(SelectionContext);
  if (!selection) {
    return null;
  }
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      checked={selection.selected.has(id)}
      onChange={e => selection.toggle({ id, label }, e.target.checked)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      className="size-4 cursor-pointer accent-foreground"
      data-testid="select-row"
    />
  );
}
