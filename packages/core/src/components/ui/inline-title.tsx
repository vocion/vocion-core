'use client';

import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/utils/Helpers';

type InlineTitleProps = {
  /** The current name. */
  value: string;
  /** Called with the new, whitespace-collapsed name when it changed. */
  onRename: (next: string) => void;
  /** Accessible name of the resting button, and its tooltip ("Rename conversation"). */
  label: string;
  /** Accessible name of the field ("Conversation title"). */
  inputLabel: string;
  /** Classes for the name, resting and editing (size, weight, width). */
  className?: string;
  /** `data-testid` on the resting button; the field gets `<testId>-input`. */
  testId?: string;
  /** The longest name the field accepts. */
  maxLength?: number;
  /**
   * Controlled: whether the field is open. For a row whose name is a link —
   * clicking the name must navigate, so a separate control opens the field.
   */
  editing?: boolean;
  /** Controlled: told when the field opens or closes. */
  onEditingChange?: (editing: boolean) => void;
};

/**
 * A name you can click to change, in place — the chat page's header, the
 * rail's header and a row of the Conversations list all rename a thread with
 * this, so a thread is renamed the same way wherever its name is read
 * (principle 6).
 *
 * Click the name and it becomes a field holding the current name, selected.
 * Enter or leaving the field saves; Escape puts the old name back. An empty
 * or unchanged value saves nothing.
 * @param props - See {@link InlineTitleProps}.
 */
export function InlineTitle(props: InlineTitleProps) {
  const [own, setOwn] = useState(false);
  const editing = props.editing ?? own;
  const setEditing = (next: boolean) => {
    setOwn(next);
    props.onEditingChange?.(next);
  };

  if (editing) {
    return (
      <TitleField
        initial={props.value}
        inputLabel={props.inputLabel}
        className={props.className}
        testId={props.testId ? `${props.testId}-input` : undefined}
        maxLength={props.maxLength ?? 120}
        onDone={(next) => {
          setEditing(false);
          if (next !== null && next !== props.value) {
            props.onRename(next);
          }
        }}
      />
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`${props.label}: ${props.value}`}
          data-testid={props.testId}
          className={cn('group flex min-w-0 items-center gap-1 rounded-md text-left text-foreground', props.className)}
        >
          <span className="truncate">{props.value}</span>
          <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" collisionPadding={8}>{props.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The open field. Mounted fresh for each edit, so it always starts from the
 * current name; focused by an effect rather than `autoFocus`, which would
 * steal focus on mount for everyone, screen-reader users included.
 * @param props
 * @param props.initial - The name the edit starts from.
 * @param props.onDone - The new name, or null for "cancelled / nothing to save".
 * @param props.inputLabel
 * @param props.className
 * @param props.testId
 * @param props.maxLength
 */
function TitleField({ initial, onDone, inputLabel, className, testId, maxLength }: {
  initial: string;
  onDone: (next: string | null) => void;
  inputLabel: string;
  className?: string;
  testId?: string;
  maxLength: number;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // Enter saves and the field then unmounts, which blurs it; without this the
  // blur would save a second time.
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (settled.current) {
      return;
    }
    settled.current = true;
    const next = draft.split(/\s+/).filter(Boolean).join(' ');
    onDone(save && next ? next : null);
  };

  return (
    <input
      ref={ref}
      value={draft}
      maxLength={maxLength}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          // Escape here cancels the rename, and must not also close the
          // sheet or panel the field sits in.
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
      aria-label={inputLabel}
      data-testid={testId}
      className={cn('h-7 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-foreground focus:ring-1 focus:ring-ring/40 focus:outline-none', className)}
    />
  );
}
