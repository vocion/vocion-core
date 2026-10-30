/**
 * THE APP HOME, as data — the pure half of the page an app opens on
 * (`app.yaml` `home:`, `AppHomeSchema`). The server reads rows and runs
 * (`services/apps/appHome.ts`); this turns them into what the page draws:
 * readings with their dates and their evidence, the projects that use the
 * app, the greeting, and whether the app has anything yet.
 *
 * No DB, no React: tested in `appHome.test.ts`.
 *
 * Reduction (`docs/design/reduction.md`): a figure that cannot be read is
 * left out, never drawn as a zero with an apology; a count of zero is a
 * reading ("0 keywords ranking") and stays.
 */

import type { AppHome, AppHomeMeasure } from './schemas';
import type { PageRow } from '@/libs/workspace/pageFields';
import { applyFilter, interpolateHref, resolveField, toDate } from '@/libs/workspace/pageFields';
import { filtersOf } from './rowFilter';

/** One figure as the home draws it. */
export type MeasureReading = {
  key: string;
  label: string;
  /** The figure, formatted. */
  value: string;
  /** One quiet line beside it: "of 8", "High 3 · Medium 5". */
  note: string | null;
  /** Where its evidence is, one move away. */
  href: string | null;
  /** When the figure was true (ISO), for anything that can go stale. */
  at: string | null;
  /** How the date reads beside it: "as of" a read, "oldest from" a queue, "on" a run. */
  atLabel?: 'as of' | 'oldest from' | 'on';
};

/**
 * A figure in the form the measure declares.
 * @param n - The number.
 * @param format - `number`, `money` (units) or `cents`.
 * @param currency - ISO currency for money; USD when the measure names none.
 */
export function formatFigure(n: number, format: AppHomeMeasure['format'] = 'number', currency = 'USD'): string {
  if (format === 'money' || format === 'cents') {
    const units = format === 'cents' ? n / 100 : n;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: Math.abs(units) >= 1000 ? 0 : 2 }).format(units);
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);
}

/**
 * A value read off a record, as text: a number formatted, text as it is.
 * @param v - The value.
 * @param format - The measure's format.
 */
function asText(v: unknown, format: AppHomeMeasure['format']): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return formatFigure(v, format);
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = format !== 'number' && /^-?\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : null;
    return n !== null ? formatFigure(n, format) : v.trim();
  }
  return null;
}

function numberOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v.trim())) {
    return Number(v);
  }
  return null;
}

function newest(rows: readonly PageRow[], field: string | undefined): Date | null {
  let best: Date | null = null;
  for (const r of rows) {
    const d = toDate(field ? resolveField(r, field) : r.createdAt);
    if (d && (!best || d > best)) {
      best = d;
    }
  }
  return best;
}

/**
 * Fill `{projectId}` and a record's `{…}` accessors into a measure's href.
 * Null when a token cannot be filled: no link beats a link to a 404.
 * @param template - The measure's href.
 * @param ctx - What fills it.
 * @param ctx.projectId - The project, on a project's block.
 * @param ctx.row - The record a `latest` figure came from.
 */
export function measureHref(template: string | undefined, ctx: { projectId?: number | null; row?: PageRow | null }): string | null {
  if (!template) {
    return null;
  }
  let withProject = template;
  if (template.includes('{projectId}')) {
    if (ctx.projectId === undefined || ctx.projectId === null) {
      return null;
    }
    withProject = template.replaceAll('{projectId}', String(ctx.projectId));
  }
  if (!/\{[^{}]+\}/.test(withProject)) {
    return withProject;
  }
  return ctx.row ? interpolateHref(ctx.row, withProject) : null;
}

/**
 * A `records` measure over rows already narrowed to its type (and, on a
 * project's block, to the project). Null when there is nothing to show: a
 * `latest` with no record, a `sum` with no number.
 * @param measure - The declaration.
 * @param rows - The type's rows in scope.
 * @param ctx - The project (for `target` and the href) and the clock.
 * @param ctx.project - The project's own record, on a project's block.
 * @param ctx.now - The clock, for `since` filters.
 */
