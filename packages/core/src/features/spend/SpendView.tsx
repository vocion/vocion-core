import type { SpendFilters, SpendGroup, SpendResult } from '@/services/spend/spend';
import { useTranslations } from 'next-intl';
import { Column, ListRow, ListRows } from '@/components/patterns/ListRow';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * SPEND on the Observability page — the ledger read one way over a period
 * (`services/spend/spend.ts`). Server-rendered from the URL: the period, the
 * grouping, the scope and any filter are query parameters, so a view is a
 * link a person can keep or send, and each row drills into the next view.
 */

export const SPEND_PERIODS = ['today', '7d', '30d', '90d'] as const;
export type SpendPeriod = typeof SPEND_PERIODS[number];

/** The groupings a person picks from, in the order they are offered. */
export const SPEND_VIEW_GROUPS: readonly SpendGroup[] = ['workspace', 'agent', 'user', 'feature', 'model', 'run', 'day'];

export type SpendViewState = {
  scope: 'org' | 'workspace';
  group: SpendGroup;
  period: SpendPeriod;
  filters: SpendFilters;
};

/**
 * The view a URL asks for, with sensible defaults. Pure.
 * @param q - The page's search parameters.
 * @param canReadOrg - Whether this person may read the whole Org.
 */
export function spendViewState(q: Record<string, string | string[] | undefined>, canReadOrg: boolean): SpendViewState {
  const one = (k: string): string | undefined => (Array.isArray(q[k]) ? q[k]![0] : q[k] as string | undefined) || undefined;
  const scope = canReadOrg && one('scope') !== 'workspace' ? 'org' : 'workspace';
  const asked = one('group') as SpendGroup | undefined;
  const group = asked && SPEND_VIEW_GROUPS.includes(asked) ? asked : (scope === 'org' ? 'workspace' : 'agent');
  const period = (SPEND_PERIODS as readonly string[]).includes(one('period') ?? '') ? one('period') as SpendPeriod : '30d';
  const conversation = one('conversation');
  return {
    scope,
    group: scope === 'workspace' && group === 'workspace' ? 'agent' : group,
    period,
    filters: {
      ...(one('workspace') && scope === 'org' ? { orgId: one('workspace') } : {}),
      ...(one('agent') ? { agentSlug: one('agent') } : {}),
      ...(one('user') ? { userId: one('user') } : {}),
      ...(one('feature') ? { feature: one('feature') } : {}),
      ...(one('model') ? { model: one('model') } : {}),
      ...(conversation && /^\d+$/.test(conversation) ? { conversationId: Number(conversation) } : {}),
    },
  };
}

/**
 * The query a state is written as.
 * @param s
 */
function queryOf(s: SpendViewState): Record<string, string> {
  const f = s.filters;
  return {
    scope: s.scope,
    group: s.group,
    period: s.period,
    ...(f.orgId ? { workspace: f.orgId } : {}),
    ...(f.agentSlug ? { agent: f.agentSlug } : {}),
    ...(f.userId ? { user: f.userId } : {}),
    ...(f.feature ? { feature: f.feature } : {}),
    ...(f.model ? { model: f.model } : {}),
    ...(f.conversationId !== undefined ? { conversation: String(f.conversationId) } : {}),
  };
}

/**
 * A link to the page in another state.
 * @param s - The state.
 */
export function spendHref(s: SpendViewState): string {
  return `/dashboard/observability?${new URLSearchParams(queryOf(s)).toString()}#spend`;
}

/** The filter a row of a grouping narrows to, and the grouping it opens next. */
const DRILL: Partial<Record<SpendGroup, { filter: keyof SpendFilters; next: SpendGroup }>> = {
  workspace: { filter: 'orgId', next: 'agent' },
  agent: { filter: 'agentSlug', next: 'feature' },
  user: { filter: 'userId', next: 'agent' },
  feature: { filter: 'feature', next: 'agent' },
  model: { filter: 'model', next: 'agent' },
};

/**
 * Where a run opens, when it has a page of its own.
 * @param key
 */
function runHref(key: string): string | null {
  const [kind, id] = key.split(':');
  if (!id) {
    return null;
  }
  switch (kind) {
    case 'mission_run': return `/dashboard/missions/runs/${id}`;
    case 'browser_run': return `/dashboard/browser/${id}`;
    case 'eval_run': return `/dashboard/evals/${id}`;
    default: return null;
  }
}

/**
 * Where a row goes: a run or conversation opens its record; anything else
 * filters to itself and groups the next way.
 * @param s - The current state.
 * @param key - The row's key.
 */
export function rowHref(s: SpendViewState, key: string | null): string | null {
  if (key === null) {
    return null;
  }
  if (s.group === 'run') {
    return runHref(key);
  }
  if (s.group === 'conversation') {
    return `/dashboard/chat?c=${key}`;
  }
  const drill = DRILL[s.group];
  if (!drill) {
    return null;
  }
  return spendHref({ ...s, group: drill.next, filters: { ...s.filters, [drill.filter]: key } });
}

