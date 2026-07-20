'use client';

/**
 * Empty state — "insert quarter, shoot aliens".
 *
 * The chat home: a small org eyebrow, one greeting headline that asks about
 * the WORKSPACE ("Ask Metacto Revenue" — never a named agent), and a couple
 * of tappable chips. No glyphs, no product copy, no instructional labels —
 * the composer below is the whole invitation. Chips fire `onPick(prompt)`
 * which the parent shell auto-sends.
 */

export type EmptyStateSuggestion = {
  label: string;
  prompt: string;
};

export type EmptyStateProps = {
  /** Org eyebrow + the workspace name the headline asks about. */
  greeting?: { eyebrow?: string; workspace: string };
  suggestions?: EmptyStateSuggestion[];
  onPick: (prompt: string) => void;
};

export function EmptyState({ greeting, suggestions = [], onPick }: EmptyStateProps) {
  const workspace = greeting?.workspace ?? 'your workspace';

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center sm:px-6">
      {greeting?.eyebrow && (
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {greeting.eyebrow}
        </p>
      )}

      <h2 className="font-display text-2xl font-light tracking-tight sm:text-3xl">
        Ask
        {' '}
        <span className="text-brand-amber-deep">{workspace}</span>
      </h2>

      {suggestions.length > 0 && (
        <div className="mt-8 flex w-full max-w-md flex-wrap items-center justify-center gap-2">
          {suggestions.slice(0, 4).map(s => (
            <button
              key={s.prompt}
              type="button"
              onClick={() => onPick(s.prompt)}
              className="min-h-11 rounded-full border border-border bg-background px-4 py-2 text-sm text-muted-foreground transition hover:border-brand-amber hover:bg-brand-amber-tint hover:text-brand-amber-deep"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
