import { REMINDER_AFTER_DAYS, REMINDER_MAX } from '../config.mjs';
import { daysBetween, format } from '../lib/legacyDate.mjs';

/** The hourly reminder job. See docs/notifications.md for the rules. */
export function createReminders({ repos, notifier, clock }) {
  return {
    run() {
      const now = clock.now();
      const sent = [];
      for (const link of repos.links.all()) {
        const doc = repos.documents.find(link.docId);
        if (!doc || doc.archivedAt) {
          continue;
        }
        if (daysBetween(link.createdAt, now) < REMINDER_AFTER_DAYS) {
          continue;
        }
        if (repos.views.forLink(link.id).length > 0) {
          continue;
        }
        const earlier = repos.outbox.where(o => o.type === 'reminder' && o.key?.startsWith(`reminder:${link.id}:`));
        if (earlier.length >= REMINDER_MAX) {
          continue;
        }
        const key = `reminder:${link.id}:${format(now, 'YYYY-MM-DD')}`;
        if (earlier.some(o => o.key === key)) {
          continue;
        }
        const owner = repos.users.find(link.createdBy);
        const message = notifier.send('reminder', {
          to: link.recipientEmail,
          subject: `Reminder: ${owner.name} shared "${doc.title}" with you`,
          body: `${owner.name} shared "${doc.title}" with you on ${format(link.createdAt, 'MMM D')} and it has not been opened yet.\n\nOpen it: https://dataroom.northwind.example/l/${link.id}\n`,
          key,
        });
        if (message) {
          sent.push(message);
        }
      }
      return sent;
    },
  };
}
