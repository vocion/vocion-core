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
  /** The deployment's Org mode (`services/OrgPolicy.ts`); `single` shows no Org anywhere. */
  orgsMode: OrgsMode;
  /** The apps the person has in at least one workspace (the core app always). */
  apps: AppSummary[];
  /** Per app, the workspaces that have it. */
  workspacesByApp: Record<string, AppWorkspace[]>;
};

/**
 * The last directory this tab read. The shell is mounted by two layouts
 * (`/dashboard/*` and `/gtm/*`), so picking an app across them mounts the
 * sidebar afresh; starting from null blanked the switcher to its loading
 * pulse and back to the same workspace on every such click (Chris,
 * 2026-10-29: "flickering and blinking, then coming back to the same
 * workspace"). Only ever written in the browser, from an effect, so a server
 * render never shares it between people; a workspace switch or a sign-out is
 * a full page load, which empties it.
 */
let lastRead: WorkspaceDirectory | null = null;

/**
 * Load the person's workspaces and the apps in them, on every mount. Null
 * while the tab's first read loads; after that a mount starts from the last
 * read and refreshes it in place. A failed apps read leaves the rail on this
 * workspace's apps rather than failing the switcher; a failed workspaces read
 * leaves both empty, unless an earlier read is on screen, which it keeps.
 */
export function useWorkspaceDirectory(): WorkspaceDirectory | null {
  const [data, setData] = useState<WorkspaceDirectory | null>(() => lastRead);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.projects.list(),
      client.apps.forUser().catch(() => ({ apps: [], workspacesByApp: {} })),
    ])
      .then(([r, a]) => {
        lastRead = { projects: r.projects, accounts: r.accounts, account: r.account ? { id: r.account.id, name: r.account.name } : null, orgsMode: r.orgsMode, apps: a.apps, workspacesByApp: a.workspacesByApp };
        if (!cancelled) {
          setData(lastRead);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(current => current ?? { projects: [], accounts: [], account: null, orgsMode: 'single', apps: [], workspacesByApp: {} });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
