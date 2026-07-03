import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { MembersPanel } from '@/features/members/MembersPanel';
import { clerkAuth } from '@/libs/Auth';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

export default async function MembersPage() {
  const { has } = await requireOrganization();
  const { userId } = await clerkAuth();

  return (
    <>
      <TitleBar
        title="Members"
        description="The people in this account — invite, manage roles, remove"
      />

      <DashboardSection
        title="Team members"
        description="Invites are link-based: create one, copy the link, and share it directly (no email is sent)."
      >
        <MembersPanel
          isAdmin={has({ role: ORG_ROLE.ADMIN })}
          currentUserId={userId ?? ''}
        />
      </DashboardSection>
    </>
  );
}
