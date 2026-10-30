'use client';

import type { ScopeProject } from './connectorRows';
import { useTranslations } from 'next-intl';
import { createContext, use } from 'react';

/**
 * WHOSE A CONNECTION IS: the whole workspace's, or one Project's — only that
 * project's work and chats use it (`services/connect/connectionScope.ts`).
 *
 * One control for both places a person says so (design principle 6): the
 * Connect form, where a new connection is born in a scope, and Manage, where
 * an existing one moves. The Connectors page holds the choice for its connect
 * forms; a Project's "Connect for this project" opens the page with that
 * project already chosen (`?project=<id>`), and the choice survives a
 * vendor's login round trip in the tab's session.
 */

export type ConnectScope = {
  /** The workspace's projects; empty when it has none, and then no picker shows. */
  projects: ScopeProject[];
  /** The project new connections are for, or null for the whole workspace. */
  projectId: number | null;
  setProjectId: (projectId: number | null) => void;
};

const NONE: ConnectScope = { projects: [], projectId: null, setProjectId: () => {} };

export const ConnectScopeContext = createContext<ConnectScope>(NONE);

/** The connect forms' scope: which project a new connection is for. */
export function useConnectScope(): ConnectScope {
  return use(ConnectScopeContext);
}

/** sessionStorage key holding the project a connect started for, across a vendor's login. */
export const CONNECT_PROJECT_KEY = 'vocion_connect_project';

/**
 * The project a connect started for in this tab, if one was kept.
 */
export function keptConnectProject(): number | null {
  try {
    const raw = sessionStorage.getItem(CONNECT_PROJECT_KEY);
    const id = raw ? Number(raw) : Number.NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Keep (or forget, with null) the project connects are for in this tab.
 * @param projectId - The project, or null for the whole workspace.
 */
export function keepConnectProject(projectId: number | null): void {
  try {
    if (projectId === null) {
      sessionStorage.removeItem(CONNECT_PROJECT_KEY);
    } else {
      sessionStorage.setItem(CONNECT_PROJECT_KEY, String(projectId));
    }
  } catch {
    /* storage unavailable: the choice holds for this page only */
  }
}

/**
 * The words for a connection's scope: "Whole workspace", or the project's name.
 * @param projectTitle - The project's name, or null for the whole workspace.
 * @param wholeWorkspace - The translated "Whole workspace".
 */
export function scopeWords(projectTitle: string | null | undefined, wholeWorkspace: string): string {
  return projectTitle ?? wholeWorkspace;
}

/**
 * "Scope: Whole workspace / <Project> ▾" — the one control. Renders nothing
 * when the workspace has no projects, since there is nothing to choose.
 * @param props - The control.
 * @param props.projects - The workspace's projects.
 * @param props.value - The chosen project, or null for the whole workspace.
 * @param props.onChange - Called with the new choice.
 * @param props.disabled - While a change is saving.
 * @param props.id - The select's id, for its label.
 */
export function ScopeSelect(props: { projects: ScopeProject[]; value: number | null; onChange: (projectId: number | null) => void; disabled?: boolean; id: string }) {
  const t = useTranslations('Connectors');
  if (props.projects.length === 0) {
    return null;
  }
  // A connection already in a project no longer listed keeps showing it, rather than reading as the workspace's.
  const listed = props.value === null || props.projects.some(p => p.id === props.value)
    ? props.projects
    : [...props.projects, { id: props.value, title: `#${props.value}` }];
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <label htmlFor={props.id} className="font-medium text-foreground/80">{t('scope_label')}</label>
      <select
        id={props.id}
        value={props.value === null ? '' : String(props.value)}
        disabled={props.disabled}
        onChange={e => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        data-testid="connection-scope"
      >
        <option value="">{t('scope_workspace')}</option>
        {listed.map(p => <option key={p.id} value={String(p.id)}>{t('scope_project', { name: p.title })}</option>)}
      </select>
    </span>
  );
}

/**
 * The connect form's scope line: the page's choice, changeable here.
 * @param props - Nothing but where it sits.
 * @param props.show - False when editing an existing connection (Manage moves it).
 */
export function ConnectScopePicker({ show = true }: { show?: boolean }) {
  const scope = useConnectScope();
  if (!show || scope.projects.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1" data-testid="connect-scope">
      <ScopeSelect id="connect-scope" projects={scope.projects} value={scope.projectId} onChange={scope.setProjectId} />
    </div>
  );
}
