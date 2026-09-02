'use client';

/**
 * User message bubble (Phase C).
 *
 * Right-aligned soft-bordered bubble, preserved whitespace. No avatar,
 * no "You" label — right alignment IS the identity ("insert quarter,
 * shoot aliens": the transcript needs no decoration to be read).
 */

export type UserMessageProps = {
  content: string;
};

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-2xl rounded-2xl border border-border bg-muted/40 px-4 py-2 text-left text-sm whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}
