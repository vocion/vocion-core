'use client';

import { ArrowRight } from 'lucide-react';
import { createElement, useState } from 'react';
import { agentAccent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { Link } from '@/libs/I18nNavigation';

/**
 * Agents grid + activation filter.
 *
 * Activated agents (applied to this workspace's DB) render as the usual
 * clickable lead cards. Core base-pack agents the workspace ships-with but
 * hasn't activated render as greyed, non-clickable "ghost" cards — so you can
 * see what core offers and hasn't been turned on. The filter toggles between
 * everything, only what's live, and only what's available-but-off.
 */

export type AgentCard = {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  accent: string | null;
  eyebrow: string | null;
  skillCount: number;
  specialists: { slug: string; name: string }[];
  /** false → a core agent this workspace hasn't activated (ghost card). */
  activated: boolean;
};

type Filter = 'all' | 'activated' | 'inactive';

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function AgentsGrid({ cards }: { cards: AgentCard[] }) {
  const inactiveCount = cards.filter(c => !c.activated).length;
  const [filter, setFilter] = useState<Filter>('all');

  // No core agents to reveal → keep the page as it always was, no filter chrome.
  const showFilter = inactiveCount > 0;
  const visible = cards.filter((c) => {
    if (filter === 'activated') {
      return c.activated;
    }
    if (filter === 'inactive') {
      return !c.activated;
    }
    return true;
  });

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'activated', label: 'Activated' },
    { key: 'inactive', label: `Not activated (${inactiveCount})` },
  ];

  return (
    <>
      {showFilter && (
        <div className="mb-5 inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-sm">
          {tabs.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`rounded-md px-3 py-1 font-medium transition ${
                filter === t.key ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {visible.map(card => (card.activated ? <ActiveCard key={card.slug} card={card} /> : <GhostCard key={card.slug} card={card} />))}
      </div>
    </>
  );
}

function ActiveCard({ card }: { card: AgentCard }) {
  const a = agentAccent(card.accent);
  const meta = [
    card.specialists.length > 0 && count(card.specialists.length, 'agent', 'agents'),
    card.skillCount > 0 && count(card.skillCount, 'skill', 'skills'),
  ].filter(Boolean) as string[];

  return (
    <Link
      href={`/dashboard/agents/${card.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 pt-6 shadow-xs transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: a.stripe }} aria-hidden />

      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl" style={{ background: a.tint, color: a.ink }}>
          {createElement(agentIcon(card.icon, { primary: true }), { 'className': 'size-5', 'aria-hidden': true })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base leading-tight font-semibold">{card.name}</h3>
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase" style={{ background: a.tint, color: a.ink }}>
              Lead
            </span>
          </div>
          {card.eyebrow && <div className="mt-0.5 font-mono text-[11px] tracking-wide text-muted-foreground">{card.eyebrow}</div>}
        </div>
      </div>

      {card.description && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{card.description}</p>}

      {card.specialists.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{count(card.specialists.length, 'agent', 'agents')}</div>
          <div className="flex flex-wrap gap-1.5">
            {card.specialists.map(s => (
              <span key={s.slug} className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: a.tint, color: a.ink }}>
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
}

/**
 * A core agent the workspace hasn't activated. Greyed and non-clickable (there
 * is no applied agent to open), with a CORE badge and a hint at how to turn it
 * on. Deliberately visually quieter than a live card so the eye reads it as
 * "available, not on."
 * @param root0
 * @param root0.card
 */
function GhostCard({ card }: { card: AgentCard }) {
  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-2xl border border-dashed border-border bg-muted/20 p-5 pt-6 opacity-70 grayscale transition hover:opacity-100"
      title="Ships with the core base pack — activate it in your workspace.yaml `use:` list."
    >
      <span className="absolute inset-x-0 top-0 h-1 bg-muted-foreground/20" aria-hidden />

      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {createElement(agentIcon(card.icon, { primary: true }), { 'className': 'size-5', 'aria-hidden': true })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base leading-tight font-semibold text-muted-foreground">{card.name}</h3>
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              Core · not activated
            </span>
          </div>
          {card.eyebrow && <div className="mt-0.5 font-mono text-[11px] tracking-wide text-muted-foreground/70">{card.eyebrow}</div>}
        </div>
      </div>

      {card.description && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground/80">{card.description}</p>}

      {card.specialists.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{count(card.specialists.length, 'agent', 'agents')}</div>
          <div className="flex flex-wrap gap-1.5">
            {card.specialists.map(s => (
              <span key={s.slug} className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground/70">
        <span>Available in core</span>
        <span className="ml-auto font-mono">
          use: [
          {card.slug}
          ]
        </span>
      </div>
    </div>
  );
}
