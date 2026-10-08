import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Bot, Database, GitBranch, Mail, Target, Users, Video } from 'lucide-react';
import { AgentDot } from '@/components/ui/agent-dot';
import { LetterTile } from '@/components/ui/letter-tile';
import { StatusBadge } from '@/components/ui/status-badge';
import { CatalogCard, CatalogCards } from './index';

/**
 * The Front doors archetype: `CatalogCard` — kicker, title, ONE sentence of
 * what it does, ONE arrow. For choosing and starting (an app, an agent to
 * hire, a connector to add), never for records you are working on: those are
 * `ListRow`s. `docs/design/patterns.md` § Front doors. Fictional fixtures.
 */
const meta: Meta<typeof CatalogCard> = {
  title: 'Patterns/Front doors',
  component: CatalogCard,
  parameters: { layout: 'padded' },
  decorators: [Story => <div className="mx-auto max-w-5xl"><Story /></div>],
};

export default meta;

type Story = StoryObj<typeof CatalogCard>;

/** One card, on the hairline surface. */
export const Card: Story = {
  args: {
    lead: <AgentDot name="Proposal Writer" accent="orange" size="lg" decorative />,
    kicker: 'Revenue',
    title: 'Proposal Writer',
    job: 'Drafts the Contoso proposal from every call, email and file on the deal.',
    action: { label: 'View profile', href: '/dashboard/marketplace/proposal-writer' },
  },
};

/** Apps wear their tint: the marketplace's More apps, the rail, the app header. */
export const Apps: Story = {
  render: () => (
    <CatalogCards>
      <CatalogCard tint="sky" lead={<LetterTile name="Workforce" icon={Users} tint="sky" className="bg-background/70" />} kicker="App" title="Workforce" job="Your agents and teams, what they know, and how the workspace runs." action={{ label: 'See its plugins', href: '#' }} />
      <CatalogCard tint="violet" lead={<LetterTile name="Assistants" icon={Bot} tint="violet" className="bg-background/70" />} kicker="App" title="Assistants" job="Personal assistants that work beside each person." badge={<StatusBadge status="coming" />} muted action={{ label: 'Read about it', href: '#' }} />
      <CatalogCard tint="mint" lead={<LetterTile name="Software Factory" icon={GitBranch} tint="mint" className="bg-background/70" />} kicker="App" title="Software Factory" job="Requests become approved work, verified changes and releases the asker hears about." badge={<StatusBadge status="beta" />} action={{ label: 'See its 2 plugins', href: '#' }} />
      <CatalogCard tint="peach" lead={<LetterTile name="GTM" icon={Target} tint="peach" className="bg-background/70" />} kicker="App" title="GTM" job="Engagements, their data rooms and proposals, and growth work judged on what it returned." badge={<StatusBadge status="available" />} action={{ label: 'See its 3 plugins', href: '#' }} />
    </CatalogCards>
  ),
};

/** Connectors to add: the catalog half of the connectors page. The action is a button that opens the connect dialog. */
export const Connectors: Story = {
  render: () => (
    <CatalogCards>
      <CatalogCard lead={<LetterTile name="HubSpot" icon={Database} />} kicker="OAuth" title="HubSpot" job="Contacts, companies and deals from Northwind's CRM." action={{ label: 'Connect', onClick: () => {} }} />
      <CatalogCard lead={<LetterTile name="Gmail" icon={Mail} />} kicker="OAuth" title="Gmail" job="The threads on a deal, read when an agent needs them." action={{ label: 'Connect', onClick: () => {} }} />
      <CatalogCard lead={<LetterTile name="Zoom" icon={Video} />} kicker="OAuth" title="Zoom" job="Recordings and transcripts of Kestrel Capital calls." action={{ label: 'Connect', onClick: () => {} }} />
    </CatalogCards>
  ),
};

/** The six tints, light and dark: text on each stays AA (`--ink-secondary` ≥ 5.3:1). */
export const Tints: Story = {
  render: () => (
    <CatalogCards>
      {(['violet', 'sky', 'mint', 'peach', 'butter', 'rose'] as const).map(tint => (
        <CatalogCard key={tint} tint={tint} kicker="Tint" title={tint} job="One sentence in the secondary ink, readable on every tint." action={{ label: 'Open', href: '#' }} />
      ))}
    </CatalogCards>
  ),
};
