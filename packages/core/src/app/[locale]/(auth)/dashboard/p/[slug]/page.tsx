import type React from 'react';
import type { PageField, PageManifest, PageRow } from '@/libs/workspace/pages';
// Aliased at build time: the workspace's own pages/components/registry.tsx
// when it ships one, the in-repo empty stub otherwise (see next.config.ts).
import { components as wsxComponents } from '@wsx/registry';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { ReviewQueue } from '@/features/dashboard/ReviewQueue';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import {
  applyFilter,
  computeStat,
  readWorkspacePage,
  readWorkspacePageContent,
  resolveField,
} from '@/libs/workspace/pages';
import {
  agentSchema,
  businessObjectSchema,
  businessObjectTypeSchema,
  knowledgeDocumentSchema,
  knowledgeSourceSchema,
  toolCallSchema,
} from '@/models/Schema';
import { listPending } from '@/services/ReviewService';
import { listWorkflowRuns } from '@/services/WorkflowService';

/**
 * Workspace page renderer — `/dashboard/p/<slug>`.
 *
 * Renders tenant-defined pages (see libs/workspace/pages.ts) as derivatives
 * of core page archetypes. The page never gets its own tables or services:
 * `list`/`queue` query data core already owns (business objects, tool calls,
 * knowledge documents), `markdown` renders prose, and custom widgets come
 * from the workspace's own component registry via the `@wsx/registry` alias.
 */

async function loadRows(manifest: PageManifest, orgId: string): Promise<PageRow[]> {
  const src = manifest.source;
  if (!src) {
    return [];
  }

  if (src.kind === 'objects') {
    const objType = await db.query.businessObjectTypeSchema.findFirst({
      where: and(eq(businessObjectTypeSchema.slug, src.objectType), eq(businessObjectTypeSchema.orgId, orgId)),
    });
    if (!objType) {
      return [];
    }
    const rows = await db.query.businessObjectSchema.findMany({
      where: eq(businessObjectSchema.typeId, objType.id),
    });
    return rows.map(r => ({
      id: r.id,
      title: r.title,
      status: r.status ?? null,
      createdAt: r.createdAt ?? null,
      meta: (r.metadata ?? {}) as Record<string, unknown>,
    }));
  }

  if (src.kind === 'skillRuns') {
    // The operations layer is gone (core@2.0): what an agent DID is the
    // tool_call log. `skills` scopes to tool names; status is done/failed.
    const conds = [eq(toolCallSchema.orgId, orgId)];
    if (src.skills?.length) {
      conds.push(inArray(toolCallSchema.tool, src.skills));
    }
    const calls = await db.query.toolCallSchema.findMany({
      where: and(...conds),
      orderBy: desc(toolCallSchema.createdAt),
      limit: src.limit,
    });
    return calls
      .map(c => ({ ...c, status: c.error ? 'failed' : 'completed' }))
      .filter(c => !src.status?.length || src.status.includes(c.status))
      .map((c) => {
        let parsed: Record<string, unknown> = {};
        if (c.output) {
          try {
            const j = JSON.parse(c.output);
            if (j && typeof j === 'object') {
              parsed = j as Record<string, unknown>;
            }
          } catch { /* output is prose — leave meta empty */ }
        }
        return {
          id: c.id,
          title: String((c.input as Record<string, unknown> | null)?.title ?? `${c.tool} · ${c.agentSlug}`),
          status: c.status,
          createdAt: c.createdAt ?? null,
          meta: { ...parsed, tool: c.tool, agent: c.agentSlug, error: c.error, input: c.input },
        };
      });
  }

  if (src.kind === 'agents') {
    const agents = await db.query.agentSchema.findMany({
      where: eq(agentSchema.orgId, orgId),
    });
    return agents
      .filter(a => src.active === undefined || (String(a.active) === 'true') === src.active)
      .map(a => ({
        id: a.slug,
        title: a.name,
        status: String(a.active) === 'true' ? 'active' : 'inactive',
        createdAt: a.createdAt ?? null,
        meta: {
          slug: a.slug,
          description: a.description,
          role: a.role,
          team: a.team,
          model: a.model,
        },
      }));
  }

  // documents
  const source = await db.query.knowledgeSourceSchema.findFirst({
    where: and(eq(knowledgeSourceSchema.slug, src.source), eq(knowledgeSourceSchema.orgId, orgId)),
  });
  if (!source) {
    return [];
  }
  const docs = await db.query.knowledgeDocumentSchema.findMany({
    where: eq(knowledgeDocumentSchema.sourceId, source.id),
    orderBy: desc(knowledgeDocumentSchema.ingestedAt),
    limit: src.limit,
  });
  return docs.map(d => ({
    id: d.id,
    title: d.title ?? `doc ${d.id}`,
    status: null,
    createdAt: d.ingestedAt ?? null,
    meta: { ...(d.metadata ?? {}), externalId: d.externalId },
  }));
}

