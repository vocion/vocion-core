import { DIGEST_DAY } from '../config.mjs';
import { addDays, format } from '../lib/legacyDate.mjs';

/** The weekly digest to each library owner, sent on Mondays. */
export function createDigest({ repos, analytics, notifier, clock }) {
  return {
    run({ force = false } = {}) {
      const now = clock.now();
      if (!force && new Date(now).getUTCDay() !== DIGEST_DAY) {
        return [];
      }
      const weekStart = addDays(now, -7);
      const sent = [];
      for (const library of repos.libraries.all()) {
        const owners = repos.libraries.members(library.id).filter(m => m.role === 'owner');
        const docs = repos.documents.inLibrary(library.id);
        const stats = analytics.documentStats(docs);
        const lines = docs.map(d => `- ${d.title}: ${stats[d.id].opens} opens`).join('\n');
        for (const m of owners) {
          const user = repos.users.find(m.userId);
          const message = notifier.send('digest', {
            to: user.email,
            subject: `Your week in ${library.name}`,
            body: `Week of ${format(weekStart, 'MMM D')}\n\n${lines}\n`,
            key: `digest:${library.id}:${format(now, 'YYYY-MM-DD')}:${user.id}`,
          });
          if (message) {
            sent.push(message);
          }
        }
      }
      return sent;
    },
  };
}
