/**
 * Reset a local user's password. Development convenience for a local
 * database, not an admin tool: it changes the hash directly with no
 * verification of the old password, so it only makes sense where you already
 * own the box and the data.
 *
 * Three ways to supply the new password:
 *
 *   --password <pw>      the original interface; simplest, but the password
 *                        lands in shell history and the process list
 *   --from-file <path>   first line of the file, which is deleted after
 *                        reading — the non-interactive option that keeps the
 *                        password out of history
 *   neither, with a TTY  hidden prompt, asked twice
 *
 * The file and prompt modes were added because a non-interactive runner has
 * no TTY, where a readline prompt either hangs or reads an empty string and
 * silently changes nothing.
 *
 * Usage:
 *   npm run local:reset-password -- --email you@example.com
 *   npm run local:reset-password -- --email you@example.com --from-file /tmp/pw.txt
 *   npm run local:reset-password -- --email you@example.com --password '<pw>'
 */

import { readFileSync, unlinkSync } from 'node:fs';
import process from 'node:process';
import * as readline from 'node:readline';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { userSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * Read a line from the terminal without echoing it.
 * @param prompt
 */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo: swallow the output writes readline makes while typing.
    const iface = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    iface._writeToOutput = (s: string) => {
      if (s.includes(prompt)) {
        iface.output.write(prompt);
      }
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/**
 * Read the new password, twice-confirmed from a TTY or once from a file.
 * Refuses to guess when there is no TTY and no file: silently resetting to an
 * empty string, or hanging on a prompt nobody can see, are both worse than an
 * error that says what to do.
 * @param flagPassword - value of --password, if given
 * @param fromFile - path from --from-file, if given
 */
async function readNewPassword(flagPassword: string | undefined, fromFile: string | undefined): Promise<string> {
  if (flagPassword) {
    return flagPassword;
  }

  if (fromFile) {
    const password = readFileSync(fromFile, 'utf8').split('\n')[0]!.trim();
    unlinkSync(fromFile);
    console.log(`read password from ${fromFile} (file deleted)`);
    return password;
  }

  if (!process.stdin.isTTY) {
    console.error(
      'no TTY, so the hidden prompt cannot run. Either run this in a real\n'
      + 'terminal window, write the password to a file and pass --from-file\n'
      + '<path> (deleted after reading), or pass --password <pw>.',
    );
    process.exit(2);
  }

  const password = await askHidden('New password: ');
  const confirm = await askHidden('Confirm: ');
  if (password !== confirm) {
    console.error('passwords do not match');
    process.exit(2);
  }
  return password;
}

async function main() {
  const { values } = parseArgs({
    options: {
      'email': { type: 'string' },
      'password': { type: 'string' },
      'from-file': { type: 'string' },
    },
  });
  const email = values.email?.toLowerCase();
  if (!email) {
    console.error('missing --email');
    process.exit(2);
  }

  const [user] = await db
    .select({ id: userSchema.id, name: userSchema.name })
    .from(userSchema)
    .where(eq(userSchema.email, email))
    .limit(1);

  if (!user) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }

  const password = await readNewPassword(values.password, values['from-file']);
  if (password.length < 8) {
    console.error('password must be at least 8 characters — nothing changed');
    process.exit(2);
  }

  await db
    .update(userSchema)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(userSchema.id, user.id));

  // Echo the row's new updated_at: proof the write landed, so a no-op can
  // never be mistaken for success again.
  const [after] = await db
    .select({ updatedAt: userSchema.updatedAt })
    .from(userSchema)
    .where(eq(userSchema.id, user.id))
    .limit(1);

  console.log(`password reset for ${email} (${user.name ?? 'no name'}) at ${after?.updatedAt?.toISOString()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