type PillStatus = React.ComponentProps<typeof StatusPill>['status'];

async function loadPendingActions(orgId: string, actionIds?: string[]) {
  // Agent-proposed actions awaiting a person — the same rows /dashboard/review
  // decides. `skills` on the review config scopes to action ids (gmail.send…).
  const items = await listPending(orgId, { kind: 'action' });
  return items.filter(i => !actionIds?.length || actionIds.some(a => i.title.includes(a) || String(i.id) === a));
}

function toneToStatus(tone: string): PillStatus {
  switch (tone) {
    case 'ok':
      return 'completed';
    case 'warn':
      return 'pending';
    case 'bad':
      return 'failed';
    case 'info':
      return 'running';
    default:
      return 'inactive';
  }
}

function Cell({ row, field }: { row: PageRow; field: PageField }) {
  const raw = resolveField(row, field.from ?? field.key);
  if (raw === undefined || raw === null || raw === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  const s = String(raw);
  switch (field.format) {
    case 'badge': {
      const tone = field.tones?.[s];
      return tone
        ? <StatusPill status={toneToStatus(tone)} label={s} size="sm" />
        : <Badge variant="outline">{s}</Badge>;
    }
    case 'score': {
      const n = Number(raw);
      const cls = n >= 85 ? 'text-emerald-600' : n >= 70 ? 'text-foreground' : n >= 60 ? 'text-amber-600' : 'text-muted-foreground';
      return <span className={`font-mono text-sm font-semibold tabular-nums ${cls}`}>{Number.isFinite(n) ? n : s}</span>;
    }
    case 'date':
      return <span className="text-sm text-muted-foreground">{raw instanceof Date ? raw.toLocaleDateString() : s}</span>;
    case 'mono':
      return <span className="font-mono text-xs">{s}</span>;
    default:
      return <span className="text-sm">{s}</span>;
  }
}

function Widgets({ manifest, position, rows, stats }: {
  manifest: PageManifest;
  position: 'above' | 'below';
  rows: PageRow[];
  stats: Record<string, string>;
}) {
  const widgets = manifest.widgets.filter(w => w.position === position);
  if (!widgets.length) {
    return null;
  }
  return (
    <div id={`wsx-widgets-${position}`} className="my-6 space-y-6">
      {widgets.map((w, i) => {
        const Comp = wsxComponents[w.component];
        if (!Comp) {
          return (
            <div key={`${w.component}-${i}`} className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              Widget
              {' '}
              <code className="font-mono">{w.component}</code>
              {' '}
              is not exported from this workspace's pages/components/registry.tsx.
            </div>
          );
        }
        const extra: Record<string, unknown> = { ...(w.props ?? {}) };
        if (w.data.includes('rows')) {
          extra.rows = rows;
        }
        if (w.data.includes('stats')) {
          extra.stats = stats;
        }
        return (
          <section key={`${w.component}-${i}`}>
            {w.title && <h2 className="mb-3 text-sm font-semibold">{w.title}</h2>}
            <Comp {...extra} />
          </section>
        );
      })}
    </div>
  );
}

export default async function WorkspacePage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return notFound();
  }

  const manifest = readWorkspacePage(slug);
  if (!manifest) {
    return notFound();
  }

  const content = readWorkspacePageContent(manifest);

  let rows: PageRow[] = [];
  if (manifest.archetype !== 'markdown' && manifest.source) {
    rows = applyFilter(await loadRows(manifest, orgId), manifest.filters);
    if (manifest.sort) {
      const { field, dir } = manifest.sort;
      rows.sort((a, b) => {
        const av = resolveField(a, field);
        const bv = resolveField(b, field);
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av ?? '').localeCompare(String(bv ?? ''));
        return dir === 'asc' ? cmp : -cmp;
      });
    }
  }

  // Review embed (the actual HITL mechanism): explicit `review:` block on any
  // archetype, or implicit on `queue` from its source skills. Same items,
  // same approve/decline services as /dashboard/review — one queue.
  const reviewCfg = manifest.review
    ?? (manifest.archetype === 'queue' && manifest.source?.kind === 'skillRuns'
      ? { skills: manifest.source.skills, workflows: false, heading: 'Waiting on a person' }
      : null);
  let pendingActions: Awaited<ReturnType<typeof loadPendingActions>> = [];
  let pausedWorkflowRuns: Awaited<ReturnType<typeof listWorkflowRuns>> = [];
  if (reviewCfg) {
    pendingActions = await loadPendingActions(orgId, reviewCfg.skills);
    if (reviewCfg.workflows) {
      pausedWorkflowRuns = await listWorkflowRuns(orgId, { status: 'paused', limit: 50 });
    }
  }

  const stats: Record<string, string> = {};
  for (const s of manifest.stats ?? []) {
    stats[s.label] = computeStat(rows, s);
  }

  const groups: Array<{ label: string | null; rows: PageRow[] }> = manifest.groupBy
    ? [...rows.reduce((m, r) => {
        const k = String(resolveField(r, manifest.groupBy!) ?? '—');
        m.set(k, [...(m.get(k) ?? []), r]);
        return m;
      }, new Map<string, PageRow[]>())].map(([label, rs]) => ({ label, rows: rs }))
    : [{ label: null, rows }];

  const fields = manifest.fields ?? [
    { key: 'title', label: 'Title', format: 'text' as const },
    { key: 'status', label: 'Status', from: 'status', format: 'badge' as const },
  ];

  return (
    <>
      <TitleBar title={manifest.title} description={manifest.description} />

      {content && manifest.archetype === 'markdown' && (
        <article className="prose prose-sm max-w-3xl dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      )}
      {content && manifest.archetype !== 'markdown' && (
        <div className="mb-6 max-w-3xl text-sm text-muted-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}

      {Object.keys(stats).length > 0 && (
        <div id="wsx-stats" className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
          {Object.entries(stats).map(([label, value]) => (
            <div key={label} className="bg-background p-4">
              <div className="font-mono text-2xl font-semibold tabular-nums">{value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      )}

      <Widgets manifest={manifest} position="above" rows={rows} stats={stats} />

      {manifest.archetype !== 'markdown' && groups.map((g, gi) => (
        <section key={g.label ?? '__all'} id={gi === 0 ? 'wsx-table' : undefined} className="mb-8">
          {g.label && (
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {g.label}
              <Badge variant="outline">{g.rows.length}</Badge>
            </h2>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {fields.map(f => (
                    <th key={f.key} className="px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {f.label ?? f.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.length === 0 && (
                  <tr>
                    <td colSpan={fields.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nothing here yet.
                    </td>
                  </tr>
                )}
                {g.rows.map(row => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    {fields.map((f, fi) => (
                      <td key={f.key} className="px-4 py-2.5">
                        {fi === 0 && manifest.rowLink
                          ? (
                              <Link href={manifest.rowLink.replace('{id}', String(row.id)) as never} className="font-medium hover:underline">
                                <Cell row={row} field={f} />
                              </Link>
                            )
                          : <Cell row={row} field={f} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {reviewCfg && (
        <section id="wsx-review" className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">{reviewCfg.heading ?? 'Waiting on a person'}</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            The same items as
            {' '}
            <Link href="/dashboard/review" className="underline">Review</Link>
            {' '}
            — the core approval queue, scoped to this page. Approve or decline here or there; it is one queue.
          </p>
          {pendingActions.length > 0
            ? (
                <ul className="mb-4 divide-y divide-border rounded-md border border-border">
                  {pendingActions.map(a => (
                    <li key={`${a.kind}-${a.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="font-medium">{a.title}</span>
                      <StatusPill status="pending" size="sm" />
                      <Link href="/dashboard/review" className="ml-auto text-xs underline">Decide in Review</Link>
                    </li>
                  ))}
                </ul>
              )
            : (
                <p className="mb-4 text-sm text-muted-foreground">Nothing is waiting on a person right now.</p>
              )}
          {pausedWorkflowRuns.length > 0 && <ReviewQueue initialWorkflowRuns={pausedWorkflowRuns} />}
        </section>
      )}

      <Widgets manifest={manifest} position="below" rows={rows} stats={stats} />
    </>
  );
}
