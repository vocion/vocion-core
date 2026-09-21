import type { PageManifest, PageRow } from '@/libs/workspace/pages';
// Aliased at build time: the workspace's own pages/components/registry.tsx
// when it ships one, the in-repo empty stub otherwise (see next.config.ts).
import { components as wsxComponents } from '@wsx/registry';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StatusPill } from '@/components/ui/status-pill';
import { LiveRefresh } from '@/features/dashboard/LiveRefresh';
import { PageTable } from '@/features/dashboard/pages/PageTable';
import { PluginPanel } from '@/features/dashboard/plugins/PluginPanel';
import { ReviewQueue } from '@/features/dashboard/ReviewQueue';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import {
  applyFilter,
  computeSeries,
  computeStat,
  groupRows,
  pagePlugin,
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
import { inboxHref } from '@/services/inbox/inboxRef';
import { resolveRecordLinks } from '@/services/objects/recordLinks';
import { readPageForOrg } from '@/services/PluginService';
import { listPending } from '@/services/ReviewService';
import { firstParagraph } from '@/services/wiki/WikiService';
import { listWorkflowRuns } from '@/services/WorkflowService';

/**
 * Workspace page renderer — `/dashboard/p/<slug>`.
 *
 * Renders tenant-defined pages (see libs/workspace/pages.ts) as derivatives
 * of core page archetypes. The page never gets its own tables or services:
 * `list`/`queue` query data core already owns (business objects, tool calls,
 * knowledge documents), `markdown` renders prose, `report` tells one
 * record's whole story (at `/dashboard/p/<slug>/<id>` — this route is its
 * index), and custom widgets come from the workspace's own component
 * registry via the `@wsx/registry` alias.
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

  if (src.kind === 'workerRuns') {
    // What external workers DID — worker_run rows, newest first. A single
    // value for a filter goes to the service; several are applied here, so
    // the page never invents a query the service does not have.
    const { listWorkerRuns } = await import('@/services/WorkerRunService');
    const one = (xs?: string[]) => (xs?.length === 1 ? xs[0] : undefined);
    const runs = await listWorkerRuns(orgId, { agentSlug: one(src.agentSlugs), status: one(src.status), kind: one(src.kinds), limit: src.limit });
    return runs
      .filter(r => (!src.agentSlugs?.length || src.agentSlugs.includes(r.agentSlug))
        && (!src.status?.length || src.status.includes(r.status))
        && (!src.kinds?.length || src.kinds.includes(r.kind)))
      .map(r => ({
        id: r.id,
        title: r.summary?.split('\n')[0] ?? `${r.kind} run #${r.id}`,
        status: r.status,
        createdAt: r.createdAt,
        meta: {
          agentSlug: r.agentSlug,
          kind: r.kind,
          status: r.status,
          model: r.model,
          attempt: r.attempt,
          cents: r.cents,
          tokens: r.tokens,
          summary: r.summary,
          error: r.error,
          createdAt: r.createdAt,
          claimedAt: r.claimedAt,
          completedAt: r.completedAt,
          // The live signal (docs/entities/worker-run.md): every heartbeat
          // moves these, so a live page can show a run breathing.
          heartbeatAt: r.heartbeatAt,
          leaseExpiresAt: r.leaseExpiresAt,
          endsAt: r.endsAt,
          progress: r.progress,
          stopRequested: r.stopRequested,
          capCents: r.capCents,
          counts: r.counts,
          result: r.result ?? {},
          input: r.input,
        },
      }));
  }

  if (src.kind === 'artifacts') {
    // What agents and people MADE — the artifact log, by folder and/or kind.
    // A wiki page is a markdown artifact in the `wiki` folder; `meta` carries
    // the columns a page's fields read (version, author kind, updated, playbook).
    const { listArtifacts } = await import('@/services/ArtifactService');
    const items = await listArtifacts({ orgId, folder: src.folder ?? null, kinds: src.artifactKind ? [src.artifactKind] : null, limit: src.limit, visibility: 'all' });
    return items.map(a => ({
      id: a.id,
      title: a.title,
      status: a.kind,
      createdAt: new Date(a.createdAt),
      meta: {
        kind: a.kind,
        folder: a.folder,
        version: a.version,
        lastAuthorKind: a.authorKind,
        updatedAt: new Date(a.updatedAt),
        summary: (a.spec as { summary?: string }).summary ?? firstParagraph(String((a.spec as { md?: string }).md ?? '')),
        playbook: (a.spec as { playbook?: string }).playbook,
        recordType: a.recordType,
        recordId: a.recordId,
        versions: a.versions,
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

async function loadPendingActions(orgId: string, actionIds?: string[]) {
  // Agent-proposed actions awaiting a person — the same rows /dashboard/inbox?kind=proposal
  // decides. `skills` on the review config scopes to action ids (gmail.send…).
  const items = await listPending(orgId, { kind: 'action' });
  return items.filter(i => !actionIds?.length || actionIds.some(a => i.title.includes(a) || String(i.id) === a));
}

/**
 * Now, read once per render — `Date.now()` counts as impure inside a render
 * (the automation page does the same), and one instant keeps every
 * `relative` cell on the page agreeing with the others.
 */
async function currentTime(): Promise<number> {
  return Date.now();
}

/**
 * A `series` strip: one column per bucket, oldest first, one row per measure.
 * A table rather than a chart on purpose — the figures are the point, and a
 * server component draws it with nothing to load.
 * @param root0
 * @param root0.series
 */
function SeriesStrip({ series }: { series: ReturnType<typeof computeSeries> }) {
  return (
    <section className="mb-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-2 text-xs font-medium text-muted-foreground">{series.label}</th>
            {series.buckets.map(b => (
              <th key={b} className="px-4 py-2 text-right text-xs font-medium text-muted-foreground tabular-nums">{b}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.measures.map(m => (
            <tr key={m.label} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2 text-xs text-muted-foreground">{m.label}</td>
              {m.values.map((v, i) => (
                <td key={`${m.label}-${series.buckets[i]}`} className="px-4 py-2 text-right font-mono text-sm tabular-nums">{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
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
    // A valid session with no organization here — typically a cookie from a
    // sibling localhost app (shared AUTH_SECRET). A bare 404 hides the cause;
    // sign the session out so the next visit lands on this app's sign-in.
    redirect('/api/auth/signout?callbackUrl=/sign-in');
  }

  // Scoped by the project like the rows below it: a plugin this project turned
  // on shows its pages here even when the mounted workspace never named it.
  const manifest = await readPageForOrg(slug, orgId);
  if (!manifest) {
    return notFound();
  }
  // A link page is a nav row for a core route; the route is the page.
  if (manifest.archetype === 'link' && manifest.href) {
    redirect(manifest.href);
  }

  const content = readWorkspacePageContent(manifest);
  const now = await currentTime();

  let rows: PageRow[] = [];
  if (manifest.archetype !== 'markdown' && manifest.archetype !== 'report' && manifest.source) {
    rows = applyFilter(await loadRows(manifest, orgId), manifest.filters, new Date(now));
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
  // same approve/decline services as /dashboard/inbox — one queue.
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
    stats[s.label] = computeStat(rows, s, new Date(now));
  }
  const series = (manifest.series ?? []).map(sr => computeSeries(rows, sr, new Date(now)));

  const groups: Array<{ label: string | null; rows: PageRow[] }> = manifest.groupBy
    ? groupRows(rows, manifest.groupBy)
    : [{ label: null, rows }];

  // Which plugin shipped this page, if any — the panel's slug.
  const ownedBy = pagePlugin(manifest);

  const fields = manifest.fields ?? [
    { key: 'title', label: 'Title', format: 'text' as const, total: false, priority: 1, hideWhenConstant: false },
    { key: 'status', label: 'Status', from: 'status', format: 'badge' as const, total: false, priority: 1, hideWhenConstant: false },
  ];

  // Every `link` column that names a target type, resolved to that record's
  // own title in one query per type, so a row carries the request it came
  // from rather than the request's id.
  const links = await resolveRecordLinks(
    orgId,
    rows.flatMap(r => fields
      .filter(f => f.format === 'link' && f.to)
      .flatMap((f) => {
        const v = resolveField(r, f.from ?? f.key);
        return (Array.isArray(v) ? v : [v]).map(one => ({ to: f.to!, value: one }));
      })),
  );

  return (
    <>
      <TitleBar
        title={manifest.title}
        description={manifest.description}
        actions={manifest.live ? <LiveRefresh everyMs={manifest.live.every * 1000} /> : undefined}
      />

      {/* A page a plugin shipped carries that plugin's outcome panel — the
          same one the Proposals and Data rooms surfaces carry, decided by
          where the YAML came from rather than by the page's slug. */}
      {ownedBy && <PluginPanel orgId={orgId} slug={ownedBy} />}

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

      {series.map(sr => <SeriesStrip key={sr.label} series={sr} />)}

      <Widgets manifest={manifest} position="above" rows={rows} stats={stats} />

      {manifest.archetype === 'report' && (
        <p className="max-w-2xl text-sm text-muted-foreground">
          A report is about one record. Open it from a row on
          {' '}
          <Link href="/dashboard/p/backlog" className="underline">the Backlog</Link>
          {' '}
          — or go straight to
          {' '}
          <code className="font-mono">
            /dashboard/p/
            {manifest.slug}
            /&lt;id&gt;
          </code>
          .
        </p>
      )}

      {manifest.archetype !== 'markdown' && manifest.archetype !== 'report' && groups.map((g, gi) => (
        <PageTable
          key={g.label ?? '__all'}
          id={gi === 0 ? 'wsx-table' : undefined}
          rows={g.rows}
          fields={fields}
          primary={manifest.primary}
          rowLink={manifest.rowLink}
          rowActions={manifest.rowActions}
          groupLabel={g.label}
          now={now}
          links={links}
        />
      ))}

      {reviewCfg && (
        <section id="wsx-review" className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">{reviewCfg.heading ?? 'Waiting on a person'}</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            The same items as
            {' '}
            <Link href="/dashboard/inbox?kind=proposal" className="underline">Review queue</Link>
            {' '}
            — the core decision list, scoped to this page. Approve or decline here or there; it is one queue.
          </p>
          {pendingActions.length > 0
            ? (
                <ul className="mb-4 divide-y divide-border rounded-md border border-border">
                  {pendingActions.map(a => (
                    <li key={`${a.kind}-${a.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="font-medium">{a.title}</span>
                      <StatusPill status="pending" size="sm" />
                      <Link href={a.kind === 'action' ? inboxHref('proposal', a.id) : '/dashboard/inbox?kind=run'} className="ml-auto text-xs underline">Decide</Link>
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
