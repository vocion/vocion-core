'use client';

import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';

/**
 * A record page declares its Change intent (backlog 035) — one element,
 * rendered once anywhere on the page, the way `RecordContext` declares the
 * record.
 *
 * A record's body is an artifact, so selecting words on it offers the SAME
 * two verbs an artifact does, through the same `AskAboutThis` toolbar: Ask
 * opens the conversation with the passage quoted; Change opens it with the
 * passage and the change intent, and the agent changes the record the way it
 * changes any artifact — `read_artifact`, edit, `update_artifact` — which
 * lands as an `objects.update_meta` write: done for the person with Undo
 * under the workspace's trust rule, a new version of the body, and on its
 * History. The page refreshes in place and marks what changed
 * (`versions/VersionWatch`).
 *
 * It draws nothing of its own. The record's versions open from its version
 * chip at the end of the metadata line (`versions/VersionChip`), where each
 * carries Restore.
 * @param props - Component props.
 * @param props.objectId - The record (`business_object.id`).
 * @param props.title - The record's title, for the conversation's chip.
 * @param props.selectionRoot - CSS selector for the region whose text belongs to the record.
 */
export function RecordChangeIntent({ objectId, title, selectionRoot }: { objectId: number; title?: string; selectionRoot: string }) {
  return (
    <AskAboutThis
      record={{ type: 'object', id: String(objectId), ...(title ? { label: title } : {}) }}
      selectionRoot={selectionRoot}
      variant="none"
      changeable
    />
  );
}
