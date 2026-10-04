'use client';

import type { WorkspaceIntake } from '@/services/chat/intake';
import { useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';

/** One read per page load: the workspace's intake does not change under a person. */
let intakeRead: Promise<WorkspaceIntake | null> | null = null;

/**
 * The workspace's intake (`conversations.intake`), read once and shared. A
 * failed read is no intake, and a card simply offers nothing.
 */
export function loadWorkspaceIntake(): Promise<WorkspaceIntake | null> {
  intakeRead ??= client.conversations.intake().catch(() => {
    intakeRead = null;
    return null;
  });
  return intakeRead;
}

/**
 * The intake, once known; null until then and when there is none.
 * @param wanted - Read only when something on screen could use it.
 */
export function useWorkspaceIntake(wanted: boolean): WorkspaceIntake | null {
  const [intake, setIntake] = useState<WorkspaceIntake | null>(null);
  useEffect(() => {
    if (!wanted) {
      return;
    }
    let live = true;
    void loadWorkspaceIntake().then((found) => {
      if (live) {
        setIntake(found);
      }
    });
    return () => {
      live = false;
    };
  }, [wanted]);
  return intake;
}
