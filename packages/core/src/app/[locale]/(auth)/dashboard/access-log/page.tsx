import type { AccessLogFilters, AccessLogRowData } from '@/features/access/AccessLogView';
import type { AccessAction } from '@/services/access/accessLog';
import type { AccessActorKind, AccessEventRow, AccessLogNames } from '@/services/access/AccessLogService';
import type { RecordType } from '@/services/chat/pageContext';
import { setRequestLocale } from 'next-intl/server';
import { ListPage } from '@/components/patterns';
import { AccessLogView } from '@/features/access/AccessLogView';
import { clerkAuth as auth } from '@/libs/Auth';
import { describeRef } from '@/libs/preview/describeRef';
import { ACCESS_ACTIONS } from '@/services/access/accessLog';
import { ACCESS_ACTOR_KINDS, accessLogRetentionDays, listAccessEvents, namesForAccessEvents } from '@/services/access/AccessLogService';
import { normalizeWorkspaceRole } from '@/services/authz';
import { RECORD_TYPES } from '@/services/chat/pageContext';

export const dynamic = 'force-dynamic';

const PAGE = 50;
const MAX = 200;
const DEFAULT_DAYS = 30;

const RECORD_TYPE_SET: ReadonlySet<string> = new Set(RECORD_TYPES);

/**
 * The surface a read came through, in words. A tool or an MCP tool keeps its
 * own name — it is the evidence of exactly which call read the record.
 * @param via - The stored surface.
 */
function viaLabel(via: string): string {
  if (via.startsWith('tool:')) {
    return via.slice('tool:'.length);
  }
  if (via.startsWith('mcp:')) {
    return `MCP ${via.slice('mcp:'.length)}`;
  }
  return ({ page: 'its page', preview: 'the preview panel', app: 'the app', api: 'the API', share: 'a share link' } as Record<string, string>)[via] ?? via;
}

function tokenLabel(actorId: string | null): string {
  const id = actorId?.replace(/^token:/, '') ?? '';
  return id === 'mcp' ? 'The MCP server' : `API token ${id}`.trim();
}

function actorLabel(e: AccessEventRow, names: AccessLogNames): string {
  switch (e.actorKind) {
    case 'user':
      return (e.actorId && names.actors[e.actorId]) || e.actorId || 'Someone';
    case 'agent':
      return (e.actorId && names.actors[e.actorId]) || e.actorId || 'An agent';
    case 'token':
      return tokenLabel(e.actorId);
    default:
      return 'Anyone with the link';
  }
}

/**
 * Who an agent read for: a person by name, a token, or the trigger as stored.
 * @param onBehalfOf - The stored value.
 * @param names - The page's names.
 */
function forWhomLabel(onBehalfOf: string | null, names: AccessLogNames): string | null {
  if (!onBehalfOf) {
    return null;
  }
  if (onBehalfOf.startsWith('token:')) {
    return tokenLabel(onBehalfOf);
  }
  return names.actors[onBehalfOf] ?? onBehalfOf;
}

function detailLabel(detail: AccessEventRow['detail']): string | null {
  if (!detail) {
    return null;
  }
  if (typeof detail.hits === 'number') {
    return `${detail.hits} ${detail.hits === 1 ? 'result' : 'results'}`;
  }
  if (typeof detail.format === 'string') {
    return detail.format;
  }
  return null;
}

function recordOf(e: AccessEventRow, names: AccessLogNames): Pick<AccessLogRowData, 'record' | 'recordHref' | 'recordFilter'> {
  if (!e.recordId) {
    // A search names no one record; what it searched is the row.
    return { record: `A search of ${e.recordKind === 'document' ? 'connected documents' : `${e.recordKind} records`}`, recordHref: null, recordFilter: null };
  }
  const described = RECORD_TYPE_SET.has(e.recordKind)
    ? describeRef({ type: e.recordKind as RecordType, id: e.recordId })
    : { label: `${e.recordKind} ${e.recordId}`, href: null };
  const title = names.records[`${e.recordKind}:${e.recordId}`];
  return {
    record: title ? `${title} (${described.label})` : described.label,
    recordHref: described.href,
    recordFilter: { kind: e.recordKind, id: e.recordId },
  };
}

