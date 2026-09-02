/**
 * The shell every Add-source form sits in: pinned header, scrolling fields,
 * pinned footer carrying the error, the "still needed" line and the buttons.
 *
 * Extracted from SourcesPanel so the bulk-import form can sit in the same
 * chrome without importing back into the panel that renders it.
 */

import { CircleAlert, Loader2 } from 'lucide-react';

/** Shared input styling, so every source form's fields look like one form. */
export const FIELD_CLASS = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

export function AddSourceDialogFrame({
  title,
  error,
  requirement,
  tabs,
  notice,
  submitLabel,
  submitting,
  canSubmit,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  error: string | null;
  requirement: string | null;
  /** Optional tab switcher pinned above the fields (one-at-a-time vs. import). */
  tabs?: React.ReactNode;
  /** A standing note about what saving will do, shown above the fields. */
  notice: string | null;
  /** Wording for the submit button — "Add source" when adding, "Save changes" when editing. */
  submitLabel: string;
  submitting: boolean;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      {/* Header and footer are pinned and only the fields scroll, so a validation
          error — which lands in the footer, next to the button that triggered it —
          is visible wherever the operator has scrolled to. */}
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border bg-background shadow-xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="font-display text-lg">{title}</h3>
          </div>
          {tabs ? <div className="border-b px-4 py-2">{tabs}</div> : null}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {notice
              ? (
                  <p className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {notice}
                  </p>
                )
              : null}
            {children}
          </div>
          <div className="border-t px-4 py-3">
            {error
              ? (
                  <div
                    role="alert"
                    className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </div>
                )
              : null}
            <div className="flex items-center justify-between gap-3">
              {/* What is still missing, said out loud rather than left for the
                  operator to infer from a greyed-out button. */}
              {requirement
                ? (
                    <p className="flex items-start gap-1.5 text-sm text-destructive">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      {`Still needed: ${requirement}`}
                    </p>
                  )
                : <span />}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                {/* The title rides the wrapper, not the button: a disabled button
                    swallows its own hover events, so its tooltip never opens. */}
                <span title={canSubmit ? undefined : (requirement ?? undefined)}>
                  <button
                    type="submit"
                    disabled={submitting || !canSubmit}
                    className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                  >
                    {submitting
                      ? (
                          <>
                            <Loader2 className="size-3 animate-spin" />
                            Saving…
                          </>
                        )
                      : submitLabel}
                  </button>
                </span>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
