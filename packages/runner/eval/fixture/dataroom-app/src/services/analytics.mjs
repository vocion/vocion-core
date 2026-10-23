import { isBot } from '../lib/bots.mjs';

export function createAnalytics({ repos }) {
  return {
    /** Per document: how often it was opened, when last, and by how many people. */
    documentStats(documents) {
      const out = {};
      for (const doc of documents) {
        const views = repos.views.forDocument(doc.id);
        const last = views.reduce((m, v) => (m && m > v.at ? m : v.at), null);
        out[doc.id] = { opens: views.length, lastOpenedAt: last, openedBy: new Set(views.map(v => v.viewerEmail)).size };
      }
      return out;
    },

    /** The analytics page: each link, its opens by people (robots left out) and the last one. */
    linkActivity(docId) {
      return repos.links.forDocument(docId).map((link) => {
        const views = repos.views.forLink(link.id).filter(v => !isBot(v.userAgent));
        return {
          linkId: link.id,
          recipientEmail: link.recipientEmail,
          opens: views.length,
          lastOpenedAt: views.reduce((m, v) => (m && m > v.at ? m : v.at), null),
          visits: views.map(v => ({ at: v.at, viewerEmail: v.viewerEmail, userAgent: v.userAgent })),
        };
      });
    },
  };
}
