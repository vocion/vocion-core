/**
 * The dev mail sink: a directory every outbound message is also written to,
 * one JSON file per message, so a developer — or a Playwright spec — can read
 * exactly what the app mailed (or would have mailed) without a provider.
 *
 * `VOCION_MAIL_SINK_DIR=<dir>` turns it on (relative to the process's working
 * directory). Two cases:
 *
 * - **Mail on** (`VOCION_MAIL_ENABLED=1`) with no Resend settings: the sink IS
 *   the transport. Messages are "delivered" to the directory and nowhere else,
 *   so a laptop can run every mail flow (invites, password reset, email
 *   sign-in links) end to end.
 * - **Mail off**: nothing is delivered, as before, but the message is still
 *   written with `delivered: false` — what this server would have sent.
 *
 * With Resend configured too, Resend delivers and the sink keeps a copy. Never
 * point it at a shared or served directory: a message can carry a sign-in or
 * reset link, which is a credential until it is used.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

/** One message as the sink stores it. */
export type SinkedMail = {
  /** When it was written, ISO 8601. */
  at: string;
  from: string | null;
  to: string[];
  subject: string;
  text: string | null;
  html: string;
  tags: Record<string, string>;
  /** `resend` / `sink` when it was delivered, false when mail is off. */
  delivered: 'resend' | 'sink' | false;
};

/**
 * The sink directory, or null when the sink is off.
 * @param env - The environment; `process.env` by default.
 */
export function mailSinkDir(env: Record<string, string | undefined> = process.env): string | null {
  const dir = env.VOCION_MAIL_SINK_DIR?.trim();
  return dir ? resolve(dir) : null;
}

/** This process's count of messages written, for the file names' order. */
let sequence = 0;

/**
 * Write one message to the sink. A file per message, named so a directory
 * listing sorts oldest first.
 * @param dir - The sink directory.
 * @param mail - The message.
 * @returns The file's name, which doubles as the message id.
 */
export async function writeToSink(dir: string, mail: SinkedMail): Promise<string> {
  await mkdir(dir, { recursive: true });
  // Two messages in one millisecond still list in the order they were sent.
  sequence += 1;
  const name = `${mail.at.replace(/[:.]/g, '-')}-${String(sequence).padStart(6, '0')}-${randomBytes(4).toString('hex')}.json`;
  await writeFile(join(dir, name), `${JSON.stringify(mail, null, 2)}\n`, 'utf8');
  return name;
}

/**
 * Every message in the sink, oldest first. For tests and local tooling.
 * @param dir - The sink directory.
 */
export async function readSink(dir: string): Promise<SinkedMail[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return Promise.all(names.map(async n => JSON.parse(await readFile(join(dir, n), 'utf8')) as SinkedMail));
}
