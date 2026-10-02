'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ListEmpty, ListRow, ListRows, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/libs/Orpc';

/** One automation as its row draws it, already in words on the server. */
export type AutomationListRow = {
  slug: string;
  name: string;
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

/** A group of rows: one plugin, or the workspace's own. */
export type AutomationListGroup = { key: string; label: string; rows: AutomationListRow[] };

/**
 * EVERY AUTOMATION, WITH ITS SWITCH (Chris, 2026-10-01: "Put all those
 * automations on an Automations page with toggle switches … Leave most off").
 *
 * One row per automation in the one `ListRow`, grouped by the plugin that
 * ships it. The switch pauses or resumes it through the same routes the
 * automation's own page uses, so who switched it and when is on the record;
 * the toast says what it did and offers Undo. A paused row says who paused it,
 * since when and why on its chip's tooltip. An automation its workspace file
 * turns off is drawn off and cannot be switched here: the file is the record.
 * @param props
 * @param props.groups - The rows, grouped.
 */
export function AutomationsList({ groups }: { groups: AutomationListGroup[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // What a switch says while the page re-reads: the person's move, at once.
  const [moved, setMoved] = useState<Record<string, boolean>>({});

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

  if (groups.every(g => g.rows.length === 0)) {
    return <ListEmpty variant="inline" title="No automations in this workspace yet." description="A plugin ships them, or the workspace authors them in automations/*.yaml." />;
  }

  return (
    <div className="flex flex-col gap-8" data-testid="automations-list">
      {groups.filter(g => g.rows.length > 0).map(g => (
        <section key={g.key} aria-label={g.label} data-testid={`automations-group-${g.key}`}>
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {g.label}
            <span className="ml-2 font-normal normal-case">
              {g.rows.filter(r => (moved[r.slug] ?? r.state === 'on')).length}
              {' of '}
              {g.rows.length}
              {' on'}
            </span>
          </h2>
          <ListRows>
            {g.rows.map((r) => {
              const on = moved[r.slug] ?? r.state === 'on';
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
                  : r.lastFailed ? <StatusPill status="failed" label="Last run failed" size="sm" /> : undefined;
              return (
                <ListRow
                  key={r.slug}
                  data-testid={`automation-row-${r.slug}`}
                  href={`/dashboard/automation/${r.slug}`}
                  title={r.name}
                  subline={<Subline segments={[r.trigger, r.owner ?? '', r.last]} separator="·" />}
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
                    : <Switch on={on} disabled={busy === r.slug} label={`${r.name}: ${on ? 'on' : 'paused'}`} onChange={next => void flip(r, next)} />}
                />
              );
            })}
          </ListRows>
        </section>
      ))}
    </div>
  );
}
