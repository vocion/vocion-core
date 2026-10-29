/**
 * SEO OPPORTUNITIES ON A CADENCE — how many new pages a client is owed, and
 * whether this week's plan is behind it.
 *
 * A project's `seoCadence` (pages a month, and an optional topic focus) is a
 * PERSON's setting on the project page, protected like `seoGate`
 * (`PERSON_ONLY_FIELDS`). Every week, in the workspace's zone, the SEO
 * plugin's "New page opportunities" automation runs {@link runSeoOpportunitiesJob}:
 * plain code, no model. For each project with a cadence it counts the pages
 * already planned this month and the ones still in flight, and only for a
 * project behind pace does it queue SEO work (`seo.work_queued`, reason
 * `opportunities`) — the strategist's background mission run, which re-reads
 * Google for the client's core topics and the site inventory, then files a
 * normal keyword plan sign-off (`seo_plan_batch` with `cadence: true`, which
 * re-checks the count in code). A project on pace gets no run and no message;
 * a project without a cadence is never planned for on its own.
 *
 * Pace is pro rata: by the end of the coming week the month is owed its share
 * of the cadence (8 a month on the 1st of a 31-day month: 2; on the 29th: 8),
 * so each week proposes a small plan a person can review, not the month's
 * whole list at once.
 */

import type { SeoPageRecord, SeoPageStatus } from './records';
import type { SeoCadence } from '@/services/DataRoomService';
import { dayKey } from '@/libs/time/zone';

/** Statuses of a page still being worked on: planned earlier and not finished, it still counts against this month. */
const IN_FLIGHT: ReadonlySet<SeoPageStatus> = new Set(['proposed', 'researched', 'briefed', 'drafting', 'in_review', 'changes_requested']);

/** How far ahead a weekly check plans: to the end of the coming seven days. */
const WINDOW_DAYS = 6;

export type CadenceStanding = {
  pagesPerMonth: number;
  focus?: string;
  /** The month counted, in the workspace's zone: `YYYY-MM`. */
  month: string;
  /** Pages the month is owed by the end of the coming week. */
  due: number;
  /** Pages planned this month (any status but rejected) plus earlier pages still in flight. */
  counted: number;
  /** How many to propose now: `due − counted`, never below zero. */
  propose: number;
  /** The standing in one line, for the run's result and the tool's refusal. */
  line: string;
};

/**
 * Where a project stands against its cadence. Null when it has none. Pure.
 * @param input - The cadence, the project's pages, the clock and the zone.
 * @param input.cadence - The project's `seoCadence`.
 * @param input.pages - Every page of the project, with when it was planned.
 * @param input.now - The clock.
 * @param input.timeZone - The workspace's zone: the month and its days are read there.
 */
export function cadenceStanding(input: { cadence: SeoCadence | null | undefined; pages: readonly Pick<SeoPageRecord, 'meta' | 'createdAt'>[]; now: Date; timeZone: string }): CadenceStanding | null {
  const perMonth = input.cadence?.pagesPerMonth ?? 0;
  if (!Number.isInteger(perMonth) || perMonth < 1) {
    return null;
  }
  const today = dayKey(input.now, input.timeZone);
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  // Day 0 of the next month is this month's last day.
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const due = Math.ceil(perMonth * Math.min(daysInMonth, day + WINDOW_DAYS) / daysInMonth);
  const counted = input.pages.filter((p) => {
    if (p.meta.status === 'rejected') {
      return false;
    }
    const plannedThisMonth = p.createdAt ? dayKey(p.createdAt, input.timeZone).slice(0, 7) === month : false;
    return plannedThisMonth || IN_FLIGHT.has(p.meta.status);
  }).length;
  const propose = Math.max(0, due - counted);
  const focus = input.cadence?.focus?.trim() || undefined;
  return {
    pagesPerMonth: perMonth,
    ...(focus ? { focus } : {}),
    month,
    due,
    counted,
    propose,
    line: propose === 0
      ? `${counted} planned or in flight against ${due} due by the end of the week (${perMonth} a month): on pace`
      : `${counted} planned or in flight against ${due} due by the end of the week (${perMonth} a month): ${propose} to propose`,
  };
}

