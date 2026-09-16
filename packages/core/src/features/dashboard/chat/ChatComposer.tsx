'use client';

import type { QueuedMessage } from './queueReducer';
import type { ContextRef } from './types';
import { ArrowUp, AtSign, Bot, CircleHelp, CornerDownLeft, Square, Target, Users, X } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';

/**
 * Sticky-bottom composer — an input and ONE primary action.
 *
 * - max-width 3xl, centered
 * - rounded-2xl, `focus-within:ring-1` in the ring token at low alpha with a
 *   soft background shift (2026-09-15: it was a 4px amber halo plus a tinted
 *   drop shadow, which read as an error state)
 * - auto-resize textarea (24px → 220px)
 * - round send button, amber filled when enabled
 *
 * Two quiet affordances ride along (agent-chat-surface.md §9):
 *   `@` tags a record (agent, team, mission) the message is about — a chip
 *       beside the box, sent as `context_refs`, never inlined in the text;
 *   `?` (the key on an empty box, or the small mark beside send) opens the
 *       shortcuts in a collision-aware popover.
 *
 * The autonomy rung used to be a third thing in here — a two-segment toggle
 * that dominated the box. It is a per-CONVERSATION setting, not a per-message
 * action, so it moved to the rail header (`AutonomyControl`), leaving the
 * composer with one primary action (Manifesto §4, §11).
 *
 * THE BOX NEVER LOCKS (2026-09-15). It used to go `disabled` for the whole
 * turn, which taught people to stop thinking while the agent thinks. Now
 * Enter mid-turn QUEUES — the queued lines render as compact rows right above
 * the box, each droppable with ✕ and clickable to pull back in for an edit,
 * and they go out in order the moment the turn lands. ⌘⏎ stops the turn and
 * sends immediately; Esc on an empty box stops it. Enter alone never kills a
 * running turn.
 *
 * Stateless about the conversation: the parent owns `value`, `onChange`,
 * `onSubmit`, `disabled` and the tags. Copy for the shortcuts comes from this
 * module, so the component renders in tests with no i18n provider; the queue
 * strings are i18n'd by the parent and passed in with English defaults.
 */

export type ChatComposerProps = {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** True while a turn is streaming — the send button becomes a Stop button. */
  streaming?: boolean;
  /** Abort the in-flight turn (shown as Stop while streaming). */
  onStop?: () => void;
  /** Something else is attached (anchored notes), so an empty box can still send. */
  armed?: boolean;
  /** Captured pasted material, rendered as a chip so the instruction stays readable (032 §2.1 rule 5). */
  pastedText?: string | null;
  /** A large paste was intercepted — the session stores it beside the message. */
  onPasteText?: (text: string) => void;
  /** The chip's remove control. */
  onClearPasted?: () => void;
  /** Records the next message is about (`@` tags). */
  tags?: ContextRef[];
  onRemoveTag?: (ref: ContextRef) => void;
  onAddTag?: (ref: ContextRef) => void;
  /** Resolve `@query` to taggable records. Absent = the `@` affordance is off. */
  tagSearch?: (q: string) => Promise<ContextRef[]>;
  /** A slash command is armed (`/search …`) — the parent names the mode; rendered as a pill above the box. */
  commandHint?: string;
  /** Messages typed during this turn, waiting for it to land. Oldest first. */
  queued?: QueuedMessage[];
  /** Enter while streaming — append to the queue rather than send. */
  onQueue?: (text: string) => void;
  /** The ✕ on a queued row. */
  onDropQueued?: (id: string) => void;
  /** Clicking a queued row — it goes back in the box for an edit. */
  onEditQueued?: (id: string) => void;
  /** ⌘⏎ / Ctrl+⏎ — stop the running turn and send this message now. */
  onSendNow?: (text: string) => void;
  /** A stopped or failed turn left the queue unsent — say so above the box. */
  queueHeld?: boolean;
  /** Dismiss the "not sent" notice. */
  onDismissHeld?: () => void;
  /** i18n'd queue copy. Every key has an English default so the component renders bare in tests. */
  copy?: Partial<ComposerCopy>;
};

