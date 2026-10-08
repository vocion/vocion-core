'use client';

import type { SwitcherAccount, SwitcherProject } from './workspaceSwitch';
import type { AppSummary, AppWorkspace } from '@/features/navigation/apps';
import type { OrgsMode } from '@/services/OrgPolicy';
import { useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';

/** Everything the switcher and the app rail read about where a person can go. */
export type WorkspaceDirectory = {
  projects: SwitcherProject[];
  /** The Orgs (`tenant_account`s) the person belongs to. */
  accounts: SwitcherAccount[];
  /** The Org this session is in. */
  account: { id: string; name: string } | null;
  /** The deployment's `VOCION_ORGS`; `single` shows no Org anywhere. */
  orgsMode: OrgsMode;
  /** The apps the person has in at least one workspace (the core app always). */
  apps: AppSummary[];
  /** Per app, the workspaces that have it. */
  workspacesByApp: Record<string, AppWorkspace[]>;
};

/**
 * Load the person's workspaces and the apps in them, once per mount. Null
 * while loading. A failed apps read leaves the rail on this workspace's apps
 * rather than failing the switcher; a failed workspaces read leaves both empty.
 */
export function useWorkspaceDirectory(): WorkspaceDirectory | null {
  const [data, setData] = useState<WorkspaceDirectory | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.projects.list(),
      client.apps.forUser().catch(() => ({ apps: [], workspacesByApp: {} })),
    ])
      .then(([r, a]) => {
        if (!cancelled) {
          setData({ projects: r.projects, accounts: r.accounts, account: r.account ? { id: r.account.id, name: r.account.name } : null, orgsMode: r.orgsMode, apps: a.apps, workspacesByApp: a.workspacesByApp });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ projects: [], accounts: [], account: null, orgsMode: 'single', apps: [], workspacesByApp: {} });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
