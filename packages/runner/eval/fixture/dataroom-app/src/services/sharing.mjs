import { hashSecret, verifySecret } from '../lib/crypto.mjs';
import { badRequest, isEmail, notFound } from '../lib/validate.mjs';

export function createSharing({ repos, access, notifier, events, clock }) {
  function audit(actorId, action, targetId, detail = {}) {
    repos.audit.write({ at: clock.now(), actorId, action, targetId, detail });
  }

  return {
    createLink(userId, docId, recipientEmail) {
      const doc = access.visibleDocument(userId, docId);
      if (!isEmail(recipientEmail)) {
        throw badRequest('invalid_email');
      }
      const email = recipientEmail.trim().toLowerCase();
      const link = repos.links.create({ docId: doc.id, recipientEmail: email, createdBy: userId, createdAt: clock.now() });
      audit(userId, 'link.created', link.id, { docId: doc.id, recipientEmail: email });
      const owner = repos.users.find(userId);
      notifier.send('link.shared', {
        to: email,
        subject: `${owner.name} shared "${doc.title}" with you`,
        body: `${owner.name} shared "${doc.title}" with you on Northwind Dataroom.\n\nOpen it: https://dataroom.northwind.example/l/${link.id}\n`,
        key: `shared:${link.id}`,
      });
      events.emit('link.created', { link, doc });
      return link;
    },

    updateLink(userId, docId, linkId, { allowDownload, passcode } = {}) {
      const doc = access.visibleDocument(userId, docId);
      const link = repos.links.find(linkId);
      if (!link || link.docId !== doc.id) {
        throw notFound();
      }
      const patch = {};
      if (allowDownload !== undefined) {
        patch.allowDownload = Boolean(allowDownload);
        audit(userId, patch.allowDownload ? 'link.downloads_on' : 'link.downloads_off', link.id, { docId: doc.id });
      }
      if (passcode !== undefined) {
        if (passcode === null || passcode === '') {
          patch.passcodeHash = null;
          audit(userId, 'link.passcode_off', link.id, { docId: doc.id });
        } else {
          if (String(passcode).length < 4) {
            throw badRequest('passcode_too_short');
          }
          patch.passcodeHash = hashSecret(passcode);
          audit(userId, 'link.passcode_on', link.id, { docId: doc.id });
        }
      }
      return repos.links.update(link.id, patch);
    },

    removeLink(userId, docId, linkId) {
      const doc = access.visibleDocument(userId, docId);
      const link = repos.links.find(linkId);
      if (!link || link.docId !== doc.id) {
        throw notFound();
      }
      repos.links.remove(link.id);
      audit(userId, 'link.removed', link.id, { docId: doc.id, recipientEmail: link.recipientEmail });
    },

    /**
     * A visitor opening a link. Returns { state, link, doc }: 'ok' (a view is recorded),
     * 'passcode' (asked for one) or 'wrong_passcode'.
     */
    openLink(linkId, { userId = null, passcode, userAgent = '' } = {}) {
      const link = repos.links.find(linkId);
      const doc = link && repos.documents.find(link.docId);
      if (!link || !doc || doc.archivedAt) {
        throw notFound();
      }
      if (link.passcodeHash) {
        if (passcode === undefined || passcode === '') {
          return { state: 'passcode', link, doc };
        }
        if (!verifySecret(passcode, link.passcodeHash)) {
          return { state: 'wrong_passcode', link, doc };
        }
      }
      const viewer = userId ? repos.users.find(userId) : null;
      repos.views.record({ linkId: link.id, docId: doc.id, viewerEmail: viewer ? viewer.email : link.recipientEmail, userId, at: clock.now(), userAgent });
      events.emit('link.opened', { link, doc });
      return { state: 'ok', link, doc };
    },
  };
}
