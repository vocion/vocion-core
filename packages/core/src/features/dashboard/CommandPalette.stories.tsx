import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Bot, Compass, MessageSquare, Network, Search, Sparkles } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { buildPaletteGroups } from '@/features/dashboard/palette/paletteGroups';
import { DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';

/**
 * The ⌘K palette's list, rendered statically from the same pure model the
 * live dialog uses (`buildPaletteGroups`), so the two states can be looked at
 * without a router or a dialog portal: empty query (pages, entities,
 * commands) and free text (Ask Vocion leads).
 * @param root0
 * @param root0.query
 * @param root0.themeIsDark
 */
function PaletteList({ query, themeIsDark }: { query: string; themeIsDark?: boolean }) {
  const groups = buildPaletteGroups({
    query,
    routes: DASHBOARD_ROUTES,
    isAdmin: true,
    themeIsDark,
    agents: [
      { slug: 'revenue-director', name: 'Revenue Director', description: 'Runs the revenue workspace' },
      { slug: 'revenue-lead', name: 'RevOps Lead', description: 'Pipeline health, inbound triage' },
    ],
    teams: [{ slug: 'revops', name: 'RevOps' }, { slug: 'deal-desk', name: 'Deal Desk' }],
    missions: [{ slug: 'daily-revenue-briefing', name: 'Revenue Briefing' }],
    conversations: [
      { id: 42, title: 'Spinutech — is it dead?', agentSlug: 'revenue-director' },
      { id: 41, title: 'Prep for the Lerner call', agentSlug: 'revenue-lead' },
    ],
  });
  const icon = (kind: string, url?: string) => {
    if (kind === 'route') {
      const r = DASHBOARD_ROUTES.find(x => x.url === url);
      return r ? <r.icon /> : <Search />;
    }
    return ({ ask: <Sparkles />, agent: <Bot />, team: <Network />, mission: <Compass />, conversation: <MessageSquare /> } as Record<string, React.ReactNode>)[kind] ?? <Search />;
  };
  return (
    <div className="w-[560px] overflow-hidden rounded-xl border border-border bg-popover shadow-(--shadow-pop)">
      <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5 [&_[cmdk-item]_svg]:size-4">
        <CommandInput placeholder="Search, or ask Vocion anything…" value={query} readOnly />
        <CommandList className="max-h-[520px]">
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {groups.map((g, i) => (
            <div key={g.heading}>
              {i > 0 && g.heading === 'Commands' && <CommandSeparator />}
              <CommandGroup heading={g.heading}>
                {g.rows.map(row => (
                  <CommandItem key={row.value} value={row.value}>
                    {icon(row.kind, row.url)}
                    <span className="min-w-0 flex-1 truncate">
                      {row.label}
                      {row.hint && <span className="ml-2 text-[12px] text-muted-foreground">{row.hint}</span>}
                    </span>
                    {row.shortcut && <CommandShortcut>{row.shortcut}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
      </Command>
    </div>
  );
}

const meta: Meta<typeof PaletteList> = {
  title: 'Shell/CommandPalette',
  component: PaletteList,
  parameters: { layout: 'centered' },
};

export default meta;

type Story = StoryObj<typeof PaletteList>;

export const Browse: Story = { args: { query: '' } };
export const AskVocion: Story = { args: { query: 'why is Spinutech stale' } };
export const DarkTheme: Story = { args: { query: '', themeIsDark: true }, parameters: { backgrounds: { default: 'dark' } }, decorators: [Story => <div className="dark rounded-xl bg-background p-6"><Story /></div>] };
