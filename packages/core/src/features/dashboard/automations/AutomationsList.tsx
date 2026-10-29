'use client';

import type { Chip } from '@/components/patterns';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChipRow, ListEmpty, ListRow, ListRows, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/libs/Orpc';

/** One automation as its row draws it, already in words on the server. */
export type AutomationListRow = {
  slug: string;
  name: string;
  /** The app that installed it, by name ("Search Engine Optimization", "This workspace"). */
  app: string;
  /** That app's id, or `workspace` — what the filter matches. */
  appKey: string;
  /** Plumbing (`visibility: system`), drawn only when a person asked to see it. */
  system: boolean;
  /** "Every 5 minutes (UTC)", "On run failed". */
  trigger: string;
  /** The seat that owns it, by name. */
  owner: string | null;
  /** "Ran 3 min ago", "Errored 2 h ago", "Never ran". */
  last: string;
  /** The last fire failed. */
  lastFailed: boolean;
  /** `on` runs; `paused` is a person's hold; `off` is authored off in the workspace. */
  state: 'on' | 'paused' | 'off';
  /** Who paused it, since when, and why — in words. */
  pause: { byName: string; when: string; note: string | null } | null;
};

/**
 * The register's filter: one chip per app with rows, All first, and — for an
 * admin — the switch that shows the system automations. Each move rewrites the
 * page's URL (`?app=`, `?system=1`), so a filtered register is a link an app's
 * panel can hand out.
 */
export type AutomationsFilter = {
  apps: { key: string; label: string; count: number }[];
  /** The app filtered to, or `''` for All. */
  selected: string;
  /** System automations left out (zero when shown). */
  systemHidden: number;
  /** The viewer may reveal them (an admin). */
  canShowSystem: boolean;
  showSystem: boolean;
};

/**
 * THE AUTOMATIONS REGISTER — one per workspace (Chris, 2026-10-01: "Put all
 * those automations on an Automations page with toggle switches … Leave most
 * off"; 2026-10-29: one register, visible everywhere, filtered by app).
 *
 * One row per automation in the one `ListRow`, each naming the app that
 * installed it. The page draws every row with the app filter above them; an
 * app's "How it is doing" panel draws the same rows narrowed to that app
 * (`showApp={false}`, its heading already says which). The switch pauses or
 * resumes through the same routes the automation's own page uses, so who
 * switched it and when is on the record; the toast says what it did and offers
 * Undo. A paused row says who paused it, since when and why on its chip's
 * tooltip. An automation its workspace file turns off is drawn off and cannot
 * be switched here: the file is the record.
 * @param props
 * @param props.rows - The rows, in order.
 * @param props.filter - The app filter, on the register page only.
 * @param props.showApp - Name each row's app (off inside an app's own panel).
 */
