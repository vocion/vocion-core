import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useEffect } from 'react';
import { PaneDrawer } from './PaneDrawer';
import { closePreview, openPreview, rememberPreviewTitle, setPaneCollapsed, useOpenPreviewRef } from './previewState';

/**
 * The pane on a phone: one drawer for everything the pane holds, a tab per
 * entry once two are open (in the order they opened; picking one moves none),
 * and a bar with its own grab handle above the composer when folded (Chris,
 * 2026-10-23 and 10-24). Drag the handle, the tabs or the pane's header
 * between the bar, half and full height; a tap on the handle steps
 * half → full → folded. The entries are fictional; the URL holds them, as in
 * the app.
 */
const meta: Meta<typeof PaneDrawer> = {
  title: 'Preview/PaneDrawer',
  component: PaneDrawer,
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobile1' } },
};

export default meta;

type Story = StoryObj<typeof PaneDrawer>;

function Phone({ entries, folded = false }: { entries: Array<{ type: 'artifact' | 'object'; id: string; title: string }>; folded?: boolean }) {
  const open = useOpenPreviewRef();
  useEffect(() => {
    closePreview();
    for (const e of entries) {
      rememberPreviewTitle(`${e.type}:${e.id}`, e.title);
      openPreview({ type: e.type, id: e.id }, null);
    }
    setPaneCollapsed(folded);
    return () => closePreview();
  }, []);
  return (
    <div className="relative mx-auto flex h-[760px] w-[390px] flex-col justify-end border border-border bg-background">
      <div className="flex-1 space-y-3 p-4 text-sm text-muted-foreground">
        <p>Got all ten months; they tie to the year-to-date P&amp;L.</p>
        <p>Here is the chart, with the three year-end scenarios.</p>
      </div>
      <form className="m-3 rounded-xl border border-border p-3"><textarea data-agent-composer aria-label="Message" placeholder="Ask the team…" className="w-full resize-none bg-transparent outline-none" /></form>
      <PaneDrawer>{open ? <div className="p-4 text-sm">{`Pane for ${open.type} ${open.id}`}</div> : null}</PaneDrawer>
    </div>
  );
}

export const OneEntry: Story = {
  render: () => <Phone entries={[{ type: 'artifact', id: '41', title: 'Cumulative revenue' }]} />,
};

export const TwoEntriesAsTabs: Story = {
  render: () => <Phone entries={[{ type: 'artifact', id: '41', title: 'Cumulative revenue' }, { type: 'object', id: '16', title: 'Larkfield renewal' }]} />,
};

export const FoldedAboveTheComposer: Story = {
  render: () => <Phone folded entries={[{ type: 'artifact', id: '41', title: 'Cumulative revenue' }, { type: 'object', id: '16', title: 'Larkfield renewal' }]} />,
};

export const ManyTabsScrolledToTheActive: Story = {
  render: () => (
    <Phone entries={[
      { type: 'artifact', id: '41', title: 'Costs have outrun revenue since the summer' },
      { type: 'artifact', id: '42', title: 'Base case: the year ends near break-even' },
      { type: 'artifact', id: '43', title: 'Cash runway at the current burn' },
      { type: 'object', id: '16', title: 'Larkfield renewal' },
    ]}
    />
  ),
};
