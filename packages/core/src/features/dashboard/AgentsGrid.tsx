'use client';

import { useState } from 'react';
import { firstSentence, ListRow, ListRows, ListToolbar, Subline } from '@/components/patterns';
import { AgentDot } from '@/components/ui/agent-dot';

/**
 * Agents list + activation filter.
 *
 * Activated agents (applied to this workspace's DB) render as clickable lead
 * rows through `ListRow`. Core base-pack agents the workspace ships-with but
 * hasn't activated render as greyed, non-clickable rows — so you can
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
  /** How much the agent volunteers (`agent.initiative`); `normal` is the quiet default and shows nothing. */
  initiative: 'low' | 'normal' | 'high';
  skillCount: number;
  specialists: { slug: string; name: string }[];
  /** false → a core agent this workspace hasn't activated (ghost card). */
  activated: boolean;
};

type Filter = 'all' | 'activated' | 'inactive';

/** The small label under the name for a non-default initiative — what the agent will and will not volunteer. */
const INITIATIVE_LABEL: Record<'low' | 'high', { text: string; title: string }> = {
  high: { text: 'High initiative', title: 'Volunteers: ends a turn that produced something standing with one offer to carry it forward, takes routing ties, and debriefs completed work.' },
  low: { text: 'Low initiative', title: 'Answers what was asked and stops: no offers, no follow-ups, and it sits debriefs out.' },
};

function InitiativeLabel({ initiative, muted = false }: { initiative: 'low' | 'normal' | 'high'; muted?: boolean }) {
  if (initiative === 'normal') {
    return null;
  }
  const label = INITIATIVE_LABEL[initiative];
  return (
    <span
      data-testid="initiative-label"
      title={label.title}
      className={`rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium ${muted ? 'text-muted-foreground/70' : 'text-muted-foreground'}`}
    >
      {label.text}
    </span>
  );
}

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
        <ListToolbar
          className="mb-2"
          tabs={{ items: tabs, value: filter, onChange: key => setFilter(key as Filter), label: 'Which agents' }}
        />
      )}

      {/* One row per lead, through the one ListRow (docs/design/patterns.md
          § One list): a phone shows the whole roster, not one card a screen
          (Chris, 2026-10-09: "Global fix"). */}
      <ListRows>
        {visible.map(card => <AgentRow key={card.slug} card={card} />)}
      </ListRows>
    </>
  );
}

function AgentRow({ card }: { card: AgentCard }) {
  const meta = [
    card.specialists.length > 0 && `${count(card.specialists.length, 'agent', 'agents')}: ${card.specialists.map(s => s.name).join(', ')}`,
    card.skillCount > 0 && count(card.skillCount, 'skill', 'skills'),
  ].filter(Boolean) as string[];
  const title = (
    <>
      <span className="mr-1.5 inline-flex align-[-3px]"><AgentDot name={card.name} accent={card.accent} size="xs" decorative /></span>
      <span className={card.activated ? undefined : 'text-muted-foreground'}>{card.name}</span>
    </>
  );
  return (
    <ListRow
      href={card.activated ? `/dashboard/agents/${card.slug}` : undefined}
      className={card.activated ? undefined : 'opacity-70'}
      title={title}
      subline={(
        <Subline
          separator="·"
          segments={[card.eyebrow, card.description ? firstSentence(card.description) : null, meta.join(' · ') || (card.activated ? 'Standalone agent' : null)]}
        />
      )}
      chip={(
        <span className="flex items-center gap-1.5">
          <span className="hidden sm:inline"><InitiativeLabel initiative={card.initiative} muted={!card.activated} /></span>
          {card.activated
            ? <span className="hidden rounded-md bg-surface-soft px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground sm:inline">Lead</span>
            : <span className="rounded-md border border-border px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground" title="Ships with the platform and is not on in this workspace yet.">Core · off</span>}
        </span>
      )}
    />
  );
}
