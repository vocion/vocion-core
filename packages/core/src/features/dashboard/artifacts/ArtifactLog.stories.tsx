import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { ArtifactListItem } from '@/services/ArtifactService';
import { NextIntlClientProvider } from 'next-intl';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ArtifactLog } from './ArtifactLog';

/**
 * Artifacts, on the shared `ListRow` — the row feel the rest of the app is
 * converging on.
 */
const meta: Meta<typeof ArtifactLog> = {
  title: 'Artifacts/Log',
  component: ArtifactLog,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en">
        <div className="@container mx-auto max-w-5xl">
          <TitleBar title="Artifacts" description="Everything your agents made, newest first." />
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof ArtifactLog>;

function artifact(over: Partial<ArtifactListItem> & Pick<ArtifactListItem, 'id' | 'title' | 'kind'>): ArtifactListItem {
  return {
    conversationId: 4,
    spec: {},
    url: null,
    messageId: 12,
    folder: 'revenue/weekly',
    version: 1,
    versions: 1,
    authorKind: 'agent',
    authorId: 'revenue-lead',
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-12T09:00:00.000Z',
    conversationTitle: 'Weekly revenue review',
    ...over,
  };
}

const ARTIFACTS: ArtifactListItem[] = [
  artifact({ id: 1, title: 'Pipeline by stage', kind: 'table', version: 3, versions: 3 }),
  artifact({ id: 2, title: 'Q3 platform plan', kind: 'markdown', folder: 'planning', conversationTitle: 'Planning' }),
  artifact({ id: 3, title: 'Win rate by segment', kind: 'chart', authorKind: 'human', authorId: 'chris', folder: null }),
  artifact({ id: 4, title: 'Redpoint IT — account snapshot', kind: 'record', folder: 'accounts' }),
];

export const Default: Story = {
  args: {
    artifacts: ARTIFACTS,
    folders: [{ folder: 'revenue/weekly', count: 1 }, { folder: 'planning', count: 1 }, { folder: 'accounts', count: 1 }],
    pins: [],
    selfId: 'chris',
  },
};

export const Empty: Story = {
  args: { artifacts: [], folders: [], pins: [], selfId: 'chris' },
};