/** Everything the queue affordance says, so the parent can translate it. */
export type ComposerCopy = {
  /** Placeholder while a turn is running. */
  streamingPlaceholder: string;
  /** Header above the queued rows. */
  queuedLabel: string;
  /** aria-label on a row's ✕. */
  removeQueued: string;
  /** aria-label on a row (clicking edits it). */
  editQueued: string;
  /** "+N more" when the list is capped. */
  moreQueued: (count: number) => string;
  /** aria-label on the queue (send) button while streaming. */
  queueAction: string;
  /** The held-queue notice. */
  heldNotice: string;
  /** Dismiss control on the notice. */
  dismiss: string;
};

const DEFAULT_COPY: ComposerCopy = {
  streamingPlaceholder: 'Queue a message… ⌘⏎ to send now',
  queuedLabel: 'Queued',
  removeQueued: 'Remove queued message',
  editQueued: 'Edit queued message',
  moreQueued: count => `+${count} more`,
  queueAction: 'Queue message',
  heldNotice: 'The turn ended early — these were not sent.',
  dismiss: 'Dismiss',
};

/** Mobile sanity: queued rows must not eat the viewport. */
const VISIBLE_QUEUED = 3;

/** Pastes at or above this length become a chip instead of flooding the box. */
const PASTE_CHIP_THRESHOLD = 400;

const TAG_ICON: Record<ContextRef['type'], typeof Bot> = {
  agent: Bot,
  team: Users,
  mission: Target,
  ask: AtSign,
  object: AtSign,
  briefing: AtSign,
  deal: AtSign,
  page: AtSign,
};

