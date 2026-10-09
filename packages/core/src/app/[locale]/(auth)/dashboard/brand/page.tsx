import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { BrandSettingsLive } from '@/features/branding/BrandSettingsLive';
import { LeadNameControl } from '@/features/dashboard/LeadNameControl';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { auth } from '@/libs/Auth';
import { decodeDraft } from '@/libs/branding/draft';
import { fieldsOf } from '@/libs/branding/orgBrand';
import { db } from '@/libs/DB';
import { extensionWhiteLabel } from '@/libs/extensions';
import { tenantAccountSchema } from '@/models/Schema';
import { getOrgBrand } from '@/services/branding/OrgBrandService';
import { seededLeadNameFor } from '@/services/workspace/leadNaming';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

export const metadata: Metadata = { title: 'Brand' };

/**
 * Brand settings — the Org's logo, mark, accent, heading font and sender
 * name, with a live preview (`features/branding/BrandSettings.tsx`). Admins
 * of the Org only; a member reads who can change it. `?draft=` carries a
 * brand drafted in chat (the brand card's "Adjust"), shown unsaved.
 * @param props - The route's props.
 * @param props.searchParams - `draft`, a base64url brand draft.
 */
export default async function BrandPage(props: { searchParams: Promise<{ draft?: string }> }) {
  const { has } = await requireOrganization();
  const session = await auth();
  const accountId = session?.user?.accountId ?? null;
  const t = await getTranslations('Brand');
  const [org] = accountId ? await db.select({ name: tenantAccountSchema.name }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1) : [];
  const orgName = org?.name ?? '';

  if (!has({ role: ORG_ROLE.ADMIN }) || !accountId) {
    return (
      <>
        <TitleBar title={t('title')} description={t('description')} />
        <p className="text-sm text-muted-foreground" data-testid="brand-admin-only">{t('admin_only', { org: orgName || 'your Org' })}</p>
      </>
    );
  }

  const { draft } = await props.searchParams;
  const brand = await getOrgBrand(accountId);
  const drafted = decodeDraft(draft);
  const lead = session?.user?.projectId ? await seededLeadNameFor(session.user.projectId) : null;

  return (
    <>
      <TitleBar title={t('title')} description={t('description')} />
      <BrandSettingsLive
        initial={brand ? fieldsOf(brand) : null}
        draft={drafted ? { ...drafted, accent: drafted.accent ?? null, headingFont: drafted.headingFont ?? null, senderName: drafted.senderName ?? null, website: drafted.website ?? null } : null}
        orgName={orgName}
        poweredBy={!extensionWhiteLabel()}
      />
      {/* "Make it yours" also offers the workspace's lead a first name, optional. */}
      {lead && (
        <section className="mt-8 border-t border-border/70 pt-6" data-testid="brand-lead-name">
          <LeadNameControl role={lead.role} given={lead.given} />
        </section>
      )}
    </>
  );
}
