import type { AgentCard } from '@/features/dashboard/AgentsGrid';
import { Bot } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { AgentsGrid } from '@/features/dashboard/AgentsGrid';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { getCurrentWorkspaceSha } from '@/libs/workspace';
import { listCorePackAgents } from '@/libs/workspace/reader';
import { listAgentHierarchy } from '@/services/AgentService';

/**
 * Agents — the front door. The main page shows LEAD agents only (the ones you
 * brief directly); each card summarizes the specialized agents that report to
 * it. Click a card to open that agent's profile, where its specialists, inline
 * agents, prompt, tools, and skills live. Structure comes from each agent's
 * `parent` field (workspace YAML); a lead has no parent.
 *
 * When the workspace extends the core base pack, core agents it hasn't
 * activated are shown as greyed "not activated" ghost cards so you can see
 * what core offers vs what's live (ticket 007 follow-up).
 */

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

  // Activated agents → clickable lead cards (the existing behavior).
  const activatedCards: AgentCard[] = hierarchy.map(({ primary, specialists }) => ({
    slug: primary.slug,
    name: primary.name,
    description: primary.description ?? null,
    icon: primary.icon ?? null,
    accent: primary.accent ?? null,
    eyebrow: primary.eyebrow ?? null,
    skillCount: (primary.skillSlugs ?? []).length,
    specialists: specialists.map(s => ({ slug: s.slug, name: s.name })),
    activated: true,
  }));

  // Ghost cards: core base-pack agents this workspace ships-with but hasn't
  // activated. Only when the applied workspace actually extends core (its sha
  // carries `+core@<version>`) — a workspace that never opted into the pack
  // shouldn't advertise core's roster.
  const activatedSlugs = new Set(hierarchy.flatMap(({ primary, specialists }) => [primary.slug, ...specialists.map(s => s.slug)]));
  const sha = orgId ? await getCurrentWorkspaceSha(orgId) : null;
  const packActive = !!sha && /\+core@/.test(sha);

  const ghostCards: AgentCard[] = [];
  if (packActive) {
    const inactive = listCorePackAgents().filter(a => !activatedSlugs.has(a.slug));
    const inactiveSlugs = new Set(inactive.map(a => a.slug));
    // Group the un-activated core agents into their own lead → specialist
    // shape. A ghost lead has no parent, or a parent that isn't itself an
    // un-activated core agent (defensive — mirrors groupAgentHierarchy).
    const specialistsByParent = new Map<string, { slug: string; name: string }[]>();
    const leads = inactive.filter((a) => {
      const isSpecialist = a.parentSlug && inactiveSlugs.has(a.parentSlug) && a.parentSlug !== a.slug;
      if (isSpecialist) {
        const list = specialistsByParent.get(a.parentSlug!) ?? [];
        list.push({ slug: a.slug, name: a.name });
        specialistsByParent.set(a.parentSlug!, list);
      }
      return !isSpecialist;
    });
    for (const lead of leads) {
      ghostCards.push({
        slug: lead.slug,
        name: lead.name,
        description: lead.description,
        icon: lead.icon,
        accent: lead.accent,
        eyebrow: lead.eyebrow,
        skillCount: lead.skillCount,
        specialists: specialistsByParent.get(lead.slug) ?? [],
        activated: false,
      });
    }
  }

  const cards = [...activatedCards, ...ghostCards];
  const specialistTotal = activatedCards.reduce((n, c) => n + c.specialists.length, 0);

  return (
    <>
      <TitleBar
        title="Agents"
        description="Your lead AI agents — the ones you brief directly. Open one to see the specialists it coordinates, its tools, and how it works."
      />

      {activatedCards.length === 0 && ghostCards.length === 0
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
                {count(activatedCards.length, 'lead agent', 'lead agents')}
                {specialistTotal > 0 && ` · ${count(specialistTotal, 'specialist', 'specialists')}`}
                {ghostCards.length > 0 && ` · ${ghostCards.length} from core not activated`}
              </p>

              <AgentsGrid cards={cards} />

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
