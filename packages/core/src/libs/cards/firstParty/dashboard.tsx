'use client';

/**
 * dashboard Card — a dashboard from `render_dashboard`: the lead, then tabs of
 * sections, each section headline figures (`StatRow`), charts (the chart
 * engine's `ChartView`, two or more to a row when they fit) and tables (the
 * table card). Nothing here draws a number its own way: a figure is a `Stat`,
 * a chart is a chart, a table is a table (principle 6).
 *
 * Where the numbers come from and when they were read sit under the lead;
 * how the dashboard is built is one click away, never the lead. Refresh asks
 * the agent, as the person, to rebuild it from that method — a new version
 * of the same artifact.
 *
 * Chat surface: the lead and the first row of figures, enough to read at a
 * glance; the pane holds the rest.
 */

import type { DashboardBlock, DashboardSection, DashboardSpec, DashboardStat } from '@/libs/dashboards/spec';
import { defineCard } from '@vocion/sdk';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { z } from 'zod';
import { Stat, StatRow } from '@/components/patterns/StatRow';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartView } from '@/libs/charts/ChartView';
import { formatValue } from '@/libs/charts/format';
import { asOfLabel, refreshAsk, statDelta, statFormat, statValue } from '@/libs/dashboards/format';
import { dashboardSpecObject, refineDashboard } from '@/libs/dashboards/spec';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { DataTableCardView } from './dataTable';

export const DASHBOARD_SLUG = 'dashboard';

/** The spec plus what the pane knows and the row does not: which artifact this is. */
const dashboardCardSchema = dashboardSpecObject.extend({
  __artifactId: z.number().int().positive().optional(),
}).superRefine(refineDashboard);
type DashboardCardData = DashboardSpec & { __artifactId?: number };

function StatNote({ s }: { s: DashboardStat }) {
  const target = s.target ? `${s.target.label ?? 'target'} ${formatValue(s.target.value, statFormat(s), s.compact !== false)}` : null;
  const line = [s.note, target].filter(Boolean).join(' · ');
  if (!line && !s.source) {
    return null;
  }
  return (
    <>
      {line && <span className="block">{line}</span>}
      {s.source && <span className="mt-1 block text-[11px] text-muted-foreground/80">{s.source}</span>}
    </>
  );
}

function StatsBlock({ items }: { items: DashboardStat[] }) {
  return (
    <StatRow>
      {items.map(s => (
        <Stat key={s.label} id={s.label} label={s.label} value={statValue(s)} delta={statDelta(s)} note={<StatNote s={s} />} {...(s.href ? { href: s.href } : {})} />
      ))}
    </StatRow>
  );
}

/**
 * Consecutive charts share a row; every other block stands alone.
 * @param blocks
 */
function groupBlocks(blocks: DashboardBlock[]): Array<{ kind: 'charts'; charts: Extract<DashboardBlock, { type: 'chart' }>[] } | { kind: 'one'; block: DashboardBlock }> {
  const out: ReturnType<typeof groupBlocks> = [];
  for (const block of blocks) {
    const last = out.at(-1);
    if (block.type === 'chart' && last?.kind === 'charts') {
      last.charts.push(block);
    } else if (block.type === 'chart') {
      out.push({ kind: 'charts', charts: [block] });
    } else {
      out.push({ kind: 'one', block });
    }
  }
  return out;
}

function Prose({ md, className }: { md: string; className?: string }) {
  return (
    <div className={cn('prose prose-sm max-w-none text-foreground prose-a:text-foreground prose-a:underline prose-a:decoration-border prose-a:underline-offset-2 dark:prose-invert', className)}>
      <Markdown remarkPlugins={[remarkGfm]}>{md}</Markdown>
    </div>
  );
}

