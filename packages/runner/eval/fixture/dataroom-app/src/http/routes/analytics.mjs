import { notFound } from '../../lib/validate.mjs';
import { analyticsPage } from '../../views/analytics.mjs';

export const analyticsRoutes = [
  ['GET', '/api/documents/:id/analytics', ({ user, params, repos, services }) => {
    const doc = repos.documents.find(params.id);
    if (!doc || !repos.libraries.isMember(doc.libraryId, user.id)) {
      throw notFound();
    }
    return { json: { activity: services.analytics.linkActivity(doc.id) } };
  }],

  ['GET', '/documents/:id/analytics', ({ user, params, services }) => {
    const doc = services.access.visibleDocument(user.id, params.id);
    return { html: analyticsPage({ doc, activity: services.analytics.linkActivity(doc.id) }) };
  }, { auth: true }],
];
