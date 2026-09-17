'use server';

import { revalidatePath } from 'next/cache';
import { clerkAuth as auth } from '@/libs/Auth';
import { hire } from '@/services/CatalogService';

/**
 * Hire a catalog entry into the signed-in workspace.
 *
 * The only mutation the Marketplace performs. It creates an agent row from
 * the manifest and nothing else — no connectors, no scaffolded playbook
 * files nobody asked for, and no permissions: whether the new agent may
 * write is settled by the installation afterwards, not by the definition.
 *
 * Idempotent by slug, so a double-click or a stale tab produces `already`
 * rather than a second agent.
 * @param slug - The catalog entry's slug.
 */
export async function hireAgent(slug: string): Promise<{ ok: boolean; status: string }> {
  const { orgId } = await auth();
  if (!orgId) {
    return { ok: false, status: 'unauthenticated' };
  }

  const result = await hire(orgId, slug);
  if (result.status === 'unknown') {
    return { ok: false, status: 'unknown' };
  }

  // Both tabs of "Teams & agents" change shape on a hire: the roster gains
  // an agent and the Marketplace loses an entry.
  revalidatePath('/dashboard/marketplace');
  revalidatePath('/dashboard/teams');
  revalidatePath('/dashboard/agents');

  return { ok: true, status: result.status };
}