export function AutomationsList({ rows, filter, showApp = true }: { rows: AutomationListRow[]; filter?: AutomationsFilter; showApp?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // What a switch says while the page re-reads: the person's move, at once.
  const [moved, setMoved] = useState<Record<string, boolean>>({});

  // The filter lives in the URL: a chip or the system switch rewrites it and the page re-reads.
  const go = (patch: { app?: string; system?: boolean }): void => {
    const params = new URLSearchParams(window.location.search);
    if (patch.app !== undefined) {
      if (patch.app) {
        params.set('app', patch.app);
      } else {
        params.delete('app');
      }
    }
    if (patch.system !== undefined) {
      if (patch.system) {
        params.set('system', '1');
      } else {
        params.delete('system');
      }
    }
    const query = params.toString();
    router.replace(`${window.location.pathname}${query ? `?${query}` : ''}`);
  };

  const flip = async (row: AutomationListRow, on: boolean, undo = false): Promise<void> => {
    setBusy(row.slug);
    setMoved(m => ({ ...m, [row.slug]: on }));
    try {
      if (on) {
        await client.automations.resume({ slug: row.slug, ...(undo ? { note: 'Undo' } : {}) });
      } else {
        await client.automations.pause({ slug: row.slug, ...(undo ? { note: 'Undo' } : {}) });
      }
      if (!undo) {
        toast.success(on ? `Resumed · ${row.name}` : `Paused · ${row.name}`, {
          description: on ? 'It fires again from its next trigger.' : 'Nothing it would do happens until it is switched back on; what it would have done is said where the work is.',
          action: { label: 'Undo', onClick: () => void flip(row, !on, true) },
        });
      }
      router.refresh();
    } catch (err) {
      setMoved(m => ({ ...m, [row.slug]: !on }));
      toast.error(`Could not ${on ? 'resume' : 'pause'} ${row.name}`, { description: err instanceof Error ? err.message : String(err) });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (rows.length === 0 && !filter?.selected && (filter?.apps.length ?? 0) === 0 && !filter?.systemHidden) {
    return (
      <ListEmpty
        variant="inline"
        title="No automations in this workspace yet."
        description="An automation starts work on a schedule or when something happens, and apps bring their own."
        action={{ label: 'Browse apps', href: '/dashboard/apps' }}
        authoring={(
          <>
            A workspace authors its own in
            {' '}
            <code>automations/*.yaml</code>
            .
          </>
        )}
      />
    );
  }

  const on = rows.filter(r => (moved[r.slug] ?? r.state === 'on')).length;
  const chips: Chip[] = filter
    ? [
        { key: '', label: 'All', count: filter.apps.reduce((n, a) => n + a.count, 0), active: !filter.selected, pinned: true, onToggle: () => go({ app: '' }) },
        ...filter.apps.map(a => ({ key: a.key, label: a.label, count: a.count, active: filter.selected === a.key, onToggle: () => go({ app: filter.selected === a.key ? '' : a.key }) })),
      ]
    : [];

  return (
    <div className="flex flex-col gap-3" data-testid="automations-list">
      {filter && filter.apps.length > 1 && <ChipRow chips={chips} label="Filter by app" />}
      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="automations-on">
          {`${on} of ${rows.length} on`}
        </p>
      )}
      {rows.length === 0
        ? <p className="py-2 text-[13px] text-muted-foreground">No automations listed for this app.</p>
        : (
            <ListRows>
              {rows.map((r) => {
                const isOn = moved[r.slug] ?? r.state === 'on';
                const chip = r.state === 'off'
                  ? <StatusPill status="inactive" label="Off in the workspace" size="sm" />
                  : r.state === 'paused' && r.pause
                    ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex" data-testid={`automation-paused-${r.slug}`}>
                              <StatusPill status="paused" label="Paused" size="sm" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {`Paused by ${r.pause.byName} since ${r.pause.when}${r.pause.note ? `: ${r.pause.note}` : ''}`}
                          </TooltipContent>
                        </Tooltip>
                      )
                    : r.lastFailed
                      ? <StatusPill status="failed" label="Last run failed" size="sm" />
                      : r.system ? <StatusPill status="inactive" label="System" size="sm" /> : undefined;
                return (
                  <ListRow
                    key={r.slug}
                    data-testid={`automation-row-${r.slug}`}
                    href={`/dashboard/automation/${r.slug}`}
                    title={r.name}
                    subline={<Subline segments={[showApp ? r.app : '', r.trigger, r.owner ?? '', r.last]} separator="·" />}
                    chip={chip}
                    actionsAlways
                    actions={r.state === 'off'
                      ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Switch on={false} disabled label={`${r.name}: off in the workspace`} onChange={() => {}} />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Its workspace file says status: disabled; turn it on there.</TooltipContent>
                          </Tooltip>
                        )
                      : <Switch on={isOn} disabled={busy === r.slug} label={`${r.name}: ${isOn ? 'on' : 'paused'}`} onChange={next => void flip(r, next)} />}
                  />
                );
              })}
            </ListRows>
          )}
      {filter?.canShowSystem && (filter.showSystem || filter.systemHidden > 0) && (
        <button
          type="button"
          data-testid="automations-show-system"
          onClick={() => go({ system: !filter.showSystem })}
          className="self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {filter.showSystem
            ? 'Hide system automations'
            : `Show system automations (${filter.systemHidden})`}
        </button>
      )}
    </div>
  );
}