export function readRecordsMeasure(measure: AppHomeMeasure, rows: readonly PageRow[], ctx: { project?: PageRow | null; now: Date }): MeasureReading | null {
  const pool = applyFilter([...rows], filtersOf(measure.where), ctx.now);
  const projectId = ctx.project ? Number(ctx.project.id) : null;
  const base = { key: measure.key, label: measure.label };
  if (measure.stat === 'latest') {
    const sorted = [...pool].sort((a, b) => (toDate(measure.date ? resolveField(b, measure.date) : b.createdAt)?.getTime() ?? 0) - (toDate(measure.date ? resolveField(a, measure.date) : a.createdAt)?.getTime() ?? 0));
    const row = sorted[0];
    const value = row ? asText(resolveField(row, measure.field!), measure.format) : null;
    if (!row || value === null) {
      return null;
    }
    const parts = (measure.breakdown ?? [])
      .map((b) => {
        const v = numberOf(resolveField(row, b.field));
        return v === null ? null : `${b.label} ${formatFigure(v)}`;
      })
      .filter((p): p is string => p !== null);
    const at = toDate(measure.date ? resolveField(row, measure.date) : row.createdAt);
    return { ...base, value, note: parts.length > 0 ? parts.join(' · ') : null, href: measureHref(measure.href, { projectId, row }), at: at?.toISOString() ?? null };
  }
  let figure: number;
  if (measure.stat === 'sum') {
    const nums = pool.map(r => numberOf(resolveField(r, measure.field!))).filter((n): n is number => n !== null);
    if (nums.length === 0) {
      return null;
    }
    figure = nums.reduce((a, b) => a + b, 0);
  } else {
    figure = pool.length;
  }
  let note: string | null = null;
  if (measure.target && ctx.project) {
    const target = numberOf(resolveField(ctx.project, measure.target));
    note = target !== null && target > 0 ? `of ${formatFigure(target)}` : null;
  } else if (measure.of) {
    const total = applyFilter([...rows], filtersOf(measure.of), ctx.now).length;
    note = total > 0 ? `of ${formatFigure(total)}` : null;
  }
  const at = measure.date ? newest(pool.length > 0 ? pool : rows, measure.date) : null;
  return { ...base, value: formatFigure(figure, measure.format), note, href: measureHref(measure.href, { projectId }), at: at?.toISOString() ?? null };
}

/**
 * A `project` measure: a field of the project's own record.
 * @param measure - The declaration.
 * @param project - The project's record.
 */
export function readProjectMeasure(measure: AppHomeMeasure, project: PageRow): MeasureReading | null {
  const value = asText(resolveField(project, measure.field!), measure.format);
  if (value === null) {
    return null;
  }
  const at = measure.date ? toDate(resolveField(project, measure.date)) : null;
  return { key: measure.key, label: measure.label, value, note: null, href: measureHref(measure.href, { projectId: Number(project.id), row: project }), at: at?.toISOString() ?? null };
}

/** What a `state` read came back with (`runStateQuery`). */
export type StateFigure = { total: number; sum?: number | null; missing: string[]; syncedAt: Array<Date | null> };

/**
 * A `state` measure: a view or query over synced systems. Null when nothing
 * connected here carries what it reads: a system that is not connected is
 * not a zero.
 * @param measure - The declaration.
 * @param read - The read.
 * @param fallbackHref - Where its evidence is when the measure names no page.
 */
export function readStateMeasure(measure: AppHomeMeasure, read: StateFigure, fallbackHref: string | null): MeasureReading | null {
  if (read.missing.length > 0 && read.total === 0) {
    return null;
  }
  const dates = read.syncedAt.filter((d): d is Date => d !== null);
  if (read.syncedAt.length > 0 && dates.length === 0) {
    // Connected, never synced: nothing has been read to count.
    return null;
  }
  const oldest = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
  const value = measure.sum
    ? (read.sum === null || read.sum === undefined ? null : formatFigure(read.sum, measure.format))
    : formatFigure(read.total);
  if (value === null) {
    return null;
  }
  const note = measure.sum ? `${formatFigure(read.total)} ${read.total === 1 ? 'item' : 'items'}` : null;
  return { key: measure.key, label: measure.label, value, note, href: measure.href ?? fallbackHref, at: oldest?.toISOString() ?? null };
}

