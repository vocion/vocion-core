import { setRequestLocale } from 'next-intl/server';
import { UserDetailPanel } from '@/features/adoption/UserDetailPanel';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getMemberProfile } from '@/services/adoption/AdoptionService';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/** Per-user adoption drill-down — admin-only, same gating as the overview. */
export default async function AdoptionUserPage(props: {
  params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale, userId } = await props.params;
  setRequestLocale(locale);
  const { has } = await requireOrganization();
  const { accountId } = await clerkAuth();
  const isAdmin = has({ role: ORG_ROLE.ADMIN });

  // Membership-scoped lookup: a userId outside the caller's account
  // resolves to null, so the page can't be used to probe other tenants'
  // user names/emails by URL.
  const person = isAdmin ? await getMemberProfile(accountId, userId) : null;

  return (
    <>
      <div className="mb-2 text-xs text-muted-foreground">
        <Link href="/dashboard/adoption" className="hover:underline">← Adoption</Link>
      </div>
      <TitleBar
        title={person?.name ?? person?.email ?? 'Member'}
        description={person?.email ?? undefined}
      />
      {isAdmin
        ? (
            person
              ? <UserDetailPanel userId={userId} />
              : (
                  <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
                    No member with this id in your organization.
                  </div>
                )
          )
        : (
            <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
              Adoption analytics are visible to organization admins only.
            </div>
          )}
    </>
  );
}
