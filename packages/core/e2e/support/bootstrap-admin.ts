/**
 * bootstrap-admin — idempotent account + admin seeding for the E2E specs.
 *
 * Four specs need "an account, its default project and an admin user" before
 * they can sign in, and each one shelled out to `npm run user:create` with its
 * own copy of the same try/catch. That command is deliberately not idempotent:
 * on a database that already has the email it prints
 * `user already exists: <email> (<id>)` and exits 1 rather than overwriting
 * somebody's user. That is the right behaviour for an operator command and the
 * wrong shape for a seed, so the idempotency lives here, in the seeding layer,
 * and the command's interface is untouched.
 *
 * A second spec in the same run, or any re-run against a database that
 * survived the last one, therefore hits the "already exists" exit — which is
 * success as far as seeding is concerned, because the row the caller wanted is
 * present. Anything else is a real problem and is reported, non-fatally, the
 * way the inlined copies did: the sign-in that follows fails with this line
 * naming the cause.
 */
import { execFileSync } from 'node:child_process';

/** The admin a spec needs to exist before it signs in. */
export type BootstrapAdmin = {
  email: string;
  name: string;
  account: string;
  password: string;
  role?: 'admin' | 'member';
};

/** What the seeding attempt did, for a caller that wants to log it. */
export type BootstrapResult = 'created' | 'already-present' | 'failed';

/**
 * Ensures `admin` exists, creating the account and its default project too.
 * Safe to call repeatedly and from more than one spec in the same run.
 * @param admin - The account and admin user to seed.
 * @param label - Spec name used to prefix any diagnostic line.
 * @returns Whether the user was created, already there, or could not be made.
 */
export function ensureBootstrapAdmin(admin: BootstrapAdmin, label: string): BootstrapResult {
  try {
    execFileSync(
      'npm',
      [
        'run',
        'user:create',
        '--silent',
        '--',
        '--email',
        admin.email,
        '--name',
        admin.name,
        '--account',
        admin.account,
        '--password',
        admin.password,
        '--role',
        admin.role ?? 'admin',
      ],
      // No DATABASE_URL of our own: the script wraps itself in `dotenv -c`, so
      // it reads the same .env.local the app under test reads.
      { stdio: 'pipe' },
    );
    return 'created';
  } catch (error) {
    if (isAlreadyExists(error)) {
      // The row the caller asked for is present. Nothing to report.
      return 'already-present';
    }
    console.warn(`[${label}] user:create made no user: ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  }
}

/**
 * True when a failed `user:create` failed only because the email was taken.
 * Reads stdout and stderr as well as the message, because the command prints
 * the line to stderr and `execFileSync` keeps that on the error object.
 * @param error - Whatever the exec threw.
 */
function isAlreadyExists(error: unknown): boolean {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message);
  }
  const withStreams = error as { stdout?: unknown; stderr?: unknown } | null;
  for (const stream of [withStreams?.stdout, withStreams?.stderr]) {
    if (typeof stream === 'string') {
      parts.push(stream);
    } else if (stream && typeof stream === 'object' && 'toString' in stream) {
      parts.push(String(stream));
    }
  }
  return parts.join('\n').includes('user already exists');
}
