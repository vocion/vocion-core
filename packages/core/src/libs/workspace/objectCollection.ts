import type { PageManifest } from './pageFields';
import { workspaceUrl } from '@/libs/links';

/**
 * Resolve a record's parent list from the same manifests that supply navigation.
 * @param manifests
 * @param objectType
 * @param workspaceSlug
 */
export function objectCollection(manifests: readonly PageManifest[], objectType: string, workspaceSlug: string | null) {
  const page = manifests.find(m => m.archetype === 'list' && m.source?.kind === 'objects' && m.source.objectType === objectType);
  const path = page ? `/dashboard/p/${page.slug}` : '/dashboard/objects';
  return {
    label: page?.title ?? 'Objects',
    href: workspaceSlug ? workspaceUrl(workspaceSlug, path) : path,
  };
}
