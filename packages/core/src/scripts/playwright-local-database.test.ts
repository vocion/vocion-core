import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SERVER_COMMAND, pgliteDatabaseUrl, planLocalDatabase } from './playwright-local-database';

/** A local run with nothing set: not CI, no knob, nothing exported, the web server started. */
const PLAIN_LOCAL_RUN = {
  isContinuousIntegration: false,
  requestedPort: undefined,
  exportedDatabaseUrl: undefined,
  skipsWebServer: false,
};

describe('planLocalDatabase', () => {
  it('leaves a run without PLAYWRIGHT_PGLITE_PORT exactly as it was', () => {
    for (const requestedPort of [undefined, '']) {
      expect(planLocalDatabase({ ...PLAIN_LOCAL_RUN, requestedPort })).toEqual({
        databaseUrl: undefined,
        serverCommand: 'npx run-p db-server:memory dev:next --race',
        mayReuseRunningServer: true,
      });
    }
  });

  it('points the app, the migrations and the seed scripts at PGlite on the requested port', () => {
    const plan = planLocalDatabase({ ...PLAIN_LOCAL_RUN, requestedPort: '5499' });

    expect(plan.databaseUrl).toBe('postgresql://postgres:postgres@127.0.0.1:5499/postgres');
    expect(plan.serverCommand).toBe('npx run-p "db-server:memory -- --port=5499" dev:next --race');
  });

  it('refuses to reuse an app already serving the base URL, since that app reads some other database', () => {
    const plan = planLocalDatabase({ ...PLAIN_LOCAL_RUN, requestedPort: '5499' });

    expect(plan.mayReuseRunningServer).toBe(false);
  });

  it('ignores the knob in CI, which runs against its own Postgres service', () => {
    const plan = planLocalDatabase({ ...PLAIN_LOCAL_RUN, isContinuousIntegration: true, requestedPort: '5499' });

    expect(plan.databaseUrl).toBeUndefined();
    expect(plan.serverCommand).toBe(DEFAULT_LOCAL_SERVER_COMMAND);
  });

  it('rejects a value that is not a usable port before anything starts', () => {
    for (const requestedPort of ['abc', '0', '65536', '99999', '54 99', '-1', '5499.5']) {
      expect(() => planLocalDatabase({ ...PLAIN_LOCAL_RUN, requestedPort }))
        .toThrow('PLAYWRIGHT_PGLITE_PORT must be a port number from 1 to 65535');
    }
  });

  it('accepts both ends of the port range', () => {
    for (const requestedPort of ['1', '65535']) {
      expect(() => planLocalDatabase({ ...PLAIN_LOCAL_RUN, requestedPort })).not.toThrow();
    }
  });

  it('refuses the knob alongside PLAYWRIGHT_SKIP_WEB_SERVER, since then nothing starts the PGlite', () => {
    expect(() => planLocalDatabase({ ...PLAIN_LOCAL_RUN, requestedPort: '5499', skipsWebServer: true }))
      .toThrow('PLAYWRIGHT_SKIP_WEB_SERVER is set');
  });

  it('refuses an exported DATABASE_URL that names another database, without echoing it', () => {
    const exportedDatabaseUrl = 'postgresql://someone:hunter2@db.internal:5432/vocion';

    let message = '';
    try {
      planLocalDatabase({ ...PLAIN_LOCAL_RUN, requestedPort: '5499', exportedDatabaseUrl });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('Unset DATABASE_URL to run on PGlite');
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('db.internal');
  });

  it('accepts a DATABASE_URL that already names the same PGlite, as it is in every worker', () => {
    const plan = planLocalDatabase({ ...PLAIN_LOCAL_RUN, requestedPort: '5499', exportedDatabaseUrl: pgliteDatabaseUrl(5499) });

    expect(plan.databaseUrl).toBe(pgliteDatabaseUrl(5499));
  });
});
