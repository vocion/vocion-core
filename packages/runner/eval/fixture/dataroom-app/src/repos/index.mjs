import { auditRepo } from './audit.mjs';
import { documentsRepo } from './documents.mjs';
import { librariesRepo } from './libraries.mjs';
import { linksRepo } from './links.mjs';
import { outboxRepo } from './outbox.mjs';
import { usersRepo } from './users.mjs';
import { viewsRepo } from './views.mjs';

export function createRepos(db, ids) {
  return {
    users: usersRepo(db),
    libraries: librariesRepo(db),
    documents: documentsRepo(db, ids),
    links: linksRepo(db, ids),
    views: viewsRepo(db, ids),
    audit: auditRepo(db, ids),
    outbox: outboxRepo(db, ids),
  };
}
