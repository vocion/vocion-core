// Every email is a notification of a known type; each type names the preference that turns it off.
// See docs/notifications.md. Nothing else writes to the outbox.
export const TYPES = {
  'link.shared': { preference: 'shares' },
  'reminder': { preference: 'reminders' },
  'digest': { preference: 'digest' },
};

export function createNotifier({ repos, clock }) {
  return {
    /** Queues the email, or returns null when the recipient turned this type off. */
    send(type, { to, subject, body, key = null }) {
      const t = TYPES[type];
      if (!t) {
        throw new Error(`unknown notification type ${type}`);
      }
      const user = repos.users.byEmail(to);
      if (user && user.prefs?.[t.preference] === false) {
        return null;
      }
      return repos.outbox.insert({ type, to, subject, body, at: clock.now(), key });
    },
  };
}
