'use client';

/**
 * Editing a markdown artifact in place: a plain textarea, ⌘S to save.
 *
 * Plain on purpose. A code editor here would be a second thing to learn for
 * content that is mostly prose, and a person who wants one already has their
 * own. Every save is a version; a burst inside 30s folds into one
 * (ArtifactService.COLLAPSE_WINDOW_MS), so holding ⌘S does not shred the
 * history.
 */

import { useEffect, useRef } from 'react';

export function MarkdownArtifactEditor({ value, onChange, onSave, onCancel, disabled, label, hint }: {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
  /** What the textarea holds, for assistive tech. Default: the markdown body. */
  label?: string;
  /** The one-line footer. Default names ⌘S and Esc. */
  hint?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            onSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        spellCheck
        className="min-h-64 flex-1 resize-none rounded-lg border border-border bg-background p-3 font-mono text-[13px] leading-6 text-foreground focus:border-foreground/30 focus:outline-none"
        aria-label={label ?? 'Artifact body (markdown)'}
      />
      <p className="text-[11px] text-muted-foreground">
        {hint ?? '⌘S saves a new version · Esc discards'}
      </p>
    </div>
  );
}
