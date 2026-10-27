/**
 * The project an SEO batch belongs to — the client's home: its instructions
 * (`rules`), its wiki (`notes`), its brand and guideline documents, and the
 * gate sizes it sets (`seoGate`).
 *
 * A Project is a core workspace noun (internally a `data_room` record). Every
 * SEO record belongs to one through `metadata.projectId`, so a project's page
 * lists its batches and pages under Work with no SEO-specific code.
 */

import { getProject, projectHref } from '@/services/DataRoomService';

export type SeoProject = { id: number; title: string; meta: Record<string, unknown> };

/**
 * One project, or null when the id is not a project in this workspace.
 * @param orgId - The workspace.
 * @param id - The project id.
 */
export async function readSeoProject(orgId: string, id: number): Promise<SeoProject | null> {
  const project = await getProject(orgId, id);
  return project ? { id: project.id, title: project.title, meta: project.meta as Record<string, unknown> } : null;
}

/**
 * Where a project opens.
 * @param id - The project id.
 */
export function seoProjectHref(id: number): string {
  return projectHref(id);
}
