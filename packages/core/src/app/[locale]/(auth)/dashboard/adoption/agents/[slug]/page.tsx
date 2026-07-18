import { setRequestLocale } from 'next-intl/server';
import { AgentDetailPanel } from '@/features/adoption/AgentDetailPanel';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/** Per-agent adoption drill-down — admin-only, same gating as the overview. */
export default async function AdoptionAgentPage(props: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { has } = await requireOrganization();
  const isAdmin = has({ role: ORG_ROLE.ADMIN });

  return (
    <>
      <div className="mb-2 text-xs text-muted-foreground">
        <Link href="/dashboard/adoption" className="hover:underline">← Adoption</Link>
      </div>
      <TitleBar
        title={slug}
        description="Agent adoption — reach, volume, and trust signals"
      />
      {isAdmin
        ? <AgentDetailPanel agentSlug={slug} />
        : (
            <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
              Adoption analytics are visible to organization admins only.
            </div>
          )}
    </>
  );
}
