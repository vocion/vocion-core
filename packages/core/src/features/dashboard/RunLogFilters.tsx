'use client';

import { X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * The run log's filter row.
 *
 * Every control writes to the URL, so the filtered view is shareable and
 * survives a reload. The automation list comes from the runs actually
 * recorded, never a hardcoded list — a newly authored automation appears here
 * the first time it runs.
 * @param props
 * @param props.facets - Values present in the log.
 * @param props.facets.slugs
 * @param props.facets.statuses
 * @param props.facets.kinds
 * @param props.basePath - Where to navigate on change.
 * @param props.pinnedSlug - Set on a per-automation view, which drops the automation control.
 */
export function RunLogFilters({
  facets,
  basePath,
  pinnedSlug,
}: {
  facets: { slugs: string[]; statuses: string[]; kinds: string[] };
  basePath: string;
  pinnedSlug?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === '') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // A new filter means a new first page.
    next.delete('cursor');
    const qs = next.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  const active = ['slug', 'status', 'kind', 'invokedBy', 'since'].filter(k => params.get(k) && k !== (pinnedSlug ? 'slug' : ''));
  const select = 'rounded-md border border-input bg-background px-2 py-1 text-xs';

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {!pinnedSlug && (
        <Field label="Automation">
          <select className={select} value={params.get('slug') ?? ''} onChange={e => set('slug', e.target.value)}>
            <option value="">all</option>
            {facets.slugs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      )}
      <Field label="Status">
        <select className={select} value={params.get('status') ?? ''} onChange={e => set('status', e.target.value)}>
          <option value="">any</option>
          {facets.statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Kind">
        <select className={select} value={params.get('kind') ?? ''} onChange={e => set('kind', e.target.value)}>
          <option value="">any</option>
          {facets.kinds.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Invoked by">
        <select className={select} value={params.get('invokedBy') ?? ''} onChange={e => set('invokedBy', e.target.value)}>
          <option value="">any</option>
          <option value="schedule">schedule</option>
          <option value="test-run">test run</option>
        </select>
      </Field>
      <Field label="Since (UTC)">
        <input
          type="date"
          className={select}
          value={params.get('since') ?? ''}
          onChange={e => set('since', e.target.value)}
        />
      </Field>
      {active.length > 0 && (
        <button
          type="button"
          onClick={() => router.push(basePath)}
          className="inline-flex items-center gap-1 pb-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
          Clear
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </label>
  );
}
