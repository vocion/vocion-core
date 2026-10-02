/**
 * sentry_issues / sentry_issue — the production errors behind a report,
 * read live with the workspace's own Sentry token (Chris, 2026-10-01: every
 * signed-in call of a product's API answered 500 for hours, Sentry counted
 * 184 of them, and no seat could read one).
 *
 *   sentry_issues  issues of one project, environment and release, around a
 *                  time or over a period, ranked by events, each with first
 *                  and last seen, its short id and its link.
 *   sentry_issue   one issue: what it is, the release it was first and last
 *                  seen in, and its latest event (exception, stack frames
 *                  with file and line, breadcrumbs, the request's method, URL
 *                  and status, tags, release).
 *
 * Granted-only (`harness.grantTools: [sentry_issues, sentry_issue]`).
 * Read-only: whatever a seat does about an error is its own action or filing.
 * Which project a product reports to is the workspace's to say, never core's.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { SentryCredentials } from '@/libs/sentry/client';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const SENTRY_ISSUES_TOOL = 'sentry_issues';
export const SENTRY_ISSUE_TOOL = 'sentry_issue';

export function sentryTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const granted = new Set(ctx.harnessConfig.grantTools ?? []);
  return [
    ...(granted.has(SENTRY_ISSUES_TOOL) ? [issuesTool(ctx)] : []),
    ...(granted.has(SENTRY_ISSUE_TOOL) ? [issueTool(ctx)] : []),
  ];
}

type Resolved = { c: SentryCredentials; project: string | null; environment: string | null };

/**
 * The credential and the project to read.
 * @param orgId - The workspace.
 * @param args - The tool's arguments.
 * @param args.project - A project slug.
 * @param args.environment - The tracker's environment tag.
 * @param args.org - The organization, when it is not the credential's.
 */
async function resolve(orgId: string, args: { project?: string; environment?: string; org?: string }): Promise<Resolved | { error: string; message: string }> {
  const { sentryFor } = await import('@/services/sentry/access');
  const access = await sentryFor(orgId);
  if (!access.ok) {
    return { error: access.error, message: access.message };
  }
  const c = args.org && args.org !== access.credentials.org ? { ...access.credentials, org: args.org } : access.credentials;
  return { c, project: args.project?.trim() || null, environment: args.environment?.trim() || null };
}

const PERIOD = /^\d{1,3}[mhdw]$/;

function issuesTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const r = await resolve(ctx.orgId, args);
        if ('error' in r) {
          return JSON.stringify({ ok: false, ...r });
        }
        const client = await import('@/libs/sentry/client');
        const limit = args.limit ?? 10;
        if (args.around || args.start) {
          // A time a person named: the events in that window, per issue.
          const mid = args.around ? Date.parse(args.around) : Number.NaN;
          const half = (args.window_minutes ?? 60) * 60_000 / 2;
          const start = args.start ? new Date(args.start) : new Date(mid - half);
          const end = args.end ? new Date(args.end) : args.around ? new Date(mid + half) : new Date();
          if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
            return JSON.stringify({ ok: false, error: 'bad_time', message: 'around, start and end are ISO times, e.g. 2026-10-01T14:30:00Z.' });
          }
          const counts = await client.countErrors(r.c, { project: r.project, environment: r.environment, release: args.release ?? null, start, end, limit });
          if (!counts.ok) {
            return JSON.stringify(counts);
          }
          return JSON.stringify({
            ok: true,
            org: r.c.org,
            project: r.project,
            environment: r.environment,
            release: args.release ?? null,
            window: { start: start.toISOString(), end: end.toISOString() },
            issues: counts.data.map(i => ({ ...i, url: `https://${r.c.org}.sentry.io/issues/${i.issueId}/` })),
            note: counts.data.length === 0 ? 'No error event in that window.' : 'Ranked by events in the window. Read the top one with sentry_issue (its shortId).',
          });
        }
        const statsPeriod = args.period && PERIOD.test(args.period) ? args.period : '24h';
        const list = await client.listIssues(r.c, {
          project: r.project,
          environment: r.environment,
          ...(args.first_seen_in_release ? { firstRelease: args.release ?? null } : { release: args.release ?? null }),
          statsPeriod,
          status: args.status ?? 'unresolved',
          limit,
        });
        if (!list.ok) {
          return JSON.stringify(list);
        }
        return JSON.stringify({
          ok: true,
          org: r.c.org,
          project: r.project,
          environment: r.environment,
          release: args.release ?? null,
          period: statsPeriod,
          issues: list.data,
          link: r.project ? client.projectIssuesUrl({ org: r.c.org, project: r.project, environment: r.environment }) : null,
          note: list.data.length === 0 ? 'No issue matched.' : 'Ranked by events. Read the top one with sentry_issue (its shortId).',
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: 'sentry_error', message: (err as Error).message });
      }
    },
    {
      name: SENTRY_ISSUES_TOOL,
      description: 'Production errors from Sentry, read live with this workspace\'s token: the issues of one project, environment and release, ranked by events, each with its short id (e.g. NW-API-3), title, culprit, events, first and last seen, and its link. Give `around` (and `window_minutes`) or `start`/`end` to count events in the window a person named; otherwise `period` (1h, 24h, 14d). Use it first when someone reports an error, a 500 or a broken page.',
      schema: z.object({
        project: z.string().optional().describe('A Sentry project slug, e.g. northwind-api. Every project when omitted.'),
        environment: z.string().optional().describe('Sentry\'s environment tag, e.g. production.'),
        org: z.string().optional().describe('The organization slug, when it is not the credential\'s.'),
        release: z.string().optional().describe('Only this release (a commit sha).'),
        first_seen_in_release: z.boolean().optional().describe('With release: only issues FIRST seen in it — what that deploy introduced.'),
        around: z.string().optional().describe('An ISO time to center a window on, e.g. when a person saw the error.'),
        window_minutes: z.number().int().min(5).max(1440).optional().describe('With around: the window\'s width (default 60).'),
        start: z.string().optional().describe('ISO start of a window.'),
        end: z.string().optional().describe('ISO end of a window (default now).'),
        period: z.string().optional().describe('Without a window: how far back, as Sentry says it (1h, 24h, 14d). Default 24h.'),
        status: z.enum(['unresolved', 'resolved', 'all']).optional().describe('Default unresolved.'),
        limit: z.number().int().min(1).max(50).optional().describe('How many issues (default 10).'),
      }),
    },
  );
}

function issueTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { sentryFor } = await import('@/services/sentry/access');
        const access = await sentryFor(ctx.orgId);
        if (!access.ok) {
          return JSON.stringify(access);
        }
        const client = await import('@/libs/sentry/client');
        const c = args.org && args.org !== access.credentials.org ? { ...access.credentials, org: args.org } : access.credentials;
        const issue = await client.readIssue(c, args.id);
        if (!issue.ok) {
          return JSON.stringify(issue);
        }
        const event = await client.latestEvent(c, issue.data.id, args.environment ?? null);
        const latest = event.ok ? event.data : null;
        // IS IT STILL HAPPENING, as facts, before anyone acts on it: when it
        // was last seen against now, and the releases since (2026-10-01: a P1
        // was filed for an outage a revert had fixed hours before).
        const { stillHappening } = await import('@/libs/sentry/stillHappening');
        const releases = issue.data.project ? await client.listReleases(c, issue.data.project, 10) : null;
        const now = stillHappening(issue.data, releases?.ok ? releases.data : [], new Date());
        return JSON.stringify({
          ok: true,
          stillHappening: now,
          issue: issue.data,
          latestEvent: latest
            ? {
                ...latest,
                // The frames that are the product's own, innermost last, for mapping to its repository.
                appFrames: latest.exceptions.flatMap(x => x.frames.filter(f => f.inApp)).map(f => `${f.file}:${f.line ?? '?'}${f.function ? ` in ${f.function}` : ''}`),
              }
            : null,
          latestEventError: event.ok ? null : event.message,
          note: `${now.line} Map each app frame to the repository: drop the container root (e.g. /app/) and read a built path (dist/…js) back to its source (src/…ts). Compare firstRelease and firstSeen with what was deployed, and when, to say whether a deploy brought it.`,
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: 'sentry_error', message: (err as Error).message });
      }
    },
    {
      name: SENTRY_ISSUE_TOOL,
      description: 'One Sentry issue, read live: whether it is still happening (`stillHappening`: last seen against now, minutes quiet, and the releases since — read it before acting), its short id, title, culprit, events, first and last seen, the release it was first and last seen in, and its link; its latest event (exception type and message, stack frames with file, line and function, the app\'s own frames listed, breadcrumbs, the request\'s method, URL and status, tags, release). Read it before saying why production is failing.',
      schema: z.object({
        id: z.string().describe('The issue\'s short id (NW-API-3) or numeric id, from sentry_issues or a Sentry link.'),
        environment: z.string().optional().describe('Read the latest event from this environment, e.g. production.'),
        org: z.string().optional().describe('The organization slug, when it is not the credential\'s.'),
      }),
    },
  );
}
