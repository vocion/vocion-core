import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NextIntlClientProvider } from 'next-intl';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import en from '@/locales/en.json';

/**
 * The left sidebar's two widths after the airy pass: expanded (16rem, quiet
 * grey active pill, "Needs you" badge) and the 56px icon rail it collapses
 * to (tooltips carry the labels). Both in the WORK view; the MANAGE view is
 * one click away in the app and shares every primitive.
 */
function Frame({ defaultOpen, needsYouCount }: { defaultOpen: boolean; needsYouCount?: number }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <div className="flex h-[640px] w-[900px] overflow-hidden rounded-xl border border-border">
          <AppSidebar collapsible="icon" isAdmin needsYouCount={needsYouCount} className="relative! h-full" />
          <SidebarInset className="p-10 text-[13px] text-muted-foreground">Page content</SidebarInset>
        </div>
      </SidebarProvider>
    </NextIntlClientProvider>
  );
}

const meta: Meta<typeof Frame> = {
  title: 'Shell/AppSidebar',
  component: Frame,
  parameters: { layout: 'centered', nextjs: { appDirectory: true, navigation: { pathname: '/dashboard/briefings' } } },
};

export default meta;

type Story = StoryObj<typeof Frame>;

export const Expanded: Story = { args: { defaultOpen: true, needsYouCount: 3 } };
export const IconRail: Story = { args: { defaultOpen: false, needsYouCount: 3 } };
