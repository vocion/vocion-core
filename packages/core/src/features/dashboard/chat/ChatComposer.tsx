'use client';

import type { QueuedMessage } from './queueReducer';
import type { SlashCommand, SlashCommandAction } from './slashCommands';
import type { ChatAttachment, ContextRef } from './types';
import { ArrowUp, AtSign, Bot, CircleHelp, CornerDownLeft, FileText, Loader2, Paperclip, PencilLine, Plus, Slash, Square, Target, Users, X } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { DELIVERABLE_REF_TYPE } from '@/libs/chat/deliverable';
import { insertTagAt, INTENT_REF_TYPE, tagSlug } from './composerTags';
import { matchSlashCommands, parseSlashCommand, slashQuery } from './slashCommands';

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
 * Three quiet affordances ride along (agent-chat-surface.md §9):
 *   `@` tags a record (agent, team, mission, the page) the message is about,
 *       or `@artifact` to say the turn owes a document — a chip beside the
 *       box, sent as `context_refs`, never inlined in the text;
 *   `(+)` at the left of the box is the POINTER path to that same list: it
 *       types the tag into the draft at the caret and the `@` reader above
 *       resolves it. No second mechanism, no hidden state (Manifesto §19).
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
 * Everything stacked above the box — queued rows, tag chips, the pasted-text
 * chip, and whatever the surface passes as `above` (the "About: …" context
 * chip, anchored-comment chips) — lives in ONE column with the input, so
 * there is a single left edge to align to rather than a padding decision per
 * child (2026-09-16).
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
  /** Runs a slash command the surface owns (`/new`, `/history`); absent, a slash is text. */
  onCommand?: (action: SlashCommandAction) => void;
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
  /**
   * What this surface can pull into the turn explicitly — `@artifact`, the
   * page, the record in view. Drives the `(+)` menu; the same list is the head
   * of `tagSearch`'s pool. Empty/absent = no `(+)`, which is how a bare test
   * render behaves.
   */
  attachable?: ContextRef[];
  /**
   * Anything the SURFACE stacks above the box — the "About: …" context chip,
   * the anchored-comment chips. It renders inside the composer's own column,
   * so one padding rule governs everything above the input instead of each
   * caller guessing at it (CEO, 2026-09-16: the chip sat flush against the
   * rail edge while the box was inset).
   */
  above?: React.ReactNode;
  /**
   * The surface's per-conversation controls, hosted in the bar beside (+):
   * model strength and thinking (`ModelControl`), and — once it moves out of
   * the header — autonomy. One cluster, every surface.
   */
  controls?: React.ReactNode;
  /** Files attached to the next message — already uploaded; these are the chips. */
  attachments?: ChatAttachment[];
  /** An upload is in flight: a spinner chip, and Send waits for it. */
  uploading?: boolean;
  /** Why the last attach did not fully land — a line above the box. */
  attachError?: string | null;
  onDismissAttachError?: () => void;
  /** The person picked, dropped or pasted files. Absent = the paperclip is off. */
  onAttachFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: number) => void;
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
  /** aria-label and header for the `(+)` menu. */
  attach: string;
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
  attach: 'Add to this turn',
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
  deliverable: FileText,
  intent: PencilLine,
};

const SHORTCUTS: Array<[keys: string, what: string]> = [
  ['Enter', 'Send — or queue, while it is answering'],
  ['⌘ / Ctrl + Enter', 'Stop the turn and send now'],
  ['Esc', 'Stop the turn (empty box)'],
  ['Shift + Enter', 'New line'],
  ['@', 'Tag an agent, team, mission or the page'],
  ['Drop · paste · 📎', 'Attach an image, PDF or text file'],
  ['@artifact', 'This turn ends in a document'],
  ['@change', 'This ask changes the draft in view'],
  ['/search …', 'Search only — no model in the loop'],
  ['/new · /history', 'Start over · every conversation'],
  ['⌘ ⇧ O', 'New chat'],
  ['⌘ ⇧ L', 'Go to chat'],
  ['⌘ ⇧ H', 'All conversations'],
  ['⌘ J', 'Open or collapse the conversation'],
  ['?', 'These shortcuts'],
];

