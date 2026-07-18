import { setRequestLocale } from 'next-intl/server';
import { AdoptionDashboard } from '@/features/adoption/AdoptionDashboard';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/**
 * Adoption overview — admin-only. Members see a plain notice; the real
 * enforcement is the 403 on every `router.adoption.*` procedure, this
 * page-level check just keeps the UI honest.
 */
export default async function AdoptionPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { has } = await requireOrganization();
  const isAdmin = has({ role: ORG_ROLE.ADMIN });

  return (
    <>
      <TitleBar
        title="Adoption"
        description="Who at this organization is actually using the agent platform — logins, sessions, chat, and accountability actions"
      />
      {isAdmin
        ? <AdoptionDashboard />
        : (
            <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
              Adoption analytics are visible to organization admins only.
            </div>
          )}
    </>
  );
}
