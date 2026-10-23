import { csvResponse } from '../../lib/csv.mjs';
import { format } from '../../lib/legacyDate.mjs';
import { forbidden, notFound } from '../../lib/validate.mjs';

export const adminRoutes = [
  // The audit log of a library, for its owners.
  ['GET', '/api/libraries/:id/audit.csv', ({ user, params, repos }) => {
    const library = repos.libraries.find(params.id);
    const role = library && repos.libraries.membership(library.id, user.id)?.role;
    if (!role) {
      throw notFound();
    }
    if (role !== 'owner') {
      throw forbidden();
    }
    const docIds = new Set(repos.documents.inLibrary(library.id, { archived: true }).map(d => d.id));
    const linkIds = new Set(repos.links.all().filter(l => docIds.has(l.docId)).map(l => l.id));
    const entries = repos.audit.all().filter(a => docIds.has(a.targetId) || linkIds.has(a.targetId) || docIds.has(a.detail?.docId));
    const rows = entries.map(a => [format(a.at, 'YYYY-MM-DD HH:mm'), repos.users.find(a.actorId)?.email || a.actorId, a.action, a.targetId, a.detail?.recipientEmail || '']);
    return csvResponse(`audit-${library.id}.csv`, ['When (UTC)', 'Who', 'Action', 'Target', 'Recipient'], rows);
  }],
];
