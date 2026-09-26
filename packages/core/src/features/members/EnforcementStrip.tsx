'use client';

import { useState } from 'react';

/**
 * "Not in force", on one line.
 *
 * The screen has to say whether what it shows is being applied, or it reads as
 * a description of who reaches what when in fact everyone still reaches
 * everything. It does NOT have to say it in a block taller than the content it
 * warns about: that version pushed the table below the fold on every load,
 * which trains people to scroll past the one thing on the page that is a
 * caveat (decision Q2, 25 Sep 2026).
 *
 * One line, the detail behind a disclosure. Amber is `StatusPill`'s amber, so
 * the caveat reads as the same system as every other warm state and carries
 * its own foreground in both themes.
 */
export function EnforcementStrip() {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid="enforcement-strip"
      className="mt-3 rounded-md border border-[var(--brand-borderline)]/30 bg-[var(--brand-borderline-bg)] px-3 py-2 text-[13px] text-[var(--brand-borderline)]"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
        <span className="font-medium">Not in force.</span>
        <span className="opacity-80">Everyone still reaches every workspace.</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          className="ml-auto shrink-0 underline underline-offset-2 opacity-80 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {open ? 'Hide' : 'What changes'}
        </button>
      </div>
      {open && (
        <p className="mt-2 opacity-80">
          What you set here is recorded and takes effect when
          {' '}
          <code className="rounded bg-[var(--brand-borderline)]/12 px-1 py-0.5 text-xs">VOCION_ENFORCE_WORKSPACE_ACCESS=1</code>
          {' '}
          is set on the deployment. Until then this page describes what access
          would be, not what it is.
        </p>
      )}
    </div>
  );
}
