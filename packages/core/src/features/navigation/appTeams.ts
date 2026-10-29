/**
 * Which of a workspace's teams work in which app.
 *
 * An app (`templates/apps/<id>/app.yaml`) is a named set of plugins, and a
 * plugin ships its teams (`templates/plugins/<slug>/teams/*.yaml`), so a team
 * a plugin ships belongs to the app that lists the plugin — read from the
 * manifests, never from a slug written here. A workspace's own team (one no
 * plugin ships) names its app in its file (`app: gtm`, stored as `team.app`);
 * a team that names none stays with the core app, which keeps everything no
 * other app claims (the same rule the sidebar follows for rows,
 * `features/navigation/apps.ts`).
 *
 * The Chat page of an app leads with these teams' briefing and counts their
 * work (`services/chat/appFront.ts`).
 *
 * Pure data, no filesystem and no DB. Tested in `appTeams.test.ts`.
 */

import type { AppDefinition } from './apps';

/** A team as this module needs it: its slug and the app its file names, if any. */
export type TeamAppInput = { slug: string; app: string | null };

/**
 * The app a team works in.
 * @param team - The team's slug and declared app.
 * @param input - The catalogue and what each plugin ships.
 * @param input.apps - The app catalogue (or the apps installed here).
 * @param input.pluginTeams - Plugin slug → the team slugs it ships.
 * @returns The app id, or undefined when no app takes it (no core app in the catalogue).
 */
export function appOfTeam(team: TeamAppInput, input: { apps: readonly Pick<AppDefinition, 'id' | 'core' | 'plugins'>[]; pluginTeams: Readonly<Record<string, readonly string[]>> }): string | undefined {
  if (team.app && input.apps.some(a => a.id === team.app)) {
    return team.app;
  }
  for (const app of input.apps) {
    if (!app.core && app.plugins.some(p => input.pluginTeams[p]?.includes(team.slug))) {
      return app.id;
    }
  }
  return input.apps.find(a => a.core)?.id;
}

/**
 * The slugs of the teams that work in one app, in the order given.
 * @param appId - The app.
 * @param teams - The workspace's teams.
 * @param input - The catalogue and what each plugin ships (see {@link appOfTeam}).
 * @param input.apps - The app catalogue.
 * @param input.pluginTeams - Plugin slug → the team slugs it ships.
 */
export function teamsOfApp(appId: string, teams: readonly TeamAppInput[], input: { apps: readonly Pick<AppDefinition, 'id' | 'core' | 'plugins'>[]; pluginTeams: Readonly<Record<string, readonly string[]>> }): string[] {
  return teams.filter(t => appOfTeam(t, input) === appId).map(t => t.slug);
}
