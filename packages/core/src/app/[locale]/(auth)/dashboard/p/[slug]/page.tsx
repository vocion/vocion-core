import type { PageField, PageManifest, PageRow, PageView, PageWindow } from '@/libs/workspace/pages';
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
import { PageBlocks } from '@/features/dashboard/pages/PageBlocks';
import { PageGroupTabs } from '@/features/dashboard/pages/PageGroupTabs';
import { PageTable } from '@/features/dashboard/pages/PageTable';
import { PluginPanel } from '@/features/dashboard/plugins/PluginPanel';
import { ReviewQueue } from '@/features/dashboard/ReviewQueue';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { WikiView } from '@/features/dashboard/wiki/WikiView';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { activeQueryFilters, applyQueryFilters } from '@/libs/workspace/pageFields';
import {
  applyFilter,
  applyWindow,
  chosenWindow,
  computeSeries,
  computeStat,
  computeStatChange,
  groupRows,
  isZeroFigure,
  pagePlugin,
  readWorkspacePageContent,
  readWorkspacePageMethodology,
  resolveField,
} from '@/libs/workspace/pages';
import { deriveProductBoard } from '@/libs/workspace/productBoard';
import { deriveReleaseOutcome } from '@/libs/workspace/releaseOutcome';
import { deriveWorkQueue } from '@/libs/workspace/workQueue';
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
import { resolveRowImages } from '@/services/workspace/pageImages';

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
    const { recoveryLabel, resolveRunRequestId, taskRecordId, withRunRecovery } = await import('@/libs/factory/runFacts');
    const one = (xs?: string[]) => (xs?.length === 1 ? xs[0] : undefined);
    const runs = await listWorkerRuns(orgId, { agentSlug: one(src.agentSlugs), status: one(src.status), kind: one(src.kinds), limit: src.limit });
    const kept = runs
      .filter(r => (!src.agentSlugs?.length || src.agentSlugs.includes(r.agentSlug))
        && (!src.status?.length || src.status.includes(r.status))
        && (!src.kinds?.length || src.kinds.includes(r.kind)));
    // The request a run's task serves is its engineering_task's own
    // `metadata.requestId`, never the free-text `request_id` a contract's
    // author wrote into `input.task` for their own bookkeeping (it can read
    // like a request or like an incident, and it is neither an id nor
    // reliable: this is what sent Activity's Outcome link to a 404).
    // Batched once for every task this page's runs name, rather than once
    // per row.
    const taskIds = [...new Set(kept.map(r => taskRecordId(r)).filter((tid): tid is string => tid !== null).map(Number))];
    const requestIdByTask = new Map<number, number | null>();
    if (taskIds.length > 0) {
      const taskType = await db.query.businessObjectTypeSchema.findFirst({
        where: and(eq(businessObjectTypeSchema.slug, 'engineering_task'), eq(businessObjectTypeSchema.orgId, orgId)),
      });
      if (taskType) {
        const taskRows = await db.query.businessObjectSchema.findMany({
          where: and(eq(businessObjectSchema.typeId, taskType.id), inArray(businessObjectSchema.id, taskIds)),
        });
        for (const taskRow of taskRows) {
          const taskMeta = (taskRow.metadata ?? {}) as Record<string, unknown>;
          const n = Number(taskMeta.requestId);
          requestIdByTask.set(taskRow.id, Number.isInteger(n) && n > 0 ? n : null);
        }
      }
    }
    // The four concepts `status` was carrying, read once here so every field,
    // stat and group on every page sees the same answer (libs/factory/runFacts.ts).
    return withRunRecovery(kept)
      .map((r) => {
        const taskId = taskRecordId(r);
        return {
          id: r.id,
          title: r.facts.headline,
          status: r.status,
          createdAt: r.createdAt ?? null,
          meta: {
          // The honest reading: four independent facts, none contradicting
          // the one beside it, plus why it went wrong and whether the factory
          // fixed it without anyone asking.
            execution: r.facts.execution,
            verification: r.facts.verification,
            output: r.facts.output,
            outputUrl: r.facts.outputUrl,
            disposition: r.disposition,
            failureClass: r.facts.failureClass,
            successful: r.facts.successful,
            recovery: r.recovery.kind,
            recoveryNote: recoveryLabel(r.recovery),
            headline: r.facts.headline,
            checks: r.facts.checksTotal > 0 ? `${r.facts.checksPassed}/${r.facts.checksTotal}` : null,
            filesChanged: r.facts.filesChanged,
            taskKey: r.taskKey,
            taskRecordId: taskId,
            requestId: resolveRunRequestId(r, requestIdByTask),
            durationSeconds: r.claimedAt && r.completedAt
              ? Math.max(0, Math.round((r.completedAt.getTime() - r.claimedAt.getTime()) / 1000))
              : null,
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
        };
      });
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

/**
 * The row of views above a page that declared them.
 *
 * A view that narrows these rows is a query on this page; a view that names
 * another surface is a link to it. Both are drawn the same because the
 * question is the same one ("what happened"), and the difference is in where
 * the click lands rather than in a second navigation pattern.
 * @param root0 - Props.
 * @param root0.views - The declared views.
 * @param root0.active - The view in force.
 * @param root0.slug - The page, for the `?view=` links.
 */
function ViewSwitcher({ views, active, slug }: { views: PageView[]; active: PageView; slug: string }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1" aria-label="Views" data-testid="page-views">
      {views.map((v) => {
        const on = v.key === active.key;
        const href = v.href ?? (v.key === views[0]!.key ? `/dashboard/p/${slug}` : `/dashboard/p/${slug}?view=${v.key}`);
        return (
          <Link
            key={v.key}
            href={href}
            aria-current={on ? 'page' : undefined}
            className={`rounded-md px-2.5 py-1 text-xs ${on ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}
          >
            {v.label}
          </Link>
        );
      })}
    </nav>
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

/**
 * The page's one time window, as links rather than a control: a server
 * component renders the chosen span, and every other span is a URL someone
 * can bookmark, send, or open in a second tab beside the first.
 * @param props - The picker.
 * @param props.slug - The page, for the links it renders.
 * @param props.window - The declared field, choices and default.
 * @param props.chosen - The span in force, in days, or `all`.
 */
function WindowPicker({ slug, window, chosen }: { slug: string; window: PageWindow; chosen: number | 'all' }) {
  const choices: Array<{ value: number | 'all'; label: string }> = [
    ...window.options.map(d => ({ value: d as number | 'all', label: `${d} days` })),
    { value: 'all' as const, label: 'All time' },
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">
        {window.label ?? 'Window'}
        :
      </span>
      {choices.map(c => (
        <Link
          key={String(c.value)}
          href={`/dashboard/p/${slug}?days=${c.value}`}
          aria-current={c.value === chosen ? 'true' : undefined}
          className={c.value === chosen
            ? 'rounded-full border border-foreground px-2 py-0.5 font-medium'
            : 'rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground'}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}

export default async function WorkspacePage(props: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await props.params;
  const searchParams = await props.searchParams;
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

  // A WIKI IS READ AS PAGES, not as a table of the artifacts behind them: a
  // rail of pages in reading order, the home, one page open at a time
  // (`/dashboard/p/<slug>/<page>`), links between pages that open pages.
  // Chris, 2026-09-24: "make it look more like a wiki than a collection of
  // artifacts table." The folder comes from the manifest; the plugin's guide
  // page, when it ships one beside it, is linked from the rail.
  if (manifest.archetype === 'wiki' && manifest.source?.kind === 'artifacts' && manifest.source.folder) {
    const { loadWikiReadingPages } = await import('@/services/wiki/wikiReading');
    const { WIKI_HOME_SLUGS } = await import('@/libs/wiki/reading');
    // The home's body rides in full; every other page's arrives when opened.
    const all = await loadWikiReadingPages(orgId, manifest.source.folder, { withBodyFor: null });
    const homeSlug = (WIKI_HOME_SLUGS as readonly string[]).find(h => all.some(p => p.slug === h)) ?? null;
    const pages = homeSlug ? await loadWikiReadingPages(orgId, manifest.source.folder, { withBodyFor: homeSlug }) : all;
    const home = homeSlug ? pages.find(p => p.slug === homeSlug) ?? null : null;
    const guide = await readPageForOrg(`${manifest.slug}-guide`, orgId);
    return (
      <>
        <TitleBar title={manifest.title} description={manifest.description} />
        <WikiView
          base={`/dashboard/p/${manifest.slug}`}
          pages={pages}
          current={home}
          guideHref={guide ? `/dashboard/p/${guide.slug}` : null}
          askAgentSlug="wiki-researcher"
          editBase="/dashboard/artifacts"
        />
      </>
    );
  }

  const content = readWorkspacePageContent(manifest);
  const methodology = readWorkspacePageMethodology(manifest);
  const now = await currentTime();
  const days = chosenWindow(manifest.window, typeof searchParams.days === 'string' ? searchParams.days : undefined);

  // The view in force. A `?view=` naming a view that links elsewhere, or no
  // view at all, falls back to the first one declared, which is the default
  // by construction.
  const queryFilters = activeQueryFilters(manifest.queryFilters, searchParams);
  const views = manifest.views ?? null;
  const asked = typeof searchParams.view === 'string' ? searchParams.view : undefined;
  const activeView = views ? (views.find(v => v.key === asked && v.href === undefined) ?? views[0]!) : null;

  let rows: PageRow[] = [];
  if (manifest.archetype !== 'markdown' && manifest.archetype !== 'report' && manifest.source) {
    // A named derivation runs FIRST, over every row: it is what turns stored
    // states into the lanes and sentences the page is declared in, and it
    // needs the whole set to count what it then leaves out.
    // A URL filter narrows the rows BEFORE the derivation counts them, so a
    // lane note under "Send only" counts Send, not the whole factory (Chris,
    // 2026-09-24: "3 to decide · 5 more queued" over four rows).
    const loaded = applyQueryFilters(await loadRows(manifest, orgId), queryFilters);
    const derived = manifest.derive === 'workQueue'
      ? deriveWorkQueue(loaded, { now: new Date(now) })
      : manifest.derive === 'releaseOutcome'
        ? deriveReleaseOutcome(loaded, { now: new Date(now) })
        : manifest.derive === 'productBoard'
          ? deriveProductBoard(loaded, { now: new Date(now) })
          : loaded;
    // A picture a row names by id becomes a picture the page can draw. One
    // query for the whole page, after the derivation has chosen WHICH visual
    // each row shows (`services/workspace/pageImages.ts`).
    const drawn = await resolveRowImages(orgId, derived, manifest.fields ?? []);
    rows = applyFilter(drawn, [...(manifest.filters ?? []), ...(activeView?.filters ?? [])], new Date(now));
    if (manifest.sort) {
      const { field, dir } = manifest.sort;
      rows.sort((a, b) => {
        const av = resolveField(a, field);
        const bv = resolveField(b, field);
        // A row the field is missing from sorts last whichever way the page
        // sorts. Comparing it as the string "undefined" put the rows with no
        // figure at the top of a page sorted by cost, which is the opposite
        // of naming the most expensive work.
        const ae = av === undefined || av === null || av === '';
        const be = bv === undefined || bv === null || bv === '';
        if (ae || be) {
          return ae && be ? 0 : ae ? 1 : -1;
        }
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
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

  // One window, obeyed by the rows and by every stat that has not marked
  // itself lifetime. A page whose figures run on different periods cannot be
  // compared with itself, which is the whole point of showing them together.
  const windowed = applyWindow(rows, manifest.window, days, new Date(now));

  const stats: Record<string, string> = {};
  // `windowed` for a stat that obeys the page's window, `rows` for one that
  // declared itself `lifetime`; either way, `hideWhenZero` still drops a
  // figure that came out to nothing.
  const statCards = (manifest.stats ?? [])
    .map(s => ({
      stat: s,
      value: computeStat(s.lifetime ? rows : windowed, s, new Date(now)),
      // A figure that opted into `compare` is computed again over the period
      // before it. `rows` and not `windowed`: the prior period lives OUTSIDE
      // the chosen window, so handing it the windowed set would compare the
      // period against nothing every time.
      change: s.lifetime ? null : computeStatChange(rows, s, manifest.window, days, new Date(now)),
    }))
    .filter(({ stat, value }) => !(stat.hideWhenZero && isZeroFigure(value)));
  for (const card of statCards) {
    stats[card.stat.label] = card.value;
  }
  const statGroups: Array<{ label: string | null; cards: typeof statCards }> = [];
  for (const card of statCards) {
    const label = card.stat.group ?? null;
    const existing = statGroups.find(g => g.label === label);
    if (existing) {
      existing.cards.push(card);
    } else {
      statGroups.push({ label, cards: [card] });
    }
  }
  const series = (manifest.series ?? []).map(sr => computeSeries(windowed, sr, new Date(now)));

  const groups: Array<{ label: string | null; rows: PageRow[] }> = manifest.groupBy
    ? groupRows(windowed, manifest.groupBy)
    : [{ label: null, rows: windowed }];

  // Which plugin shipped this page, if any — the panel's slug.
  const ownedBy = pagePlugin(manifest);

  const fields: PageField[] = manifest.fields ?? [
    { key: 'title', label: 'Title', format: 'text', total: false, priority: 1, hideWhenConstant: false, detail: false, hideWhenEmpty: true },
    { key: 'status', label: 'Status', from: 'status', format: 'badge', total: false, priority: 1, hideWhenConstant: false, detail: false, hideWhenEmpty: true },
  ];

  // Every `link` column that names a target type, resolved to that record's
  // own title in one query per type, so a row carries the request it came
  // from rather than the request's id.
  const links = await resolveRecordLinks(
    orgId,
    windowed.flatMap(r => fields
      .filter(f => f.format === 'link' && f.to)
      .flatMap((f) => {
        const v = resolveField(r, f.from ?? f.key);
        return (Array.isArray(v) ? v : [v]).map(one => ({ to: f.to!, value: one }));
      })),
  );

  // A page with rows IS its rows. The plugin's outcome panel and the prose
  // explaining how the figures are computed are both true and both worth
  // keeping, and both used to sit between the reader and the thing they
  // opened the page for: five measures, four agents, twelve skills and an
  // essay above two products. So on a page whose whole point is a list,
  // they move underneath it, and the prose goes behind "About this data":
  // the method is evidence about the rows, and evidence is level three.
  const rowsLead = manifest.archetype === 'list' || manifest.archetype === 'queue';
  const pluginPanel = ownedBy ? <PluginPanel orgId={orgId} slug={ownedBy} /> : null;
  const about = content && manifest.archetype !== 'markdown'
    ? (
        rowsLead
          ? (
              <details className="mt-8 border-t border-border/70 pt-4">
                <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground hover:text-foreground">About this data</summary>
                <div className="mt-3 max-w-3xl text-sm text-muted-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
              </details>
            )
          : (
              <div className="mb-6 max-w-3xl text-sm text-muted-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            )
      )
    : null;

  // A summary is drawn once it is summarising enough rows to save the reader
  // reading them. See `statsMinRows`.
  const showStats = rows.length >= manifest.statsMinRows;

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
      {!rowsLead && pluginPanel}

      {content && manifest.archetype === 'markdown' && (
        <article className="prose prose-sm max-w-3xl dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      )}
      {!rowsLead && about}

      {views && activeView && <ViewSwitcher views={views} active={activeView} slug={manifest.slug} />}
      {queryFilters.length > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="page-query-filters">
          {queryFilters.map(f => (
            <span key={f.param} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
              <span className="text-foreground">{f.value.charAt(0).toUpperCase() + f.value.slice(1)}</span>
              {' '}
              only
            </span>
          ))}
          <Link href={`/dashboard/p/${manifest.slug}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">Show all</Link>
        </p>
      )}
      {activeView?.note && <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{activeView.note}</p>}

      {manifest.window && (
        <WindowPicker slug={manifest.slug} window={manifest.window} chosen={days} />
      )}

      {showStats && statGroups.map((g, gi) => (
        <div key={g.label ?? '__headline'} className="mb-6">
          {g.label && <h2 className="mb-2 text-sm font-semibold">{g.label}</h2>}
          <div
            id={gi === 0 ? 'wsx-stats' : undefined}
            className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4"
          >
            {g.cards.map(({ stat: s, value, change }) => (
              <div key={s.label} className="bg-background p-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
                  {/* The direction, where the stat asked for one. A figure on
                      its own is nearly unreadable — "$1.28 per release" says
                      almost nothing, "$1.28 ↓ 38%" says the thing a reader
                      came for. Colour only where the page declared which way
                      is GOOD: cost falling is good, quality falling is not,
                      and arithmetic cannot tell them apart. */}
                  {change?.percent !== null && change !== null && change.direction !== 'flat' && (
                    <span
                      data-testid={`stat-change-${s.label}`}
                      className={`font-mono text-xs tabular-nums ${
                        change.good === null
                          ? 'text-muted-foreground'
                          : change.good
                            ? 'text-[var(--brand-ok,#15803d)]'
                            : 'text-[var(--brand-fail,#b91c1c)]'
                      }`}
                    >
                      {change.direction === 'up' ? '↑' : '↓'}
                      {' '}
                      {Math.abs(Math.round(change.percent))}
                      %
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
                {change && change.percent !== null && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {`was ${change.prior}`}
                  </div>
                )}
                {/* "What this counts" no longer sits under every figure.
                    A page that explains each of its own numbers inline reads
                    as a system describing itself rather than a product
                    stating a fact, and it buried the figures under prose on a
                    phone. The note stays on the stat as DATA — it is what a
                    methodology page is written from, and what a test asserts
                    every figure can answer — it simply is not lecture. */}
              </div>
            ))}
          </div>
        </div>
      ))}

      {series.map(sr => <SeriesStrip key={sr.label} series={sr} />)}

      {methodology && (
        <details className="mb-6 max-w-3xl rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">How these numbers are computed</summary>
          <div className="prose prose-sm mt-3 max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{methodology}</ReactMarkdown>
          </div>
        </details>
      )}

      <Widgets manifest={manifest} position="above" rows={windowed} stats={stats} />

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

      {manifest.showRows && manifest.archetype !== 'markdown' && manifest.archetype !== 'report' && (() => {
        const Rows = manifest.layout === 'block' ? PageBlocks : PageTable;
        // Tabs are the groups, so the panel never draws the group's heading
        // again inside itself, and the lane's note rides on the panel rather
        // than growing the tab into a sentence.
        const tabbed = manifest.groupsAs === 'tabs' && groups.length > 1;
        const panel = (g: typeof groups[number], gi: number, groupLabel: string | null) => (
          <Rows
            key={g.label ?? '__all'}
            id={gi === 0 ? 'wsx-table' : undefined}
            rows={g.rows}
            fields={fields}
            primary={manifest.primary}
            rowLink={manifest.rowLink}
            rowActions={manifest.rowActions}
            rowActionsAs={manifest.rowActionsAs}
            omitConstants={queryFilters.map(f => f.field)}
            groupLabel={groupLabel}
            now={now}
            links={links}
          />
        );
        if (!tabbed) {
          return groups.map((g, gi) => panel(g, gi, g.label));
        }
        return (
          <PageGroupTabs
            groups={groups.map((g, gi) => ({
              key: (g.label ?? `group-${gi}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `group-${gi}`,
              label: g.label ?? '',
              count: g.rows.length,
              note: typeof g.rows[0]?.meta?.laneNote === 'string' ? g.rows[0].meta.laneNote : null,
              children: panel(g, gi, null),
            }))}
          />
        );
      })()}

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

      <Widgets manifest={manifest} position="below" rows={windowed} stats={stats} />

      {rowsLead && pluginPanel}
      {rowsLead && about}
    </>
  );
}
