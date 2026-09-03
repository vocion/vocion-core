'use client';

import { useState } from 'react';

/**
 * User message bubble (Phase C).
 *
 * Right-aligned soft-bordered bubble, preserved whitespace. No avatar,
 * no "You" label — right alignment IS the identity ("insert quarter,
 * shoot aliens": the transcript needs no decoration to be read).
 *
 * Long content — a message that carried pasted material — clamps to a
 * readable height with its own expand, so the instruction stays the thing
 * the transcript shows (032 §2.1 rule 5).
 */

export type UserMessageProps = {
  content: string;
};

/** Messages longer than this clamp behind a Show more control. */
const CLAMP_THRESHOLD = 600;

export function UserMessage({ content }: UserMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const long = content.length > CLAMP_THRESHOLD;
  return (
    <div className="flex justify-end">
      <div className="max-w-2xl rounded-2xl border border-border bg-muted/40 px-4 py-2 text-left text-sm whitespace-pre-wrap">
        {long && !expanded ? `${content.slice(0, CLAMP_THRESHOLD)}…` : content}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="mt-1 block text-xs font-medium text-muted-foreground underline underline-offset-2 transition hover:text-foreground"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}
