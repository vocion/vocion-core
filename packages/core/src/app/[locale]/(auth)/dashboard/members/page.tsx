import { MembersScreen } from '@/features/members/MembersScreen';
import { OrgPersonalReach } from '@/features/members/OrgPersonalReach';
import { clerkAuth } from '@/libs/Auth';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/**
 * Members — one page with two lanes, People and Groups.
 *
 * It used to be two stacked `DashboardSection`s: a members table, and under it
 * a "Workspace access" panel that hand-rolled its own table with a list of
 * sub-rows inside one cell and redrew the whole roster once per group. The
 * page is now a `ListPage` and the screen composes `components/patterns`.
 *
 * A second nav entry for access was considered and rejected: this account has
 * nine people, and that is less navigation than a page (decision Q1, 25 Sep
 * 2026).
 */
export default async function MembersPage() {
  const { has } = await requireOrganization();
  const { userId } = await clerkAuth();

  return (
    <>
      <MembersScreen
        isAdmin={has({ role: ORG_ROLE.ADMIN })}
        currentUserId={userId ?? ''}
      />
      {/* The Org's say in its members' one Personal; admins, multi-Org only. */}
      <OrgPersonalReach />
    </>
  );
}
