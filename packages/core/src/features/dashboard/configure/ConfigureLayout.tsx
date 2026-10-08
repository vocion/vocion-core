import type { ConfigureAside, ConfigureTone, ConfigureView } from './configurePlan';
import { SetupResetButton } from './SetupResetButton';
import type { ColumnKind } from '@/components/patterns';
import type { ConfigureTabKind } from '@/libs/workspace/pageFields';
import { DetailColumns, RightColumn, Section } from '@/components/patterns';
import { PageGroupTabs } from '@/features/dashboard/pages/PageGroupTabs';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { ConfigureRows } from './ConfigureRows';

/**
 * The `configure` archetype's layout: a main block of tabs — each a hairline
 * list with its count, the tab in `?tab=` — and a sidebar of blocks beside
 * it that stacks under the tabs on a phone. Both columns are the Detail
 * pattern's (`DetailColumns`, `RightColumn`, quiet `Section`s), so the page
 * reads like every record page rather than as a layout of its own.
 *
 * Pure presentation over {@link ConfigureView}: what each block says is
 * decided in `configurePlan.ts`, and nothing here knows which plugin it is
 * drawing.
 */

/** Which width convention a tab's right-hand figure takes. */
const FIGURE: Record<ConfigureTabKind, ColumnKind> = {
  seats: 'date',
  skills: 'date',
  automations: 'date',
  trust: 'date',
  learned: 'date',
  measures: 'status',
};

const TONE_TEXT: Record<ConfigureTone, string> = {
  ok: 'text-[var(--brand-pass,#15803d)]',
  bad: 'text-[var(--brand-fail,#b91c1c)]',
  warn: 'text-[var(--brand-borderline,#b45309)]',
  info: 'text-foreground',
  muted: 'text-muted-foreground',
};

/** The query parameter the tab lives in. */
export const CONFIGURE_TAB_PARAM = 'tab';

export function ConfigureLayout({ view }: { view: ConfigureView }) {
  // The Detail archetype's two columns: the tabs are the content, the
  // sidebar is its right column — the same shape (and the same collapse
  // under the content on a phone) as every record page.
  // What needs a person leads on a phone, where the sidebar would otherwise
  // sit under every row of the tab; beside the tabs it is in the sidebar.
  const attention = view.aside.find(b => b.kind === 'attention');
  return (
    <div data-testid="configure-page">
      <DetailColumns
        aside={view.aside.length > 0
          ? (
              <RightColumn label="At a glance" className="-mt-4">
                <div data-testid="configure-aside">
                  {view.aside.map(block => (
                    <div key={block.kind} className={cn(block.kind === 'attention' && 'hidden @3xl:block')}>
                      <AsideBlock block={block} />
                    </div>
                  ))}
                </div>
              </RightColumn>
            )
          : undefined}
      >
        {attention && (
          <div className="-mt-4 mb-2 @3xl:hidden">
            <AsideBlock block={attention} testId="configure-attention-lead" />
          </div>
        )}
        <PageGroupTabs
          param={CONFIGURE_TAB_PARAM}
          initial={view.active}
          groups={view.tabs.map(t => ({
            key: t.key,
            label: t.label,
            count: t.count,
            note: t.note,
            children: t.key === 'automations'
              ? (
                  <>
                    <ConfigureRows key={t.key} rows={t.rows} empty={t.empty} figure={FIGURE[t.key]} />
                    {/* Every automation in the workspace, each with its switch. */}
                    <p className="mt-3 text-[13px]">
                      <Link href="/dashboard/automation" className="text-muted-foreground hover:text-foreground hover:underline">All automations in this workspace, with their switches</Link>
                    </p>
                  </>
                )
              : <ConfigureRows key={t.key} rows={t.rows} empty={t.empty} figure={FIGURE[t.key]} figureAlways={t.key === 'measures'} />,
          }))}
        />
      </DetailColumns>
    </div>
  );
}

function AsideBlock({ block, testId }: { block: ConfigureAside; testId?: string }) {
  return (
    <Section
      tone="quiet"
      eyebrow={block.label}
      data-testid={testId ?? `configure-aside-${block.kind}`}
      action={block.kind === 'health'
        ? <Link href={block.href} className="text-muted-foreground hover:text-foreground hover:underline">Team report</Link>
        : block.kind === 'setup'
          ? <SetupResetButton plugin={block.plugin} anythingToReset={block.items.some(i => i.done)} />
          : undefined}
    >
      <ul className="-my-1.5 divide-y divide-rule">
        {block.kind === 'setup' && block.items.map(item => (
          <li key={item.id} className="flex items-baseline justify-between gap-3 py-2" data-testid={`configure-setup-${item.id}`}>
            <span className="min-w-0 truncate">{item.label}</span>
            <span className={cn('shrink-0 text-xs', item.done ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>{item.done ? 'Done' : 'To do'}</span>
          </li>
        ))}
        {block.kind === 'health' && block.items.map(m => (
          <li key={m.id} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{m.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">{m.value}</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{m.target}</span>
              {m.change && <span className={cn('shrink-0 tabular-nums', TONE_TEXT[m.change.tone])} data-testid={`configure-change-${m.id}`}>{m.change.label}</span>}
            </div>
          </li>
        ))}
        {block.kind === 'attention' && block.items.map(item => (
          <li key={item.id}>
            <Link href={item.href} className="-mx-2 flex items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--brand-borderline,#b45309)]" aria-hidden />
              <span className="min-w-0">
                <span className="block">{item.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
              </span>
            </Link>
          </li>
        ))}
        {block.kind === 'changes' && block.items.map(item => (
          <li key={item.id}>
            <Link href={item.href} className="-mx-2 block rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
              <span className="block">{item.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {[item.who, item.when].filter(Boolean).join(' · ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