const SHORTCUTS: Array<[keys: string, what: string]> = [
  ['Enter', 'Send — or queue, while it is answering'],
  ['⌘ / Ctrl + Enter', 'Stop the turn and send now'],
  ['Esc', 'Stop the turn (empty box)'],
  ['Shift + Enter', 'New line'],
  ['@', 'Tag an agent, team or mission'],
  ['/search …', 'Search only — no model in the loop'],
  ['⌘ J', 'Open or collapse the conversation'],
  ['?', 'These shortcuts'],
];

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder,
  streaming = false,
  onStop,
  armed = false,
  pastedText,
  onPasteText,
  onClearPasted,
  tags = [],
  onRemoveTag,
  onAddTag,
  tagSearch,
  commandHint,
  queued = [],
  onQueue,
  onDropQueued,
  onEditQueued,
  onSendNow,
  queueHeld = false,
  onDismissHeld,
  copy,
}: ChatComposerProps) {
  const words = { ...DEFAULT_COPY, ...copy };
  const [queuedExpanded, setQueuedExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The `@query` under the caret, when the person is tagging.
  const tagMatch = tagSearch ? /(?:^|\s)@([\w-]*)$/.exec(value) : null;
  const tagQuery = tagMatch ? tagMatch[1] ?? '' : null;
  const [tagHits, setTagHits] = useState<ContextRef[]>([]);
  const [tagCursor, setTagCursor] = useState(0);

  // Auto-resize the textarea to fit content (24 → 220 px).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, Math.max(24, el.scrollHeight))}px`;
  }, [value]);

  // Resolve the tag query as it is typed.
  useEffect(() => {
    if (tagQuery === null || !tagSearch) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
      setTagHits([]);
      return;
    }
    let cancelled = false;
    tagSearch(tagQuery).then((hits) => {
      if (!cancelled) {
        setTagHits(hits.slice(0, 8));
        setTagCursor(0);
      }
    }).catch(() => {
      if (!cancelled) {
        setTagHits([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tagQuery, tagSearch]);

  const pickTag = (ref: ContextRef) => {
    onAddTag?.(ref);
    // Drop the `@query` the person typed; the chip carries it now.
    onChange(value.replace(/(^|\s)@[\w-]*$/, '$1').trimEnd());
    setTagHits([]);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (tagQuery !== null && tagHits.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setTagCursor(c => (c + 1) % tagHits.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setTagCursor(c => (c - 1 + tagHits.length) % tagHits.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickTag(tagHits[tagCursor]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setTagHits([]);
        return;
      }
    }
    if (e.key === '?' && value.trim().length === 0) {
      e.preventDefault();
      setShortcutsOpen(v => !v);
      return;
    }
    if (e.key === 'Escape' && shortcutsOpen) {
      setShortcutsOpen(false);
      return;
    }
    // Esc on an empty box stops the turn (Claude Code's gesture). With text in
    // the box Esc is left alone — people use it to dismiss things, and losing a
    // half-typed thought to a stray Esc is worse than one extra click on Stop.
    if (e.key === 'Escape' && streaming && value.trim().length === 0 && onStop) {
      e.preventDefault();
      onStop();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmedValue = value.trim();
      const hasSomething = trimmedValue.length > 0 || Boolean(pastedText) || armed;
      if (disabled || !hasSomething) {
        return;
      }
      // ⌘⏎ / Ctrl+⏎ jumps the running turn. Enter alone always queues — never
      // surprise somebody by killing a turn they wanted.
      if (streaming && (e.metaKey || e.ctrlKey) && onSendNow) {
        onSendNow(value);
        return;
      }
      if (streaming && onQueue) {
        onQueue(value);
        return;
      }
      onSubmit();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onPasteText) {
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (text.length >= PASTE_CHIP_THRESHOLD && !pastedText) {
      e.preventDefault();
      onPasteText(text);
    }
  };

  const trimmed = value.trim();
  // `disabled` now means only "there is nothing to send to yet" (pre-boot).
  // Streaming never disables anything — that is the whole point of this file.
  const sendEnabled = !disabled && (trimmed.length > 0 || Boolean(pastedText) || armed);
  const shownQueued = queuedExpanded ? queued : queued.slice(0, VISIBLE_QUEUED);
  const hiddenQueued = queued.length - shownQueued.length;
  const submitPrimary = () => {
    if (!sendEnabled) {
      return;
    }
    if (streaming && onQueue) {
      onQueue(value);
      return;
    }
    onSubmit();
  };

  return (
    <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background to-transparent px-3 pt-3 pb-3 sm:px-6 sm:pt-4">
      <div className="relative mx-auto max-w-3xl">
        {tagQuery !== null && tagHits.length > 0 && (
          <ul role="listbox" aria-label="Tag a record" className="absolute bottom-full left-0 z-20 mb-2 w-72 max-w-full rounded-xl border border-border bg-background p-1 text-sm shadow-(--shadow-pop)">
            {tagHits.map((h, i) => {
              const Icon = TAG_ICON[h.type];
              return (
                <li key={`${h.type}:${h.id}`} role="option" aria-selected={i === tagCursor}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickTag(h);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${i === tagCursor ? 'bg-muted' : 'hover:bg-muted/60'}`}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{h.label}</span>
                    <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{h.type}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {queued.length > 0 && (
          <ul data-testid="queued-list" aria-label={words.queuedLabel} className="mb-1.5 flex flex-col gap-1">
            {shownQueued.map(q => (
              <li key={q.id} data-testid="queued-row" className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface-soft px-2.5 py-1.5 text-xs">
                <CornerDownLeft className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  onClick={() => onEditQueued?.(q.id)}
                  aria-label={`${words.editQueued}: ${q.text.slice(0, 60)}`}
                  className="min-w-0 flex-1 truncate text-left text-muted-foreground transition-colors hover:text-foreground"
                >
                  {q.text}
                </button>
                <button
                  type="button"
                  onClick={() => onDropQueued?.(q.id)}
                  aria-label={`${words.removeQueued}: ${q.text.slice(0, 60)}`}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
            {hiddenQueued > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => setQueuedExpanded(true)}
                  className="w-full rounded-xl px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  {words.moreQueued(hiddenQueued)}
                </button>
              </li>
            )}
          </ul>
        )}
        {queueHeld && queued.length > 0 && (
          <div data-testid="queue-held" role="status" className="mb-1.5 flex items-center gap-2 rounded-xl border border-border bg-surface-soft px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1">{words.heldNotice}</span>
            <button
              type="button"
              onClick={() => onDismissHeld?.()}
              aria-label={words.dismiss}
              className="shrink-0 rounded p-0.5 transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
        {(pastedText || tags.length > 0 || commandHint) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => {
              const Icon = TAG_ICON[tag.type];
              return (
                <span key={`${tag.type}:${tag.id}`} data-testid="composer-tag" className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs">
                  <Icon className="size-3 text-muted-foreground" aria-hidden />
                  <span className="max-w-40 truncate">{tag.label}</span>
                  {onRemoveTag && (
                    <button type="button" onClick={() => onRemoveTag(tag)} aria-label={`Remove ${tag.label}`} className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
                      <X className="size-3" aria-hidden />
                    </button>
                  )}
                </span>
              );
            })}
            {commandHint && (
              <span data-testid="command-hint" className="inline-flex items-center gap-1.5 rounded-full border border-brand-amber/40 bg-brand-amber-tint px-2.5 py-1 text-xs font-medium text-brand-amber-deep">
                {commandHint}
              </span>
            )}
            {pastedText && (
              <span className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-1.5 text-xs">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">Pasted</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{pastedText.slice(0, 120)}</span>
                <button
                  type="button"
                  onClick={() => onClearPasted?.()}
                  aria-label="Remove pasted content"
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        )}
        <PopoverPrimitive.Root open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
          <PopoverPrimitive.Anchor asChild>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitPrimary();
              }}
              // Restrained focus: a 1px ring in the ring token at low alpha
              // plus a soft ground shift. No halo, no thickened border.
              className="flex items-end gap-1.5 rounded-2xl border border-border bg-background px-3 py-2 shadow-xs transition-colors focus-within:bg-surface-soft focus-within:ring-1 focus-within:ring-ring/40"
            >
              <textarea
                ref={textareaRef}
                data-agent-composer
                value={value}
                onChange={e => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={streaming ? words.streamingPlaceholder : (placeholder ?? 'Ask anything…')}
                rows={1}
                // Never `disabled`: the box stays live for the whole turn, so
                // Enter can queue and ⌘⏎ can jump the queue.
                // 16px on mobile: iOS Safari auto-zooms (and scroll-cuts) any focused
                // input under 16px. Compact 14px only from sm: up (no mobile zoom).
                className="flex-1 resize-none border-0 bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground/70 sm:text-sm"
                style={{ minHeight: 24, maxHeight: 220 }}
              />
              {tagSearch && (
                <PopoverPrimitive.Trigger
                  aria-label="Shortcuts"
                  className="hidden size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground sm:flex"
                >
                  <CircleHelp className="size-4" aria-hidden />
                </PopoverPrimitive.Trigger>
              )}
              {/*
                * One primary action, still (#345). While streaming with an
                * empty box it is Stop; the moment there is something to say it
                * becomes Queue and Stop steps back to a quiet ghost beside it,
                * because at that point the person's next move is their message,
                * not the interrupt.
                */}
              {streaming && (
                <button
                  type="button"
                  onClick={() => onStop?.()}
                  className={sendEnabled
                    ? 'flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground'
                    : 'flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-brand-amber hover:text-brand-amber-deep'}
                  aria-label="Stop generating"
                >
                  <Square className="size-3.5 fill-current" aria-hidden="true" />
                </button>
              )}
              {(!streaming || sendEnabled) && (
                <button
                  type="submit"
                  disabled={!sendEnabled}
                  className={streaming
                    ? 'flex size-9 shrink-0 items-center justify-center rounded-full border border-brand-amber/60 bg-brand-amber-tint text-brand-amber-deep transition-colors hover:border-brand-amber hover:bg-brand-amber hover:text-white disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground/50'
                    : 'flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-amber text-white transition-colors hover:bg-brand-amber-deep disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground/50'}
                  aria-label={streaming ? words.queueAction : 'Send message'}
                >
                  <ArrowUp className="size-[18px]" aria-hidden="true" />
                </button>
              )}
            </form>
          </PopoverPrimitive.Anchor>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              role="dialog"
              aria-label="Shortcuts"
              side="top"
              align="end"
              sideOffset={8}
              // Anchored on the composer and told how much room to keep, so
              // it never renders past the rail's right edge or off a phone.
              collisionPadding={8}
              // The caret stays in the box: `?` is typed there, and the sheet
              // is a reference, not a form.
              onOpenAutoFocus={e => e.preventDefault()}
              onCloseAutoFocus={e => e.preventDefault()}
              className="z-50 w-[min(17rem,calc(100vw-1rem))] rounded-xl border border-border bg-background p-2 text-xs shadow-(--shadow-pop) outline-none"
            >
              <div className="flex items-center justify-between px-1.5 pb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Shortcuts
                <PopoverPrimitive.Close aria-label="Close shortcuts" className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-surface-hover">
                  <X className="size-3" aria-hidden />
                </PopoverPrimitive.Close>
              </div>
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-3 px-1.5 py-1">
                  <span className="text-muted-foreground">{what}</span>
                  <kbd className="shrink-0 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">{keys}</kbd>
                </div>
              ))}
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>
    </div>
  );
}
