import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/features/dashboard/AppSidebar';
import { AppSidebarHeader } from '@/features/dashboard/AppSidebarHeader';
import { WorkspaceDriftBanner } from '@/features/dashboard/WorkspaceDriftBanner';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { ORG_ROLE } from '@/types/Auth';
import { AppConfig } from '@/utils/AppConfig';

type DashboardLayoutProps = {
  params: Promise<{ locale: string }>;
  children: React.ReactNode;
};

export async function generateMetadata(props: DashboardLayoutProps): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({
    locale,
    namespace: 'Dashboard',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default async function DashboardLayout(props: DashboardLayoutProps) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  // Stale-session guard: a session whose project no longer exists (DB reset,
  // restore, re-provision) used to render a fully-EMPTY dashboard with no
  // error — every query scoped to a ghost org. Force a legible re-auth
  // instead of a silent blank workspace.
  const { orgId, has } = await auth();
  if (orgId) {
    const [project] = await db
      .select({ id: projectSchema.id })
      .from(projectSchema)
      .where(eq(projectSchema.id, orgId))
      .limit(1);
    if (!project) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold">Session expired</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Your session points at a workspace that no longer exists (the database
            was reset or restored). Sign in again to continue.
          </p>
          <a
            href="/api/auth/signout"
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
          >
            Sign out and sign back in
          </a>
        </div>
      );
    }
  }

  // Get the persisted sidebar state from the cookie
  const cookieStore = await cookies();
  // If the cookie is not set, default to open
  const defaultOpen = cookieStore.get(AppConfig.sidebarCookieName)?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar isAdmin={has({ role: ORG_ROLE.ADMIN })} />
      <SidebarInset>
        <AppSidebarHeader />

        <div className="@container flex-1 px-4 py-4 sm:px-6">
          {props.children}
        </div>
        <WorkspaceDriftBanner />
      </SidebarInset>
    </SidebarProvider>
  );
}