function runOf(e: AccessEventRow): AccessLogRowData['run'] {
  if (!e.runKind || !e.runId || !RECORD_TYPE_SET.has(e.runKind)) {
    return null;
  }
  const d = describeRef({ type: e.runKind as RecordType, id: e.runId });
  return { label: `on ${d.label}`, href: d.href };
}

function one(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
}

/**
 * The Access log — who read which record in this workspace, and when.
 *
 * Workspace admins only, and only this workspace: a client admin answers
 * "who looked at this record" and "what did that agent read on that run"
 * here, without anyone grepping logs, and never sees another workspace's reads
 * through it. The same rows are `GET /api/v1/access-log`.
 * @param props - Route props.
 * @param props.params - `{ locale }`.
 * @param props.searchParams - The filters: `action`, `who`, `days`, `actor`, `kind`, `record`, `n`.
 */
export default async function AccessLogPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const sp = await props.searchParams;
  const { orgId, role, workspaceRole } = await auth();
  if (!orgId) {
    return null;
  }

  const retention = accessLogRetentionDays();
  const description = `Every time a person, an agent, an API token or a share link viewed, downloaded, exported or searched a record in this workspace. ${retention === null ? 'Kept indefinitely.' : `Kept ${retention} days.`}`;

  if (normalizeWorkspaceRole(workspaceRole ?? role) !== 'admin') {
    return (
      <ListPage title="Access log" description={description}>
        <p className="py-10 text-center text-sm text-muted-foreground">The access log is visible to this workspace's admins only.</p>
      </ListPage>
    );
  }

  const action = one(sp.action);
  const who = one(sp.who);
  const days = one(sp.days);
  const actor = one(sp.actor);
  const kind = one(sp.kind);
  const record = one(sp.record);
  const requested = Number.parseInt(one(sp.n), 10);
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : PAGE, MAX);
  const windowDays = days === 'all' ? null : (Number.parseInt(days, 10) || DEFAULT_DAYS);

  const now = new Date();
  const filters: AccessLogFilters = {
    action: (ACCESS_ACTIONS as readonly string[]).includes(action) ? action : '',
    who: (ACCESS_ACTOR_KINDS as readonly string[]).includes(who) ? who : '',
    days: ['7', '90', 'all'].includes(days) ? days : '',
  };

  const page = await listAccessEvents(orgId, {
    action: (filters.action || undefined) as AccessAction | undefined,
    actorKind: (filters.who || undefined) as AccessActorKind | undefined,
    actorId: actor || undefined,
    recordKind: kind || undefined,
    recordId: record || undefined,
    since: windowDays === null ? undefined : new Date(now.getTime() - windowDays * 86_400_000),
    limit,
  });
  const names = await namesForAccessEvents(orgId, page.events);

  const rows: AccessLogRowData[] = page.events.map(e => ({
    key: `${e.id}`,
    at: e.at.toISOString(),
    action: e.action as AccessLogRowData['action'],
    ...recordOf(e, names),
    actor: actorLabel(e, names),
    actorKind: e.actorKind as AccessLogRowData['actorKind'],
    actorFilter: e.actorKind === 'link' ? null : e.actorId,
    forWhom: e.actorKind === 'agent' ? forWhomLabel(e.onBehalfOf, names) : null,
    run: runOf(e),
    via: viaLabel(e.via),
    detail: detailLabel(e.detail),
  }));

  const scope = actor
    ? { label: `reads by ${names.actors[actor] ?? (actor.startsWith('token:') ? tokenLabel(actor) : actor)}`, clearHref: '/dashboard/access-log' }
    : kind && record
      ? { label: `reads of ${recordOf({ recordKind: kind, recordId: record } as AccessEventRow, names).record}`, clearHref: '/dashboard/access-log' }
      : null;

  const more = new URLSearchParams();
  for (const [k, v] of Object.entries({ action: filters.action, who: filters.who, days: filters.days, actor, kind, record })) {
    if (v) {
      more.set(k, v);
    }
  }
  more.set('n', String(Math.min(limit + PAGE, MAX)));

  return (
    <ListPage title="Access log" description={description}>
      <AccessLogView
        rows={rows}
        filters={filters}
        scope={scope}
        hasMore={page.hasMore}
        moreHref={page.hasMore && limit < MAX ? `/dashboard/access-log?${more.toString()}` : null}
      />
    </ListPage>
  );
}
