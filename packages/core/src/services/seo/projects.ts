/**
 * The project an SEO batch belongs to — the client's home: its rules, its
 * wiki (`notes`), its brand and guideline documents, and the gate sizes it
 * sets (`seoGate`).
 *
 * A project is today's data room (`business_object` of type `data_room`); the
 * Projects rename gives it its own helpers (`projectHref`, list by project).
 * Until that lands, this file is the one place the SEO app reaches it, through
 * the data-room service underneath, so the rename is a change here and
 * nowhere else.
 */

import { getDataRoom, roomHref } from '@/services/DataRoomService';

export type SeoProject = { id: number; title: string; meta: Record<string, unknown> };

/**
 * One project, or null when the id is not a project in this workspace.
 * @param orgId - The workspace.
 * @param id - The project id.
 */
export async function readSeoProject(orgId: string, id: number): Promise<SeoProject | null> {
  const room = await getDataRoom(orgId, id);
  return room ? { id: room.id, title: room.title, meta: room.meta as Record<string, unknown> } : null;
}

/**
 * Where a project opens.
 * @param id - The project id.
 */
export function seoProjectHref(id: number): string {
  return roomHref(id);
}