/**
 * Why a cadence plan may not be filed as asked, or null when it may. Pure.
 * @param standing - The project's standing, or null when it has no cadence.
 * @param pages - How many pages the plan proposes.
 */
export function cadencePlanRefusal(standing: CadenceStanding | null, pages: number): string | null {
  if (!standing) {
    return 'Not planned: this project has no SEO cadence, so nothing is proposed for it on its own. A person sets pages per month on the project page.';
  }
  if (standing.propose === 0) {
    return `Not planned: the project is on pace (${standing.line}). Propose nothing and say nothing.`;
  }
  if (pages > standing.propose) {
    return `Not planned: the cadence leaves room for ${standing.propose} ${standing.propose === 1 ? 'page' : 'pages'} now (${standing.line}), and this plan has ${pages}. Keep the strongest ${standing.propose} and file it again.`;
  }
  return null;
}

/**
 * One project's standing, read from the database. Null when the id is not a
 * project here or it has no cadence.
 * @param orgId - The workspace.
 * @param projectId - The project.
 * @param now - The clock.
 */
export async function readCadenceStanding(orgId: string, projectId: number, now: Date = new Date()): Promise<CadenceStanding | null> {
  const [{ getProject }, { listProjectSeoPages }, { workspaceTimeZone }] = await Promise.all([
    import('@/services/DataRoomService'),
    import('./records'),
    import('@/libs/time/workspaceTimeZone'),
  ]);
  const project = await getProject(orgId, projectId);
  if (!project?.meta.seoCadence) {
    return null;
  }
  const [pages, timeZone] = await Promise.all([listProjectSeoPages(orgId, projectId), workspaceTimeZone(orgId)]);
  return cadenceStanding({ cadence: project.meta.seoCadence, pages, now, timeZone });
}

/** What one weekly check did, per project: the run's result, so "on pace, nothing proposed" is on the record. */
export type OpportunitiesResult = {
  projects: Array<{ projectId: number; title: string; line: string; queued: number }>;
  queued: number;
};

/**
 * The weekly check: for each project with a cadence, queue the strategist's
 * background run for just the pages it is behind by, and nothing for one on
 * pace. Projects without a cadence are not read. Never says anything itself.
 * @param orgId - The workspace.
 * @param input - `now` (ISO) for a rehearsal; otherwise the clock.
 * @param queue - How work is queued (tests).
 */
export async function runSeoOpportunitiesJob(orgId: string, input: Record<string, unknown> = {}, queue?: typeof import('./work').queueSeoWork): Promise<OpportunitiesResult> {
  const [{ listDataRooms }, { listProjectSeoPages }, { workspaceTimeZone }, work] = await Promise.all([
    import('@/services/DataRoomService'),
    import('./records'),
    import('@/libs/time/workspaceTimeZone'),
    import('./work'),
  ]);
  const enqueue = queue ?? work.queueSeoWork;
  const now = typeof input.now === 'string' && !Number.isNaN(Date.parse(input.now)) ? new Date(input.now) : new Date();
  const timeZone = await workspaceTimeZone(orgId);
  const out: OpportunitiesResult = { projects: [], queued: 0 };
  for (const project of await listDataRooms(orgId)) {
    if (!project.meta.seoCadence) {
      continue;
    }
    const standing = cadenceStanding({ cadence: project.meta.seoCadence, pages: await listProjectSeoPages(orgId, project.id), now, timeZone });
    if (!standing) {
      continue;
    }
    let queued = 0;
    if (standing.propose > 0) {
      const ok = await enqueue(orgId, 'opportunities', {
        projectId: project.id,
        projectName: project.title,
        pages: standing.propose,
        pagesPerMonth: standing.pagesPerMonth,
        ...(standing.focus ? { focus: standing.focus } : {}),
        standing: standing.line,
      }, `opportunities:${project.id}:${dayKey(now, timeZone)}`);
      queued = ok ? standing.propose : 0;
    }
    out.projects.push({ projectId: project.id, title: project.title, line: standing.line, queued });
    out.queued += queued;
  }
  return out;
}
