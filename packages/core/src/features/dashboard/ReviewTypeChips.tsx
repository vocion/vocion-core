'use client';

/**
 * The card-type chip row over the review queue.
 *
 * Driven by the types actually pending for this org, with counts from one
 * GROUP BY rather than from whatever the current page holds — with 557 pending
 * items against a window of 50 those are different numbers. Labels come from
 * each action's registered display name; the slug stays in the URL, so a
 * filtered queue is a link that can be sent to the person who should work it.
 */

export type ReviewType = { actionId: string; label: string; count: number };

/**
 * @param props
 * @param props.types - Types present, newest counts first.
 * @param props.active - The selected `actionId`, or null for All.
 * @param props.total - Pending items across every type.
 * @param props.onSelect - Called with the new selection.
 */
export function ReviewTypeChips({
  types,
  active,
  total,
  onSelect,
}: {
  types: ReviewType[];
  active: string | null;
  total: number;
  onSelect: (actionId: string | null) => void;
}) {
  // One type is no choice, and no types is an empty queue.
  if (types.length < 2) {
    return null;
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5" data-testid="review-type-chips">
      <Chip label="All" count={total} selected={active === null} onClick={() => onSelect(null)} />
      {types.map(t => (
        <Chip
          key={t.actionId}
          label={t.label}
          count={t.count}
          slug={t.actionId}
          selected={active === t.actionId}
          onClick={() => onSelect(active === t.actionId ? null : t.actionId)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  count,
  slug,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  slug?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={slug}
      aria-pressed={selected}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        selected
          ? 'border-brand-amber bg-brand-amber-tint text-brand-amber-deep'
          : 'border-border text-muted-foreground hover:border-brand-amber/40 hover:text-foreground'
      }`}
    >
      {label}
      <span className="font-mono text-[11px] opacity-70">{count}</span>
    </button>
  );
}
