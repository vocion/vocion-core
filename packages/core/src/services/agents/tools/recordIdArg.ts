import { z } from 'zod';
import { resolveCode } from '@/services/codes';

/**
 * A record named in a tool call: its code as a person reads it (`FE-294`,
 * any case) or its bare id (`294`). One schema for every tool that takes a
 * record, so `read_object FE-294` works wherever an id did (`libs/codes.ts`).
 * @param what - What the id is, for the description.
 */
export function recordIdArg(what = 'The record') {
  return z.union([z.number().int().positive(), z.string().min(1)])
    .describe(`${what}: its code as tool output gives it (FE-294), or its id. Never its title.`);
}

/**
 * The id a tool call's record argument names, checked: a code must be a
 * record's in this workspace and of its type (FE-295 when 295 is a plan is
 * refused, saying what 295 is). A bare id passes through for the tool's own
 * read, as before.
 * @param orgId - The workspace.
 * @param raw - The argument as the model sent it.
 * @returns The id, or the reason it names nothing — said back to the model.
 */
export async function recordIdOf(orgId: string, raw: number | string): Promise<{ id: number } | { reason: string }> {
  if (typeof raw === 'number' || /^\s*#?\d+\s*$/.test(raw)) {
    return { id: Number(String(raw).replace('#', '').trim()) };
  }
  const resolved = await resolveCode(orgId, raw);
  if (resolved.kind === 'record') {
    return { id: resolved.id };
  }
  return { reason: resolved.kind === 'none' ? resolved.reason : `${resolved.code} is not a record` };
}
