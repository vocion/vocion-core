import { createClock } from './clock.mjs';
import { createDatabase } from './db/database.mjs';
import { migrate } from './db/migrations/index.mjs';
import { seed as seedData } from './db/seed.mjs';
import { createRouter } from './http/router.mjs';
import { ROUTES } from './http/routes/index.mjs';
import { createIds } from './lib/ids.mjs';
import { createRepos } from './repos/index.mjs';
import { createAccess } from './services/access.mjs';
import { createAnalytics } from './services/analytics.mjs';
import { createDigest } from './services/digest.mjs';
import { createEvents } from './services/events.mjs';
import { createNotifier } from './services/notifications.mjs';
import { createReminders } from './services/reminders.mjs';
import { createSearch } from './services/search.mjs';
import { createSharing } from './services/sharing.mjs';

/**
 * The whole product in one object. `db` defaults to a fresh, migrated database with the seed;
 * pass one to start from your own. `now` sets the clock.
 */
export function createApp({ db, now, seed = true } = {}) {
  const clock = createClock(now);
  let database = db;
  if (!database) {
    database = createDatabase();
    migrate(database);
    if (seed) {
      seedData(database);
    }
  }
  const ids = createIds();
  const repos = createRepos(database, ids);
  const events = createEvents();
  const access = createAccess({ repos });
  const notifier = createNotifier({ repos, clock });
  const analytics = createAnalytics({ repos });
  const search = createSearch({ repos, events });
  const sharing = createSharing({ repos, access, notifier, events, clock });
  const services = { events, access, notifier, analytics, search, sharing };
  services.reminders = createReminders({ repos, notifier, clock });
  services.digest = createDigest({ repos, analytics, notifier, clock });
  const app = { db: database, clock, ids, repos, services };
  const route = createRouter(ROUTES);
  return {
    ...app,
    handle: req => route({ method: 'GET', headers: {}, query: {}, ...req }, app),
    runJob(name) {
      return services[name].run();
    },
  };
}
