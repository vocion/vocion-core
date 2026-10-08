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

/** One card: an agent for hire, on its team's tint. */
export const Card: Story = {
  args: {
    tint: 'peach',
    lead: <AgentDot name="Proposal Writer" accent="orange" size="lg" decorative />,
    kicker: 'Revenue',
    title: 'Proposal Writer',
    job: 'Drafts the Contoso proposal from every call, email and file on the deal.',
    action: { label: 'View profile', href: '/dashboard/hire/proposal-writer' },
  },
};

/**
 * Apps, as the Apps page shows them (`/dashboard/apps`): each on its tint,
 * one sentence, what it brings in labelled counts, and Add or Open — an added
 * app also links to its Features.
 */
export const Apps: Story = {
  render: () => (
    <CatalogCards>
      <CatalogCard tint="sky" lead={<LetterTile name="Workforce" icon={Users} tint="sky" className="bg-background/70" />} kicker="Added" title="Workforce" job="Your agents and teams, what they know, and how the workspace runs." meta="2 agents · 2 pages" action={{ label: 'Open', href: '#' }} secondaryAction={{ label: 'Features', href: '#' }} />
      <CatalogCard tint="mint" lead={<LetterTile name="Software Factory" icon={GitBranch} tint="mint" className="bg-background/70" />} kicker="App" title="Software Factory" job="Requests become approved work, verified changes and releases the asker hears about." meta="6 agents · 5 pages" action={{ label: 'Add', href: '#' }} />
      <CatalogCard tint="peach" lead={<LetterTile name="GTM" icon={Target} tint="peach" className="bg-background/70" />} kicker="Added" title="GTM" job="Engagements, their data rooms and proposals, and growth work judged on what it returned." meta="7 agents · 6 pages" action={{ label: 'Open', href: '#' }} secondaryAction={{ label: 'Features', href: '#' }} />
      <CatalogCard tint="violet" lead={<LetterTile name="Assistants" icon={Bot} tint="violet" className="bg-background/70" />} kicker="App" title="Assistants" job="Personal assistants that work beside each person." badge={<StatusBadge status="coming" />} muted action={{ label: 'Read about it', href: '#' }} />
    </CatalogCards>
  ),
};

/** Connectors to add: the catalog half of the connectors page. The action is a button that opens the connect dialog. */
export const Connectors: Story = {
  render: () => (
    <CatalogCards>
      <CatalogCard tint="sky" lead={<LetterTile name="HubSpot" icon={Database} />} kicker="Sign in" title="HubSpot" job="Contacts, companies and deals from Northwind's CRM." action={{ label: 'Connect', onClick: () => {} }} />
      <CatalogCard tint="sky" lead={<LetterTile name="Gmail" icon={Mail} />} kicker="Sign in" title="Gmail" job="The threads on a deal, read when an agent needs them." action={{ label: 'Connect', onClick: () => {} }} />
      <CatalogCard tint="sky" lead={<LetterTile name="Zoom" icon={Video} />} kicker="Sign in" title="Zoom" job="Recordings and transcripts of Kestrel Capital calls." action={{ label: 'Connect', onClick: () => {} }} />
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