/**
 * The right-hand hint on a tag suggestion: what picking it will do.
 *
 * The intent tags are instructions rather than references — `@artifact` arms
 * the deliverable contract, `@change` says the turn edits the open draft — and
 * the raw ref type ("DELIVERABLE", "INTENT") named the mechanism instead of
 * the effect. A record tag says what kind of record it is, which is the useful
 * thing there.
 * @param ref - The suggestion.
 */
function tagHint(ref: ContextRef): string {
  if (ref.type === DELIVERABLE_REF_TYPE) {
    return 'produce a document';
  }
  if (ref.type === INTENT_REF_TYPE) {
    return 'edit the open draft';
  }
  if (ref.type === 'page') {
    return 'this page';
  }
  return ref.type.replace(/[_-]+/g, ' ');
}

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
  onCommand,
  queued = [],
  onQueue,
  onDropQueued,
  onEditQueued,
  onSendNow,
  queueHeld = false,
  onDismissHeld,
  copy,
  attachable = [],
  above,
  controls,
  attachments = [],
  uploading = false,
  attachError,
  onDismissAttachError,
  onAttachFiles,
  onRemoveAttachment,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // A drag over the box highlights it; dropping attaches. `dragging` is a
  // counter, not a flag, because enter/leave fire for every child crossed.
  const [dragDepth, setDragDepth] = useState(0);
  const canAttach = Boolean(onAttachFiles);
  const takeFiles = (list: FileList | File[] | null | undefined) => {
    const files = Array.from(list ?? []).filter(f => f.size > 0);
    if (files.length > 0 && onAttachFiles) {
      onAttachFiles(files);
    }
  };
  const words = { ...DEFAULT_COPY, ...copy };
  const [queuedExpanded, setQueuedExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  // Where the caret is, so a mention typed (or injected by `(+)`) in the
  // MIDDLE of a draft reads the same as one at the end. `null` = "wherever the
  // end is", which is what a fresh render and every non-interactive host see.
  const [caret, setCaret] = useState<number | null>(null);
  // Set when this component moves the caret itself; applied once the parent
  // has echoed the new value back down.
  const pendingCaretRef = useRef<number | null>(null);
  const caretAt = Math.max(0, Math.min(caret ?? value.length, value.length));
  const head = value.slice(0, caretAt);
  const tail = value.slice(caretAt);
  // The `@query` under the caret, when the person is tagging.
  const tagMatch = tagSearch ? /(?:^|\s)@([\w-]*)$/.exec(head) : null;
  const tagQuery = tagMatch ? tagMatch[1] ?? '' : null;
  const [tagHits, setTagHits] = useState<ContextRef[]>([]);
  const [tagCursor, setTagCursor] = useState(0);
  // `/` alone at the start of the draft opens the command menu (`slashCommands.ts`).
  const slashQ = onCommand ? slashQuery(value) : null;
  const slashHits = slashQ !== null ? matchSlashCommands(slashQ) : [];
  const [slashCursorRaw, setSlashCursor] = useState(0);
  const slashCursor = Math.min(slashCursorRaw, Math.max(0, slashHits.length - 1));
  const pickSlash = (cmd: SlashCommand) => {
    if (cmd.takesArgument) {
      // `/search` wants words after it: type the command, leave the caret after the space.
      const next = `/${cmd.name} `;
      pendingCaretRef.current = next.length;
      onChange(next);
      textareaRef.current?.focus();
      return;
    }
    onChange('');
    onCommand?.(cmd.action);
  };

  // Auto-resize the textarea to fit content (24 → 220 px).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, Math.max(24, el.scrollHeight))}px`;
    // A caret this component asked for lands only once the parent has echoed
    // the value back — controlled inputs reset the selection on re-render.
    const next = pendingCaretRef.current;
    if (next !== null) {
      pendingCaretRef.current = null;
      el.setSelectionRange(next, next);
    }
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

  /**
   * Move the caret ourselves — remembered until the parent echoes the value back.
   * @param to
   */
  const moveCaret = (to: number) => {
    pendingCaretRef.current = to;
    setCaret(to);
  };

  const pickTag = (ref: ContextRef) => {
    onAddTag?.(ref);
    // Drop the `@query` the person typed; the chip carries it now. Only the
    // text BEFORE the caret is rewritten — anything after it is untouched.
    const nextHead = head.replace(/(^|\s)@[\w-]*$/, '$1').trimEnd();
    moveCaret(nextHead.length);
    onChange(nextHead + tail);
    setTagHits([]);
    textareaRef.current?.focus();
  };

  /**
   * The `(+)` menu's only job: type the tag into the draft at the caret. The
   * `@` reader above then sees it and offers the same chip it would have
   * offered had the person typed it — one mechanism, two ways in.
   * @param ref
   */
  const insertTag = (ref: ContextRef) => {
    // The caret is read off the element, not off state: clicking `(+)` blurs
    // the box, and a browser keeps the selection through a blur while React's
    // `onSelect` has nothing left to fire.
    const next = insertTagAt(value, textareaRef.current?.selectionStart ?? caretAt, tagSlug(ref));
    moveCaret(next.caret);
    onChange(next.value);
    setAttachOpen(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashQ !== null && slashHits.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashCursor((slashCursor + 1) % slashHits.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashCursor((slashCursor - 1 + slashHits.length) % slashHits.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickSlash(slashHits[slashCursor]!);
        return;
      }
    }
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
      // A command the surface owns never reaches the model.
      const command = onCommand ? parseSlashCommand(value) : null;
      if (command) {
        onChange('');
        onCommand!(command.action);
        return;
      }
      const trimmedValue = value.trim();
      const hasSomething = trimmedValue.length > 0 || Boolean(pastedText) || armed || attachments.length > 0;
      if (disabled || !hasSomething || uploading) {
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
    // A pasted screenshot is a file, not text: it becomes an attachment.
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length > 0 && canAttach) {
      e.preventDefault();
      takeFiles(files);
      return;
    }
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
  const sendEnabled = !disabled && !uploading && (trimmed.length > 0 || Boolean(pastedText) || armed || attachments.length > 0);
  const shownQueued = queuedExpanded ? queued : queued.slice(0, VISIBLE_QUEUED);
  const hiddenQueued = queued.length - shownQueued.length;
  const submitPrimary = () => {
    if (!sendEnabled) {
      return;
    }
    const command = onCommand ? parseSlashCommand(value) : null;
    if (command) {
      onChange('');
      onCommand!(command.action);
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
        {/* The surface's own stack — same column, same left edge as the box. */}
        {above}
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
                    {/* What picking it DOES, not what it is called internally.
                        This printed the raw ref type, so the artifact tag
                        offered itself as "DELIVERABLE" — a word from the
                        contract, not from the person's problem. */}
                    <span className="shrink-0 text-[11px] text-muted-foreground">{tagHint(h)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {slashQ !== null && slashHits.length > 0 && (
          <ul role="listbox" aria-label="Commands" data-testid="slash-menu" className="absolute bottom-full left-0 z-20 mb-2 w-72 max-w-full rounded-xl border border-border bg-background p-1 text-sm shadow-(--shadow-pop)">
            {slashHits.map((c, i) => (
              <li key={c.name} role="option" aria-selected={i === slashCursor}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSlash(c);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${i === slashCursor ? 'bg-muted' : 'hover:bg-muted/60'}`}
                >
                  <Slash className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{`/${c.name}`}</span>
                    <span className="ml-2 text-muted-foreground">{c.hint}</span>
                  </span>
                  {c.shortcut && <span className="shrink-0 text-[11px] tracking-widest text-muted-foreground">{c.shortcut}</span>}
                </button>
              </li>
            ))}
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
        {attachError && (
          <div data-testid="attach-error" role="status" className="mb-1.5 flex items-center gap-2 rounded-xl border border-[var(--brand-fail)]/30 bg-[var(--brand-fail-bg)]/30 px-2.5 py-1.5 text-[11px] text-foreground/85">
            <span className="min-w-0 flex-1">{attachError}</span>
            <button type="button" onClick={() => onDismissAttachError?.()} aria-label={words.dismiss} className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
        {(pastedText || tags.length > 0 || commandHint || attachments.length > 0 || uploading) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {/* The files, as chips — an image shows itself, a document its name
                and size. Each ✕ drops the chip; the artifact row stays (it is
                the person's file, in their artifacts list). */}
            {attachments.map(a => (
              <span key={a.id} data-testid="composer-attachment" className="inline-flex max-w-72 items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-0.5 pr-1 pl-1.5 text-xs">
                {a.kind === 'image'
                  ? <img src={a.url} alt="" className="size-6 rounded object-cover" />
                  : <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="truncate">{a.title}</span>
                {onRemoveAttachment && (
                  <button type="button" onClick={() => onRemoveAttachment(a.id)} aria-label={`Remove ${a.title}`} className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </span>
            ))}
            {uploading && (
              <span data-testid="composer-uploading" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Uploading…
              </span>
            )}
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
              // Dropping a file onto the box attaches it. The counter survives
              // the enter/leave pairs every child element fires.
              onDragEnter={(e) => {
                if (canAttach && e.dataTransfer.types.includes('Files')) {
                  e.preventDefault();
                  setDragDepth(d => d + 1);
                }
              }}
              onDragOver={(e) => {
                if (canAttach && e.dataTransfer.types.includes('Files')) {
                  e.preventDefault();
                }
              }}
              onDragLeave={() => setDragDepth(d => Math.max(0, d - 1))}
              onDrop={(e) => {
                if (!canAttach) {
                  return;
                }
                e.preventDefault();
                setDragDepth(0);
                takeFiles(e.dataTransfer.files);
              }}
              data-dragging={dragDepth > 0 || undefined}
              // Restrained focus: a 1px ring in the ring token at low alpha
              // plus a soft ground shift. No halo, no thickened border.
              className="flex items-end gap-1.5 rounded-2xl border border-border bg-background px-3 py-2 shadow-xs transition-colors focus-within:bg-surface-soft focus-within:ring-1 focus-within:ring-ring/40 data-[dragging]:border-brand-amber/60 data-[dragging]:bg-brand-amber-tint"
            >
              {/* 📎 — the pointer path to a file; drop and paste are the others. */}
              {canAttach && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    // Out of the accessibility tree: the paperclip is the control, and
                    // a role query for the composer's textbox must find one element.
                    aria-hidden
                    tabIndex={-1}
                    accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json,text/html,.md,.csv,.txt,.json"
                    className="hidden"
                    data-testid="composer-file-input"
                    onChange={(e) => {
                      takeFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    data-testid="composer-attach-file"
                    aria-label="Attach a file"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    <Paperclip className="size-4" aria-hidden />
                  </button>
                </>
              )}
              {/*
                * (+) — "what can I bring into this turn". It inserts a tag and
                * nothing else: no store, no event, no flag of its own. What
                * the person ends up with is the chip they would have got by
                * typing `@`. Same 32px round target and muted tone as the help
                * mark on the other end of the box.
                */}
              {attachable.length > 0 && (
                <PopoverPrimitive.Root open={attachOpen} onOpenChange={setAttachOpen}>
                  <PopoverPrimitive.Trigger
                    data-testid="composer-attach"
                    aria-label={words.attach}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground"
                  >
                    <Plus className="size-4" aria-hidden />
                  </PopoverPrimitive.Trigger>
                  <PopoverPrimitive.Portal>
                    <PopoverPrimitive.Content
                      side="top"
                      align="start"
                      sideOffset={8}
                      collisionPadding={8}
                      onOpenAutoFocus={e => e.preventDefault()}
                      className="z-50 w-[min(16rem,calc(100vw-1rem))] rounded-xl border border-border bg-background p-1 text-sm shadow-(--shadow-pop) outline-none"
                    >
                      <div className="px-1.5 pb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{words.attach}</div>
                      <ul role="menu" aria-label={words.attach}>
                        {attachable.map((ref) => {
                          const Icon = TAG_ICON[ref.type];
                          return (
                            <li key={`${ref.type}:${ref.id}`} role="none">
                              <button
                                type="button"
                                role="menuitem"
                                data-testid="composer-attach-item"
                                onClick={() => insertTag(ref)}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                              >
                                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                <span className="min-w-0 flex-1 truncate">{ref.label}</span>
                                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{`@${tagSlug(ref)}`}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </PopoverPrimitive.Content>
                  </PopoverPrimitive.Portal>
                </PopoverPrimitive.Root>
              )}
              {controls}
              <textarea
                ref={textareaRef}
                data-agent-composer
                value={value}
                onChange={(e) => {
                  setCaret(e.target.selectionStart);
                  onChange(e.target.value);
                }}
                // Every caret move, however it happened (arrows, a click, a
                // drag). Cheap: the box already re-renders on every keystroke.
                onSelect={e => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
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
