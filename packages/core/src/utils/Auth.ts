import { redirect } from 'next/navigation';
import { clerkAuth as auth } from '@/libs/Auth';

/**
 * Authentication utilities for Next.js App Router. These functions use Next.js `redirect()`.
 *
 * Naming Convention: `require*` functions ensure users are in the correct state
 * by redirecting them if authentication/authorization fails.
 *
 * For API/RPC authentication, use AuthGuards.ts (`guard*` functions) instead.
 */

/**
 * Ensures the user belongs to an organization (project).
 * Redirects to the dashboard root if none is found. (The Clerk-era
 * `/onboarding/organization-selection` page no longer exists — sessions
 * without a project can't self-serve one; they land on the dashboard.)
 * @returns Promise containing orgId and has function for role checking.
 * @throws {redirect} Redirects to /dashboard if no orgId.
 */
export const requireOrganization = async () => {
  const { orgId, has } = await auth();

  if (!orgId) {
    redirect('/dashboard');
  }

  return { orgId, has };
};
