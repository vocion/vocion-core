import process from 'node:process';
import { newOrgProblem } from '@/services/OrgPolicy';
import { createLocalUser } from './support/createLocalUser';

/**
 * Creates a user directly against the database, and — on an empty instance —
 * the Org (a `tenant_account` row) and default project that user belongs to.
 * On a single-Org server (the default, `services/OrgPolicy.ts`) it refuses to
 * create a second Org: name the existing one with `--org`.
 *
 * This is how the FIRST admin of a deployment is created. The web
 * `/api/signup` route only accepts invites: it used to mint an admin for
 * whoever loaded /sign-up first on a userless instance, which made any
 * reachable deployment claimable by a stranger. Being able to run this
 * script on the box is the authorization that replaced it.
 *
 * Subsequent users are invited from inside the dashboard, so this stays a
 * bootstrap tool rather than the normal path. The body is
 * `support/createLocalUser.ts`.
 */

createLocalUser(newOrgProblem).then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
