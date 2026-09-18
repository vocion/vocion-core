'use client';

import type { LucideIcon } from 'lucide-react';

export type SelectionToolbarAction = { label: string; icon: LucideIcon; onClick: () => void };

/**
 * The floating control over a highlighted passage — one shape wherever text
 * can be selected and talked about: the rendered document (`DocumentFrame`,
 * through its iframe bridge) and the transcript itself (`useSelectionReply`
 * in `MessageList`). Positioned by the caller in its own container's
 * coordinates; clamped so it never leaves the container's width.
 * @param props
 * @param props.x - Horizontal centre, container px.
 * @param props.y - Top of the selection, container px; the bar sits above it.
 * @param props.width - The container's width, for clamping.
 * @param props.actions - The verbs, left to right.
 * @param props.testId
 */
export function SelectionToolbar({ x, y, width, actions, testId }: { x: number; y: number; width: number; actions: SelectionToolbarAction[]; testId?: string }) {
  return (
    <div
      role="toolbar"
      aria-label="Selected passage"
      className="absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border border-border bg-background p-0.5 shadow-md"
      style={{ left: Math.max(60, Math.min(x, width - 60)), top: Math.max(28, y - 6) }}
      data-selection-toolbar={testId ?? true}
    >
      {actions.map(a => (
        <button
          key={a.label}
          type="button"
          // mousedown, not click: a click lands after the browser has already
          // collapsed the selection on mousedown, and the passage is gone.
          onMouseDown={(e) => {
            e.preventDefault();
            a.onClick();
          }}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-muted"
        >
          <a.icon className="size-3.5" aria-hidden />
          {a.label}
        </button>
      ))}
    </div>
  );
}
