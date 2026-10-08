'use client';

import type { FunctionPlan } from '@/libs/workspace/functionPlan';
import type { PlanItemKind } from '@/libs/workspace/functionPlanEdits';
import { Library, Sparkles, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cannotRemove, removeFromPlan, renameInPlan } from '@/libs/workspace/functionPlanEdits';

function cents(n: number): string {
  return `$${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}`;
}

/**
 * One editable name, with the remove control beside it — or the reason it
 * cannot be removed on its own, on hover.
 * @param props - The row.
 * @param props.plan - The plan.
 * @param props.kind - What the row is.
 * @param props.slug - Which one.
 * @param props.name - Its name.
 * @param props.onChange - The edited plan.
 * @param props.size - Heading or item.
 */
function NameRow(props: { plan: FunctionPlan; kind: PlanItemKind; slug: string; name: string; onChange: (plan: FunctionPlan) => void; size?: 'heading' | 'item' }) {
  const blocked = cannotRemove(props.plan, props.kind, props.slug);
  const remove = (
    <button
      type="button"
      aria-label={`Remove ${props.name}`}
      data-testid={`plan-remove-${props.kind}-${props.slug}`}
      disabled={blocked !== null}
      onClick={() => props.onChange(removeFromPlan(props.plan, props.kind, props.slug))}
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      <X className="size-3.5" aria-hidden />
    </button>
  );
  return (
    <div className="flex items-center gap-1.5">
      <Input
        aria-label={`${props.kind} name`}
        data-testid={`plan-name-${props.kind}-${props.slug}`}
        value={props.name}
        maxLength={80}
        onChange={e => props.onChange(renameInPlan(props.plan, props.kind, props.slug, e.target.value))}
        className={props.size === 'heading' ? 'h-8 font-semibold' : 'h-7 text-[13px]'}
      />
      {blocked
        ? (
            <Tooltip>
              <TooltipTrigger asChild><span>{remove}</span></TooltipTrigger>
              <TooltipContent>{blocked}</TooltipContent>
            </Tooltip>
          )
        : remove}
    </div>
  );
}

/**
 * THE PREVIEW of a drafted plan — teams, then each team's agents, then what
 * each agent owns (its missions and the automations that keep them) — before
 * anything is created. Every name is editable and every item removable
 * (a team's lead goes with its team); what the plan reuses is cited — the
 * catalog role an agent is hired as, the plugins it turns on, the closest
 * template — and the trust bars and budgets are stated. Controlled: the
 * caller holds the plan and creates it.
 * @param props - The preview.
 * @param props.plan - The plan, as edited so far.
 * @param props.onChange - The plan after an edit.
 */
export function PlanPreview(props: { plan: FunctionPlan; onChange: (plan: FunctionPlan) => void }) {
  const { plan } = props;
  const totalDaily = plan.agents.reduce((sum, a) => sum + a.dailyCents, 0);
  return (
    <div data-testid="plan-preview" className="space-y-5 text-sm">
      <div>
        <p className="leading-relaxed text-muted-foreground">{plan.summary}</p>
        {(plan.reuse.template || plan.reuse.plugins.length > 0) && (
          <ul className="mt-2 space-y-1 text-[13px]">
            {plan.reuse.template && (
              <li data-testid="plan-reuse-template">
                <span className="font-medium">Closest template:</span>
                {' '}
                {plan.reuse.template.slug}
                {' — '}
                <span className="text-muted-foreground">{plan.reuse.template.why}</span>
              </li>
            )}
            {plan.reuse.plugins.map(p => (
              <li key={p.slug} data-testid={`plan-reuse-plugin-${p.slug}`}>
                <span className="font-medium">Turns on</span>
                {' '}
                {p.slug}
                {' — '}
                <span className="text-muted-foreground">{p.why}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {plan.teams.map(team => (
        <section key={team.slug} data-testid={`plan-team-${team.slug}`} className="border-t border-border/60 pt-4">
          <NameRow plan={plan} kind="team" slug={team.slug} name={team.name} onChange={props.onChange} size="heading" />
          <p className="mt-1.5 text-[13px] text-muted-foreground">{team.goal}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Graded on:
            {' '}
            {team.measures.map(m => `${m.label} (${m.target}${m.unit ? ` ${m.unit}` : ''} / ${m.window})`).join(' · ')}
          </p>
          <ul className="mt-3 space-y-3">
            {plan.agents.filter(a => a.team === team.slug).map((agent) => {
              const missions = plan.missions.filter(m => m.agent === agent.slug);
              const automations = plan.automations.filter(a => a.agent === agent.slug);
              return (
                <li key={agent.slug} data-testid={`plan-agent-${agent.slug}`} className="ml-3 border-l border-border/60 pl-3">
                  <NameRow plan={plan} kind="agent" slug={agent.slug} name={agent.name} onChange={props.onChange} />
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    {team.lead === agent.slug && <span className="font-medium text-foreground">Lead</span>}
                    {agent.source.kind === 'catalog'
                      ? (
                          <span className="inline-flex items-center gap-1" title={agent.source.why}>
                            <Library className="size-3" aria-hidden />
                            Hired from the catalog:
                            {' '}
                            {agent.source.slug}
                          </span>
                        )
                      : (
                          <span className="inline-flex items-center gap-1">
                            <Sparkles className="size-3" aria-hidden />
                            New — no catalog role fit
                          </span>
                        )}
                    <span>
                      {cents(agent.dailyCents)}
                      /day cap
                    </span>
                  </div>
                  <p className="mt-1 text-[13px]">{agent.role}</p>
                  {(missions.length > 0 || automations.length > 0) && (
                    <ul className="mt-2 space-y-1.5">
                      {missions.map(m => (
                        <li key={m.slug} data-testid={`plan-mission-${m.slug}`}>
                          <NameRow plan={plan} kind="mission" slug={m.slug} name={m.name} onChange={props.onChange} />
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Mission · runs
                            {' '}
                            <code>{m.schedule}</code>
                          </p>
                        </li>
                      ))}
                      {automations.map(a => (
                        <li key={a.slug} data-testid={`plan-automation-${a.slug}`}>
                          <NameRow plan={plan} kind="automation" slug={a.slug} name={a.name} onChange={props.onChange} />
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Automation ·
                            {' '}
                            {'schedule' in a.when ? <code>{a.when.schedule}</code> : `on ${a.when.event}`}
                            {a.checkMission ? ` · keeps ${plan.missions.find(m => m.slug === a.checkMission)?.name ?? a.checkMission}` : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="border-t border-border/60 pt-4 text-[13px]">
        <p>
          <span className="font-medium">Budgets:</span>
          {' '}
          a daily cap on every seat,
          {' '}
          {cents(totalDaily)}
          /day in all.
        </p>
        <p className="mt-1">
          <span className="font-medium">Trust:</span>
          {' '}
          {plan.trust.length === 0
            ? 'no bars of its own — the workspace\'s defaults apply.'
            : `${plan.trust.map(r => `${r.action} at ${r.rung}`).join(', ')} — every one off until the record earns it.`}
        </p>
      </section>
    </div>
  );
}