/**
 * Money from micro-cents: "$12.48", or "<$0.01" for a fraction of a cent.
 * @param micro - Millionths of a cent.
 */
export function dollars(micro: number): string {
  const cents = micro / 1_000_000;
  if (micro > 0 && cents < 1) {
    return '<$0.01';
  }
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A count as a person reads it: "1.2M", "48K", "930".
 * @param n - The count.
 */
export function compact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function Pill(props: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      aria-current={props.on ? 'true' : undefined}
      className={cn('rounded-full px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors', props.on ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground')}
    >
      {props.children}
    </Link>
  );
}

export type SpendViewProps = { state: SpendViewState; result: SpendResult; canReadOrg: boolean; filterLabel?: string | null };

/**
 * The spend section: a total, the period and grouping pickers, the active
 * filter, and one row per group that drills in. Renders on the server from the
 * Observability page, and anywhere a `NextIntlClientProvider` is open.
 * @param props
 * @param props.state - What is being read.
 * @param props.result - What the ledger said.
 * @param props.canReadOrg - Whether the Org scope is offered.
 * @param props.filterLabel - The active filter, as a person reads it.
 */
export function SpendView(props: SpendViewProps) {
  const t = useTranslations('Spend');
  const { state, result } = props;
  const filtered = Object.keys(state.filters).length > 0;
  const groups = SPEND_VIEW_GROUPS.filter(g => g !== 'workspace' || state.scope === 'org');
  return (
    <section id="spend" className="scroll-mt-20">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2">
        <h2 className="text-[15px] font-semibold">{t('title')}</h2>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {t('total', { money: dollars(result.total.microCents), calls: compact(result.total.calls), tokens: compact(result.total.tokens) })}
        </span>
      </div>

      <div className="flex flex-col gap-2 border-y border-border/70 px-1 py-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('period_label')}>
          {props.canReadOrg && (
            <>
              <Pill href={spendHref({ ...state, scope: 'org', group: 'workspace', filters: {} })} on={state.scope === 'org'}>{t('scope_org')}</Pill>
              <Pill href={spendHref({ ...state, scope: 'workspace', group: 'agent', filters: {} })} on={state.scope === 'workspace'}>{t('scope_workspace')}</Pill>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            </>
          )}
          {SPEND_PERIODS.map(p => (
            <Pill key={p} href={spendHref({ ...state, period: p })} on={state.period === p}>{t(`period_${p}`)}</Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('group_label')}>
          <span className="px-1 text-[12px] text-muted-foreground">{t('group_label')}</span>
          {groups.map(g => (
            <Pill key={g} href={spendHref({ ...state, group: g })} on={state.group === g}>{t(`group_${g}`)}</Pill>
          ))}
        </div>
        {filtered && (
          <div className="flex flex-wrap items-center gap-2 px-1 text-[13px] text-muted-foreground">
            <span>{t('filtered', { what: props.filterLabel ?? '' })}</span>
            <Link href={spendHref({ ...state, filters: {} })} className="text-primary hover:underline">{t('clear')}</Link>
          </div>
        )}
      </div>

      {result.rows.length === 0
        ? <p className="px-2 py-6 text-sm text-muted-foreground">{t('empty')}</p>
        : (
            <ListRows>
              <div aria-hidden className="flex items-center gap-3 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                <span className="min-w-0 flex-1">{t(`group_${state.group}`)}</span>
                <Column kind="number">{t('col_calls')}</Column>
                <Column kind="number">{t('col_tokens')}</Column>
                <Column kind="number">{t('col_share')}</Column>
                <Column kind="amount" always>{t('col_cost')}</Column>
                <span className="w-4 shrink-0" />
              </div>
              {result.rows.map((row) => {
                const href = rowHref(state, row.key);
                const share = result.total.microCents > 0 ? Math.round((row.microCents / result.total.microCents) * 100) : 0;
                return (
                  <ListRow
                    key={row.key ?? '∅'}
                    {...(href ? { href } : {})}
                    title={row.label}
                    {...(row.label !== row.key && row.key && state.group !== 'day' ? { subline: <span className="font-mono text-[12px]">{row.key}</span> } : {})}
                    columns={(
                      <>
                        <Column kind="number">{compact(row.calls)}</Column>
                        <Column kind="number">{compact(row.tokens)}</Column>
                        <Column kind="number">{`${share}%`}</Column>
                        <Column kind="amount" always>{dollars(row.microCents)}</Column>
                      </>
                    )}
                  />
                );
              })}
            </ListRows>
          )}
      <p className="mt-2 px-2 text-[12px] text-muted-foreground">{t('ledger_note')}</p>
    </section>
  );
}
