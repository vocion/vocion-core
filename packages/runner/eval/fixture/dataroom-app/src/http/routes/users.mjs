import { badRequest } from '../../lib/validate.mjs';
import { TYPES } from '../../services/notifications.mjs';

const PREFS = new Set(Object.values(TYPES).map(t => t.preference));

export const userRoutes = [
  ['GET', '/api/me', ({ user, repos }) => ({ json: { user: { id: user.id, email: user.email, name: user.name, prefs: user.prefs }, libraries: repos.libraries.forUser(user.id) } })],

  ['PATCH', '/api/me/prefs', ({ user, body, repos }) => {
    for (const [k, v] of Object.entries(body)) {
      if (!PREFS.has(k) || typeof v !== 'boolean') {
        throw badRequest('invalid_pref', k);
      }
    }
    return { json: { prefs: repos.users.setPrefs(user.id, body).prefs } };
  }],
];
