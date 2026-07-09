import { ArrowRight, Bot } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { createElement } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { agentIcon } from '@/libs/agentIcons';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listAgentHierarchy } from '@/services/AgentService';

/**
 * Agents — the front door. The main page shows LEAD agents only (the ones you
 * brief directly); each card summarizes the specialized agents that report to
 * it. Click a card to open that agent's profile, where its specialists, inline
 * agents, prompt, tools, and skills live. Structure comes from each agent's
 * `parent` field (workspace YAML); a lead has no parent.
 */

type Accent = { stripe: string; tint: string; ink: string };

function accent(name: string | null | undefined): Accent {
  switch (name) {
    case 'teal':
      return { stripe: 'var(--brand-teal)', tint: 'var(--brand-teal-tint)', ink: 'var(--brand-teal-deep)' };
    case 'violet':
      return { stripe: '#7C5CFC', tint: '#F1EEFE', ink: '#5B3FD6' };
    case 'indigo':
      return { stripe: '#5B6EF5', tint: '#EEF1FE', ink: '#3F4FD6' };
    case 'rose':
      return { stripe: '#F0567A', tint: '#FDEEF2', ink: '#D63A60' };
    default:
      return { stripe: 'var(--brand-amber)', tint: 'var(--brand-amber-tint)', ink: 'var(--brand-amber-deep)' };
  }
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function AgentsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const hierarchy = orgId ? await listAgentHierarchy(orgId) : [];
  const specialistTotal = hierarchy.reduce((n, h) => n + h.specialists.length, 0);

  return (
    <>
      <TitleBar
        title="Agents"
        description="Your lead AI agents — the ones you brief directly. Open one to see the specialists it coordinates, its tools, and how it works."
      />

      {hierarchy.length === 0
        ? (
            <EmptyState
              icon={Bot}
              title="No agents yet"
              description="Author agents in workspace/<org>/agents/ and run workspace:apply. Add `parent: <lead-slug>` to nest a specialist under a lead; omit it for a lead."
              action={{ label: 'How agents work', href: 'https://www.vocion.ai/docs/features/teams' }}
            />
          )
        : (
            <>
              <p className="mb-6 text-sm text-muted-foreground">
                {count(hierarchy.length, 'lead agent', 'lead agents')}
                {specialistTotal > 0 && ` · ${count(specialistTotal, 'specialist', 'specialists')}`}
              </p>

              <div className="grid gap-5 lg:grid-cols-2">
                {hierarchy.map(({ primary, specialists }) => {
                  const a = accent(primary.accent);
                  const skillCount = (primary.skillSlugs ?? []).length;
                  const meta = [
                    specialists.length > 0 && count(specialists.length, 'agent', 'agents'),
                    skillCount > 0 && count(skillCount, 'skill', 'skills'),
                  ].filter(Boolean) as string[];

                  return (
                    <Link
                      key={primary.id}
                      href={`/dashboard/agents/${primary.slug}`}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 pt-6 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                    >
                      {/* accent top stripe */}
                      <span className="absolute inset-x-0 top-0 h-1" style={{ background: a.stripe }} aria-hidden />

                      <div className="flex items-start gap-3">
                        <div
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl"
                          style={{ background: a.tint, color: a.ink }}
                        >
                          {createElement(agentIcon(primary.icon, { primary: true }), { 'className': 'size-5', 'aria-hidden': true })}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-display text-base leading-tight font-semibold">{primary.name}</h3>
                            <span
                              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                              style={{ background: a.tint, color: a.ink }}
                            >
                              Lead
                            </span>
                          </div>
                          {primary.eyebrow && (
                            <div className="mt-0.5 font-mono text-[11px] tracking-wide text-muted-foreground">{primary.eyebrow}</div>
                          )}
                        </div>
                      </div>

                      {primary.description && (
                        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{primary.description}</p>
                      )}

                      {specialists.length > 0 && (
                        <div className="mt-4">
                          <div className="mb-1.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                            {count(specialists.length, 'agent', 'agents')}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {specialists.map(s => (
                              <span
                                key={s.id}
                                className="rounded-full px-2 py-0.5 text-xs font-medium"
                                style={{ background: a.tint, color: a.ink }}
                              >
                                {s.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                        <span>{meta.join(' · ') || 'Standalone agent'}</span>
                        <span className="ml-auto inline-flex items-center gap-1 font-medium text-foreground/60 transition group-hover:text-primary">
                          View profile
                          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {specialistTotal > 0 && (
                <p className="mt-6 text-xs text-muted-foreground">
                  Specialists are chattable on their own — open a lead to reach them.
                </p>
              )}
            </>
          )}
    </>
  );
}
