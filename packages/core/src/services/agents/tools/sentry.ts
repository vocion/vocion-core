/**
 * sentry_issues / sentry_issue — the production errors behind a report,
 * read live with the workspace's own Sentry token (Chris, 2026-10-01: every
 * signed-in call of a product's API answered 500 for hours, Sentry counted
 * 184 of them, and no seat could read one).
 *
 *   sentry_issues  issues of one project (or the environment record that
 *                  names it), environment and release, around a time or over
 *                  a period, ranked by events, each with first and last seen,
 *                  its short id and its link.
 *   sentry_issue   one issue: what it is, the release it was first seen in,
 *                  its latest event (exception, stack frames with file and
 *                  line, breadcrumbs, the request's method, URL and status,
 *                  tags, release), and whether the deploy recorded on its
 *                  environment brought it (`errorCause.correlateIssue`).
 *
 * Granted-only (`harness.grantTools: [sentry_issues, sentry_issue]`): the
 * seats that own the pipeline, triage and the live check. Read-only; the
 * moves (a revert, a bug request) are the seat's own actions and filings.
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

type Resolved = { c: SentryCredentials; project: string | null; environment: string | null; record: { id: number; slug: string } | null };

/**
 * The credential and the project to read: the one named, or the one an
 * environment record names in `observability.sentry`.
 * @param orgId - The workspace.
 * @param args - The tool's arguments.
 * @param args.project - A project slug.
 * @param args.environment_record - An environment record's slug or id.
 * @param args.environment - The tracker's environment tag.
 */
async function resolve(orgId: string, args: { project?: string; environment_record?: string; environment?: string }): Promise<Resolved | { error: string; message: string }> {
  const { sentryFor } = await import('@/services/sentry/access');
  const access = await sentryFor(orgId);
  if (!access.ok) {
    return { error: access.error, message: access.message };
  }
  let c = access.credentials;
  let project = args.project?.trim() || null;
  let environment = args.environment?.trim() || null;
  let record: Resolved['record'] = null;
  if (args.environment_record) {
    const { environmentRows } = await import('@/services/factory/environments');
    const { sentryRefOf } = await import('@/libs/sentry/reference');
    const wanted = args.environment_record.trim().toLowerCase().replace(/^env-/, '');
    const row = (await environmentRows(orgId)).find(e => String(e.id) === wanted || String(e.meta.slug ?? '').toLowerCase() === wanted || e.title.toLowerCase() === wanted);
    if (!row) {
      return { error: 'no_environment', message: `No environment record is called ${args.environment_record}. Read the product's environments with lookup_objects.` };
    }
    const ref = sentryRefOf(row.meta);
    if (!ref) {
      return { error: 'no_sentry_project', message: `Environment ${args.environment_record} names no Sentry project. Its record needs observability.sentry: {org, project, environment}.` };
    }
    record = { id: row.id, slug: String(row.meta.slug ?? row.title) };
    project = project ?? ref.project;
    environment = environment ?? ref.environment;
    if (ref.org !== c.org) {
      c = { ...c, org: ref.org };
    }
  }
  return { c, project, environment, record };
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
            environmentRecord: r.record,
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
          environmentRecord: r.record,
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
      description: 'Production errors from Sentry, read live with this workspace\'s token: the issues of one project (or of the environment record that names it in observability.sentry), environment and release, ranked by events, each with its short id (e.g. NW-API-3), title, culprit, events, first and last seen, and its link. Give `around` (and `window_minutes`) or `start`/`end` to count events in the window a person named; otherwise `period` (1h, 24h, 14d). Use it first when someone reports an error, a 500 or a broken page.',
      schema: z.object({
        environment_record: z.string().optional().describe('An environment record\'s slug or id (e.g. northwind-api-production): its observability.sentry names the project and environment.'),
        project: z.string().optional().describe('A Sentry project slug, when no environment record is given.'),
        environment: z.string().optional().describe('Sentry\'s environment tag, e.g. production. Defaults to the record\'s.'),
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
        const environment = args.environment ?? (event.ok ? event.data.environment : null);
        const { correlateIssue } = await import('@/services/factory/errorCause');
        const deploy = issue.data.project
          ? await correlateIssue(ctx.orgId, { shortId: issue.data.shortId, firstRelease: issue.data.firstRelease ?? null, firstSeen: issue.data.firstSeen, url: issue.data.url }, { org: c.org, project: issue.data.project, environment }).catch(err => ({ verdict: 'unknown', line: `The deploy behind it could not be read: ${(err as Error).message}` }))
          : null;
        const latest = event.ok ? event.data : null;
        return JSON.stringify({
          ok: true,
          issue: issue.data,
          latestEvent: latest
            ? {
                ...latest,
                // The frames that are the product's own, innermost last, for mapping to its repository.
                appFrames: latest.exceptions.flatMap(x => x.frames.filter(f => f.inApp)).map(f => `${f.file}:${f.line ?? '?'}${f.function ? ` in ${f.function}` : ''}`),
              }
            : null,
          latestEventError: event.ok ? null : event.message,
          deploy,
          note: 'Map each app frame to the repository: drop the container root (e.g. /app/) and read a built path (dist/…js) back to its source (src/…ts). deploy.verdict last-deploy means reverting deploy.pull takes it out.',
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: 'sentry_error', message: (err as Error).message });
      }
    },
    {
      name: SENTRY_ISSUE_TOOL,
      description: 'One Sentry issue, read live: its short id, title, culprit, events, first and last seen, the release it was first and last seen in, and its link; its latest event (exception type and message, stack frames with file, line and function, the app\'s own frames listed, breadcrumbs, the request\'s method, URL and status, tags, release); and `deploy` — whether the deploy recorded on its environment brought it (last-deploy, earlier-deploy or unknown), with the merged pull request behind its first release. Read it before saying why production is failing.',
      schema: z.object({
        id: z.string().describe('The issue\'s short id (NW-API-3) or numeric id, from sentry_issues or a Sentry link.'),
        environment: z.string().optional().describe('Read the latest event from this environment, e.g. production.'),
        org: z.string().optional().describe('The organization slug, when it is not the credential\'s.'),
      }),
    },
  );
}
