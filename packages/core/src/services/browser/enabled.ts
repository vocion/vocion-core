import process from 'node:process';

/**
 * Whether browser runs are switched on for every agent in a person's turn on this installation
 * (`VOCION_BROWSER_RUNS=on`). Off, only agents granted `browser_tasks` have them, and the composer
 * offers no `@browser` tag.
 */
export function browserRunsOn(): boolean {
  return ['1', 'on', 'true'].includes((process.env.VOCION_BROWSER_RUNS ?? '').toLowerCase());
}
