import type { FlowStepView, TeamBlockView, TeamMemberView } from '@/services/workspace/teamFlow';
import { Bot, FileText, UserCheck } from 'lucide-react';
import { IntegrationLogo } from '@/components/patterns';
import { Link } from '@/libs/I18nNavigation';
import { timeAgo } from '@/libs/timeAgo';
import { cn } from '@/utils/Helpers';

/**
 * A page's `team` and `flow` blocks (`libs/workspace/pageFields.ts`), drawn
 * from `services/workspace/teamFlow.ts`.
 *
 * Chris, 2026-10-20: "those concepts (agent teams, workflows) should be visual
 * in-platform". The team reads as a team — a lead with the agents that report
 * to it, each with what it owns, its skills, its systems and its month — and
 * a recurring piece of work reads as a diagram of steps joined by arrows, with
 * a person's approval drawn apart from an agent's work. Every figure is
 * counted from the workspace's own rows; nothing on either is authored copy.
 */

/**
 * "QuickBooks" → `quickbooks`, "Google Drive" → `googledrive`: the brand catalog's key.
 * @param name - The system's name.
 */
function brandKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
}

function MonthStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg leading-tight font-semibold tabular-nums">{n}</span>
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function AgentCard({ m, monthLabel }: { m: TeamMemberView; monthLabel: string }) {
  const extraSkills = m.skills.length - 4;
  return (
    <Link
      href={`/dashboard/agents/${m.slug}`}
      data-testid={`team-agent-${m.slug}`}
      className={cn(
        'group relative flex h-full flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/30',
        m.lead ? 'border-[var(--brand-amber)]/60' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            m.lead ? 'bg-[var(--brand-amber-tint)] text-[var(--brand-amber-deep)]' : 'bg-[var(--brand-teal-tint)] text-[var(--brand-teal-deep)]',
          )}
        >
          {initials(m.name)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{m.name}</span>
            {m.lead && <span className="rounded-full bg-[var(--brand-amber-tint)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-amber-deep)]">Lead</span>}
          </div>
          {m.eyebrow && <div className="truncate text-xs text-muted-foreground">{m.eyebrow}</div>}
        </div>
      </div>
      {m.owns && <p className="line-clamp-3 text-sm text-muted-foreground">{m.owns}</p>}
      <div className="grid grid-cols-4 gap-1 border-t border-border/70 pt-3" aria-label={`${m.name} in ${monthLabel}`}>
        <MonthStat n={m.month.conversations} label="Asks" />
        <MonthStat n={m.month.documents} label="Docs" />
        <MonthStat n={m.month.proposals} label="Proposed" />
        <MonthStat n={m.month.approved} label="Approved" />
      </div>
      {m.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.skills.slice(0, 4).map(s => (
            <span key={s} className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px]">{s}</span>
          ))}
          {extraSkills > 0 && <span className="px-1 py-0.5 text-[11px] text-muted-foreground">{`+${extraSkills} more`}</span>}
        </div>
      )}
      {m.systems.length > 0 && (
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {m.systems.map(s => (
            <span key={s} className="inline-flex items-center gap-1">
              <IntegrationLogo brand={brandKey(s)} name={s} size="xs" />
              {s}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

/**
 * The team as a team: its lead above, the agents that report to it below,
 * joined by the lines of the reporting tree.
 * @param props - Props.
 * @param props.title - The block's heading.
 * @param props.team - The team, read; null when the workspace has none.
 */
export function TeamBlock({ title, team }: { title: string; team: TeamBlockView | null }) {
  return (
    <section className="mb-10" data-testid="team-block" aria-label={title}>
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      {!team
        ? <p className="py-2 text-sm text-muted-foreground">This workspace has no team yet.</p>
        : (
            <>
              <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
                {[team.goal, team.accountable ? `Accountable: ${team.accountable}` : null, `Counts are for ${team.monthLabel}.`].filter(Boolean).join(' · ')}
              </p>
              {team.lead && (
                <div className="mx-auto w-full max-w-sm">
                  <AgentCard m={team.lead} monthLabel={team.monthLabel} />
                </div>
              )}
              {team.lead && team.members.length > 0 && (
                <div aria-hidden className="relative mx-auto h-8 w-px bg-border" data-testid="team-tree" />
              )}
              {team.members.length > 0 && (
                <div className="relative">
                  {/* The tree's crossbar: from the first card's centre to the last's. */}
                  {team.lead && team.members.length > 1 && (
                    <div aria-hidden className="absolute top-0 right-[12.5%] left-[12.5%] hidden h-px bg-border xl:block" />
                  )}
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {team.members.map(m => (
                      <div key={m.slug} className="relative xl:pt-6">
                        {team.lead && <div aria-hidden className="absolute top-0 left-1/2 hidden h-6 w-px bg-border xl:block" />}
                        <AgentCard m={m} monthLabel={team.monthLabel} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
    </section>
  );
}

function Arrow() {
  return (
    <svg aria-hidden viewBox="0 0 32 16" className="h-4 w-8 shrink-0 self-center text-muted-foreground/70 max-lg:my-1 max-lg:rotate-90">
      <path d="M1 8h26" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M22 3l6 5-6 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

function stepWhen(s: FlowStepView, now: number, timeZone: string): string[] {
  const m = s.monitor;
  const cadence = s.cadence ?? m?.every ?? null;
  const status = m?.state === 'paused'
    ? 'Paused'
    : m?.lastCheck
      ? `Last ran ${timeAgo(m.lastCheck.at, now)}`
      : m?.nextRun
        ? `Next run ${new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(m.nextRun)}`
        : null;
  return [cadence, status].filter((x): x is string => Boolean(x));
}

function StepNode({ s, n, now, timeZone }: { s: FlowStepView; n: number; now: number; timeZone: string }) {
  const human = Boolean(s.person);
  return (
    <div
      data-testid={`flow-step-${n}`}
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-2 self-stretch rounded-xl border bg-card p-4 max-lg:w-full',
        human ? 'border-[var(--brand-teal)]/50 bg-[var(--brand-teal-tint)]/40' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            human ? 'bg-[var(--brand-teal)] text-white' : 'bg-[var(--brand-amber)] text-white',
          )}
        >
          {n}
        </span>
        <span className="text-sm leading-snug font-semibold">{s.title}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        {human
          ? <UserCheck className="size-3.5 text-[var(--brand-teal-deep)]" aria-hidden />
          : <Bot className="size-3.5 text-[var(--brand-amber-deep)]" aria-hidden />}
        <span className={human ? 'font-medium text-[var(--brand-teal-deep)]' : 'font-medium'}>
          {human ? `${s.person} · approves` : (s.agentName ?? s.agent ?? 'An agent')}
        </span>
      </div>
      {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
      {stepWhen(s, now, timeZone).length > 0 && (
        <p className="text-[11px] text-muted-foreground tabular-nums">{stepWhen(s, now, timeZone).join(' · ')}</p>
      )}
      {(s.produced.length > 0 || (s.links?.length ?? 0) > 0) && (
        <div className="mt-auto flex flex-col gap-1 border-t border-border/70 pt-2">
          {s.produced.map(a => (
            <Link key={a.id} href={`/dashboard/artifacts/${a.id}`} className="inline-flex min-w-0 items-start gap-1.5 text-xs hover:underline">
              <FileText className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="line-clamp-2">{a.title}</span>
            </Link>
          ))}
          {s.links?.map(l => (
            <Link key={l.href} href={l.href} className="text-xs text-muted-foreground hover:text-foreground hover:underline">{l.label}</Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A recurring piece of work as a diagram: its steps in order, joined by
 * arrows, a person's approval drawn apart from an agent's step.
 * @param props - Props.
 * @param props.title - The block's heading.
 * @param props.steps - The steps, read.
 * @param props.now - The clock.
 * @param props.timeZone - The workspace's zone.
 */
export function FlowBlock({ title, steps, now, timeZone }: { title: string; steps: FlowStepView[]; now: number; timeZone: string }) {
  return (
    <section className="mb-10" data-testid="flow-block" aria-label={title}>
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      <p className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-[var(--brand-amber)]" />
          An agent does it
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-[var(--brand-teal)]" />
          A person decides
        </span>
      </p>
      <div className="flex items-stretch max-lg:flex-col max-lg:items-center lg:gap-1">
        {steps.map((s, i) => (
          <div key={`${i}-${s.title}`} className="flex min-w-0 flex-1 items-stretch max-lg:w-full max-lg:flex-col max-lg:items-center">
            <StepNode s={s} n={i + 1} now={now} timeZone={timeZone} />
            {i < steps.length - 1 && <Arrow />}
          </div>
        ))}
      </div>
    </section>
  );
}
