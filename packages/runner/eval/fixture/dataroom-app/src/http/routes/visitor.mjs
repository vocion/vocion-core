import { forbidden } from '../../lib/validate.mjs';
import { linkPage } from '../../views/link.mjs';

export const visitorRoutes = [
  ['GET', '/l/:linkId', ({ req, params, query, user, repos, services }) => {
    const r = services.sharing.openLink(params.linkId, { userId: user?.id || null, passcode: query.passcode, userAgent: req.headers?.['user-agent'] || '' });
    const status = r.state === 'wrong_passcode' ? 401 : 200;
    return { status, html: linkPage({ ...r, sharedBy: repos.users.find(r.link.createdBy) }) };
  }],

  ['GET', '/l/:linkId/download', ({ params, repos }) => {
    const link = repos.links.find(params.linkId);
    if (!link) {
      return { status: 404, json: { error: 'not_found' } };
    }
    if (link.allowDownload === false) {
      throw forbidden();
    }
    return { status: 200, json: { url: `https://files.northwind.example/${link.docId}` } };
  }],
];