/**
 * Whether an action id is one an `approvals` measure counts: an exact id, or
 * any under a `prefix.*`.
 * @param actionId - The proposal's action.
 * @param actions - The measure's list.
 */
export function actionMatches(actionId: string, actions: readonly string[]): boolean {
  return actions.some(a => (a.endsWith('.*') ? actionId.startsWith(a.slice(0, -1)) : actionId === a));
}

/** A proposal waiting in Review, as an `approvals` measure reads it. */
export type WaitingProposal = { actionId: string; createdAt: Date; input: Record<string, unknown> | null };

/**
 * An `approvals` measure: proposals waiting on a person for these actions,
 * dated by the oldest. On a project's block, only those whose input names it.
 * @param measure - The declaration.
 * @param waiting - Every proposal waiting in this workspace.
 * @param projectId - The project, on a project's block.
 */
export function readApprovalsMeasure(measure: AppHomeMeasure, waiting: readonly WaitingProposal[], projectId?: number | null): MeasureReading {
  const mine = waiting.filter(w => actionMatches(w.actionId, measure.actions ?? [])
    && (projectId === undefined || projectId === null || !measure.projectKey || Number(w.input?.[measure.projectKey]) === projectId));
  const oldest = mine.reduce<Date | null>((acc, w) => (!acc || w.createdAt < acc ? w.createdAt : acc), null);
  return {
    key: measure.key,
    label: measure.label,
    value: formatFigure(mine.length),
    note: null,
    href: measureHref(measure.href, { projectId }) ?? '/dashboard/inbox',
    at: oldest?.toISOString() ?? null,
    atLabel: 'oldest from',
  };
}

/** A mission's newest run, as a `mission` measure reads it. */
export type MissionRunInput = { id: number; status: string; createdAt: Date; updatedAt: Date | null; completedAt?: Date | null };

const RUN_WORDS: Record<string, string> = {
  planning: 'Starting',
  running: 'Running',
  paused: 'Paused',
  awaiting_review: 'Waiting on you',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
};

/**
 * A `mission` measure: its newest run's state, and when.
 * @param measure - The declaration.
 * @param run - The newest run, if any.
 */
export function readMissionMeasure(measure: AppHomeMeasure, run: MissionRunInput | null): MeasureReading | null {
  if (!run) {
    return null;
  }
  const at = run.completedAt ?? run.updatedAt ?? run.createdAt;
  return { key: measure.key, label: measure.label, value: RUN_WORDS[run.status] ?? run.status, note: null, href: `/dashboard/missions/runs/${run.id}`, at: at.toISOString(), atLabel: 'on' };
}

/**
 * The projects that use an app: the ones its records name, then those the
 * home's `include` filter keeps, newest first, at most `limit`.
 * @param projects - Every project (data room) in the workspace, as rows.
 * @param named - Project ids the app's records name.
 * @param include - The home's `projects.include`.
 * @param opts - The cap and the clock.
 * @param opts.limit - At most this many.
 * @param opts.now - The clock.
 */
export function projectsUsingApp<T extends PageRow & { updatedAt?: Date | null }>(projects: readonly T[], named: ReadonlySet<number>, include: NonNullable<AppHome['projects']>['include'], opts: { limit: number; now: Date }): T[] {
  const kept = new Set(include ? applyFilter([...projects], filtersOf(include), opts.now).map(p => Number(p.id)) : []);
  return projects
    .filter(p => named.has(Number(p.id)) || kept.has(Number(p.id)))
    .sort((a, b) => ((b.updatedAt ?? b.createdAt)?.getTime() ?? 0) - ((a.updatedAt ?? a.createdAt)?.getTime() ?? 0))
    .slice(0, opts.limit);
}

/**
 * The object types a home's `records` measures read.
 * @param home - The app's home.
 */
export function recordTypesOf(home: Pick<AppHome, 'measures' | 'projects'>): string[] {
  const all = [...(home.measures ?? []), ...(home.projects?.measures ?? [])];
  return [...new Set(all.filter(m => m.source === 'records' && m.objectType).map(m => m.objectType!))];
}