function SectionView({ section }: { section: DashboardSection }) {
  return (
    <section className="min-w-0 space-y-4" data-dashboard-section={section.title ?? ''}>
      {(section.title || section.note) && (
        <header>
          {section.title && <h3 className="text-[15px] font-semibold text-foreground">{section.title}</h3>}
          {section.note && <p className="mt-1 max-w-3xl text-[12.5px] leading-snug text-muted-foreground">{section.note}</p>}
        </header>
      )}
      {groupBlocks(section.blocks).map((g, i) => {
        if (g.kind === 'charts') {
          return (
            // eslint-disable-next-line react/no-array-index-key -- blocks have no id; order is the identity
            <div key={i} className={cn('grid gap-x-8 gap-y-8', g.charts.length > 1 && 'md:grid-cols-[repeat(auto-fit,minmax(22rem,1fr))]')}>
              {g.charts.map((c, j) => (
                // eslint-disable-next-line react/no-array-index-key -- same
                <div key={j} className="min-w-0"><ChartView spec={c.chart} /></div>
              ))}
            </div>
          );
        }
        const b = g.block;

        const key = i;
        if (b.type === 'stats') {
          return <StatsBlock key={key} items={b.items} />;
        }
        if (b.type === 'table') {
          return <div key={key} className="min-w-0"><DataTableCardView data={b.table} surface="artifact" /></div>;
        }
        if (b.type === 'text') {
          return <Prose key={key} md={b.md} className="max-w-3xl" />;
        }
        return null;
      })}
    </section>
  );
}

const CADENCE_LABEL = { 'daily': 'refreshed daily', 'weekly': 'refreshed weekly', 'monthly': 'refreshed monthly', 'on-request': null } as const;

function Provenance({ data }: { data: DashboardCardData }) {
  const [open, setOpen] = useState(false);
  const cadence = data.refresh ? CADENCE_LABEL[data.refresh.cadence ?? 'on-request'] : null;
  const id = data.__artifactId;
  return (
    <div className="space-y-2 text-[12px] leading-snug text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {['As of', asOfLabel(data.asOf)].join(' ')}
          {cadence ? ` · ${cadence}` : ''}
        </span>
        {data.refresh && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-0.5 hover:text-foreground">
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
            How it’s built
          </button>
        )}
        {id && (
          <Link href={`/dashboard/chat?ask=${encodeURIComponent(refreshAsk(data.title, id))}`} className="inline-flex items-center gap-1 hover:text-foreground" data-testid="dashboard-refresh">
            <RefreshCw className="size-3.5" aria-hidden />
            Refresh
          </Link>
        )}
      </p>
      {data.sources && <p className="max-w-4xl">{data.sources}</p>}
      {open && data.refresh && <Prose md={data.refresh.method} className="max-w-3xl rounded-md border border-border p-3 text-[12.5px]" />}
    </div>
  );
}

export function DashboardCardView({ data, surface }: { data: DashboardCardData; surface: string }) {
  if (surface !== 'artifact') {
    const first = data.tabs[0]?.sections.flatMap(s => s.blocks).find(b => b.type === 'stats');
    return (
      <article className="min-w-0 space-y-3 text-sm">
        <h3 className="font-semibold text-foreground">{data.title}</h3>
        {data.summary && <Prose md={data.summary} className="line-clamp-4" />}
        {first?.type === 'stats' && <StatsBlock items={first.items.slice(0, 4)} />}
        <p className="text-[12px] text-muted-foreground">{`As of ${asOfLabel(data.asOf)}`}</p>
      </article>
    );
  }
  const tabs = data.tabs;
  const body = (sections: DashboardSection[]) => (
    <div className="space-y-10">
      {sections.map((s, i) => (
        // eslint-disable-next-line react/no-array-index-key -- sections have no id
        <SectionView key={i} section={s} />
      ))}
    </div>
  );
  return (
    <article className="min-w-0 space-y-6" data-testid="dashboard">
      <header className="space-y-3">
        {data.summary && <Prose md={data.summary} className="max-w-3xl text-[15px] leading-7" />}
        <Provenance data={data} />
      </header>
      {tabs.length === 1
        ? body(tabs[0]!.sections)
        : (
            <Tabs defaultValue="0" className="gap-6">
              <TabsList variant="line" className="w-full justify-start border-b border-border">
                {tabs.map((t, i) => <TabsTrigger key={t.label} value={String(i)} className="flex-none px-3">{t.label}</TabsTrigger>)}
              </TabsList>
              {tabs.map((t, i) => <TabsContent key={t.label} value={String(i)}>{body(t.sections)}</TabsContent>)}
            </Tabs>
          )}
    </article>
  );
}

export const dashboardCard = defineCard({
  slug: DASHBOARD_SLUG,
  name: 'Dashboard',
  description: 'A dashboard a team opens every day: the lead, then headline figures, charts and tables in tabs, dated, with where the numbers come from and how to build it again. Kept current by an agent, each refresh a new version.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: dashboardCardSchema,
  Renderer: ({ data, surface }) => <DashboardCardView data={data as DashboardCardData} surface={surface} />,
});
