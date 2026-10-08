import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { AppNav } from '@/features/navigation/apps';
import { SessionProvider } from 'next-auth/react';
import { NextIntlClientProvider } from 'next-intl';
import { SignInForm } from '@/app/[locale]/(auth)/(center)/sign-in/SignInForm';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import en from '@/locales/en.json';
import { OrgBrandProvider } from './BrandContext';
import { BrandPreview } from './BrandPreview';
import { NORTHWIND_VIEW } from './northwind.fixture';
import { OrgBrandStyle } from './OrgBrandStyle';

/**
 * The app wearing an Org's brand — Northwind, a fixture company — in both
 * themes: the sign-in page (its logo, its name, its accent on the button,
 * "Powered by Vocion" underneath) and the sidebar (its logo at the top of the
 * nav, its mark in the rail, "Powered by Vocion" in the footer). The brand's
 * CSS is layered over the app's tokens exactly as the signed-in layout does it
 * (`OrgBrandStyle`); the app tints are untouched.
 */

const SESSION = {
  user: { id: 'usr-story', name: 'Dana Reyes', email: 'dana@northwind.example', accountId: 'acct-story', projectId: 'proj-story', role: 'admin' as const, workspaceRole: 'admin' as const },
  expires: '2999-01-01T00:00:00.000Z',
};

const APPS: AppNav[] = [
  { id: 'workforce', name: 'Workforce', icon: 'users', tint: 'sky', order: 0, core: true, entry: '/dashboard/chat', href: '/dashboard/chat', sections: [], owns: [] },
];

function Chrome({ surface, theme }: { surface: 'sign-in' | 'sidebar' | 'preview'; theme: 'light' | 'dark' }) {
  return (
    <SessionProvider session={SESSION}>
      <NextIntlClientProvider locale="en" messages={en}>
        <OrgBrandStyle brand={NORTHWIND_VIEW} />
        <OrgBrandProvider value={NORTHWIND_VIEW}>
          <div className={`${theme === 'dark' ? 'dark' : ''} bg-background text-foreground`}>
            {surface === 'sign-in' && (
              <div className="flex h-[680px] w-[720px] items-center justify-center">
                <SignInForm callbackUrl="/dashboard" hint={null} />
              </div>
            )}
            {surface === 'sidebar' && (
              <SidebarProvider defaultOpen style={{ '--sidebar-width': '18rem', '--sidebar-width-icon': '7rem' } as React.CSSProperties}>
                <div className="flex h-[640px] w-[900px] overflow-hidden rounded-xl border border-border">
                  <AppSidebar collapsible="icon" isAdmin apps={APPS} className="relative! h-full" />
                  <SidebarInset className="p-10 text-[13px] text-muted-foreground">
                    <a href="#focus" className="text-primary underline underline-offset-2">A link in the accent&apos;s ink</a>
                  </SidebarInset>
                </div>
              </SidebarProvider>
            )}
            {surface === 'preview' && <div className="w-[560px] p-4"><BrandPreview brand={NORTHWIND_VIEW} theme={theme} /></div>}
          </div>
        </OrgBrandProvider>
      </NextIntlClientProvider>
    </SessionProvider>
  );
}

const meta: Meta<typeof Chrome> = {
  title: 'Branding/Branded app',
  component: Chrome,
  parameters: { layout: 'centered', nextjs: { appDirectory: true, navigation: { pathname: '/dashboard/chat' } } },
};

export default meta;

type Story = StoryObj<typeof Chrome>;

export const SignInLight: Story = { args: { surface: 'sign-in', theme: 'light' } };
export const SignInDark: Story = { args: { surface: 'sign-in', theme: 'dark' }, parameters: { backgrounds: { default: 'dark' } } };
export const SidebarLight: Story = { args: { surface: 'sidebar', theme: 'light' } };
export const SidebarDark: Story = { args: { surface: 'sidebar', theme: 'dark' }, parameters: { backgrounds: { default: 'dark' } } };
export const PreviewLight: Story = { args: { surface: 'preview', theme: 'light' } };
export const PreviewDark: Story = { args: { surface: 'preview', theme: 'dark' } };
