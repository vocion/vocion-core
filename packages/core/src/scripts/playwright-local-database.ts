/**
 * Where a local Playwright run puts its throwaway in-memory PGlite (#671).
 *
 * Locally, `playwright.config.ts` boots PGlite as the database for the run
 * (`run-p db-server:memory dev:next --race`), and PGlite listens on 5432 by
 * default. On a machine where Docker Postgres already holds 5432 — which
 * `npm run dev:up` publishes there — that command cannot start, so every local
 * run fell back to `PLAYWRIGHT_SKIP_WEB_SERVER=1` or `CI=1`.
 *
 * `PLAYWRIGHT_PGLITE_PORT` moves PGlite to another port. Three things then
 * have to agree on the database, and this module decides all three:
 *
 * - `databaseUrl`: the config writes it into the runner's own environment,
 *   so the web server, its migrations and the seed scripts the specs spawn
 *   all inherit it. The `dotenv -c` scripts never override a variable that is
 *   already set, so they reach this database rather than the one `.env.local`
 *   names.
 * - `serverCommand`: PGlite started on that port.
 * - `mayReuseRunningServer`: false. An app already serving the base URL was
 *   started against some other database, and the seed scripts would write
 *   into a PGlite nobody started. Refusing makes Playwright say the URL is
 *   taken instead of failing on a connection error inside a spec.
 *
 * It lives here rather than inline in the config so the unit project can test
 * the rules below without starting anything; `check-tracked-symlinks.ts` sits
 * here for the same reason.
 */

/** The command a local run has always used: in-memory PGlite on 5432, then `next dev`. */
export const DEFAULT_LOCAL_SERVER_COMMAND = 'npx run-p db-server:memory dev:next --race';

const HIGHEST_PORT = 65535;

type LocalDatabaseInputs = {
  /** True in CI, which runs against its own Postgres service and ignores the knob. */
  isContinuousIntegration: boolean;
  /** `PLAYWRIGHT_PGLITE_PORT` as the environment holds it; empty counts as unset. */
  requestedPort: string | undefined;
  /** `DATABASE_URL` as the environment holds it before the config touches it. */
  exportedDatabaseUrl: string | undefined;
  /** True when `PLAYWRIGHT_SKIP_WEB_SERVER` is set, so Playwright starts neither PGlite nor the app. */
  skipsWebServer: boolean;
};

export type LocalDatabasePlan = {
  /** The DATABASE_URL to set for the run, or undefined to leave the environment alone. */
  databaseUrl: string | undefined;
  /** The local `webServer.command`. */
  serverCommand: string;
  /** Whether Playwright may test an app that is already serving the base URL. */
  mayReuseRunningServer: boolean;
};

/**
 * The DATABASE_URL an in-memory PGlite answers to (pglite-server binds 127.0.0.1).
 * @param port - The port pglite-server listens on.
 */
export function pgliteDatabaseUrl(port: number): string {
  return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}

/**
 * Decide the database, server command and server reuse for a local run.
 *
 * Throws when the port is not a whole number from 1 to 65535. Throws when
 * PLAYWRIGHT_SKIP_WEB_SERVER is also set, because then nothing starts the
 * PGlite the seed scripts would be pointed at. And throws when DATABASE_URL
 * was exported pointing somewhere else: both say where the database is, and
 * quietly preferring either one would seed one database while the app reads
 * another. That error never repeats the exported URL, which can carry a
 * password. An exported URL equal to the PGlite one is allowed, because every
 * Playwright worker evaluates the config again after the runner has already
 * set it.
 * @param inputs - Whether this is CI or skips the web server, and the two environment variables as the runner found them.
 */
export function planLocalDatabase(inputs: LocalDatabaseInputs): LocalDatabasePlan {
  const unchanged: LocalDatabasePlan = {
    databaseUrl: undefined,
    serverCommand: DEFAULT_LOCAL_SERVER_COMMAND,
    mayReuseRunningServer: true,
  };
  if (inputs.isContinuousIntegration || !inputs.requestedPort) {
    return unchanged;
  }

  const port = Number(inputs.requestedPort);
  if (!/^\d+$/.test(inputs.requestedPort) || port < 1 || port > HIGHEST_PORT) {
    throw new Error(`PLAYWRIGHT_PGLITE_PORT must be a port number from 1 to ${HIGHEST_PORT}, got "${inputs.requestedPort}"`);
  }
  if (inputs.skipsWebServer) {
    throw new Error(
      'PLAYWRIGHT_PGLITE_PORT only applies when Playwright starts the web server, and PLAYWRIGHT_SKIP_WEB_SERVER is set. Unset one of them.',
    );
  }

  const databaseUrl = pgliteDatabaseUrl(port);
  if (inputs.exportedDatabaseUrl && inputs.exportedDatabaseUrl !== databaseUrl) {
    throw new Error(
      'PLAYWRIGHT_PGLITE_PORT and an exported DATABASE_URL both name the test database. '
      + 'Unset DATABASE_URL to run on PGlite, or unset PLAYWRIGHT_PGLITE_PORT to use that database.',
    );
  }

  return {
    databaseUrl,
    serverCommand: `npx run-p "db-server:memory -- --port=${port}" dev:next --race`,
    mayReuseRunningServer: false,
  };
}
