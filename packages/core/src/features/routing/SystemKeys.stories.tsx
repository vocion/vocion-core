import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { JevKeyCardProps } from './JevKeyCard';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { JevKeyCard } from './JevKeyCard';

/**
 * System Keys (System, `/dashboard/admin`) and Workspace Keys (Developers,
 * `/dashboard/developers`): one card per key, here the Jev key that turns
 * dynamic routing on (ADR 0006). Saving here goes nowhere.
 */

const SAVED = { hint: '…10dd', source: 'saved', provider: 'typesafe', setBy: null, updatedAt: '2026-10-24T01:30:00Z' } as const;

function Page(props: { title: string; card: JevKeyCardProps }) {
  return (
    <div className="dark min-h-screen w-[1024px] bg-background p-8 text-foreground">
      <DashboardSection title={props.title}>
        <div className="grid gap-3">
          <JevKeyCard {...props.card} />
        </div>
      </DashboardSection>
    </div>
  );
}

const meta: Meta<typeof Page> = {
  title: 'Routing/SystemKeys',
  component: Page,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof Page>;

export const Connected: Story = {
  args: { title: 'System Keys', card: { scope: 'instance', onFile: SAVED, note: null, canEdit: true, lock: null } },
};

export const NotConnected: Story = {
  args: { title: 'System Keys', card: { scope: 'instance', onFile: null, note: null, canEdit: true, lock: null } },
};

export const WorkspaceOverride: Story = {
  args: { title: 'Workspace Keys', card: { scope: 'workspace', onFile: null, note: 'Overrides the instance key (…10dd).', canEdit: true, lock: null } },
};
