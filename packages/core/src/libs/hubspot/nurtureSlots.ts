/**
 * The Personalized Nurture ladder's token slots (Metacto ticket 060).
 *
 * The ladder's sequences send whatever the contact's `pn_email_N_subject` and
 * `pn_email_N_body` properties hold; the sequence templates carry nothing but
 * those two tokens and a signature. So the approved sends have to be ON the
 * contact before the contact is enrolled, or the ladder sends empty emails.
 * `personalization.enroll` writes them right before enrolling, and refuses to
 * enroll if the write fails.
 *
 * Property names and the sequence-name prefix are portal-specific, so they
 * come from the contacts source's config (`nurtureSlots`), with Metacto's
 * names as the defaults. `{n}` in a property pattern is the 1-based slot.
 */

import type { HubspotClient, HubspotResult } from './client';
import { z } from 'zod';

export const nurtureSlotsSchema = z.object({
  /** A sequence whose name starts with this is a ladder rung and needs its slots filled. */
  sequencePrefix: z.string().min(1).default('Personalized Nurture'),
  subjectProperty: z.string().min(1).regex(/\{n\}/, 'must contain {n}').default('pn_email_{n}_subject'),
  bodyProperty: z.string().min(1).regex(/\{n\}/, 'must contain {n}').default('pn_email_{n}_body'),
  /** Stamped at the write, the ladder's staleness guard. Date or datetime property; midnight-UTC ms fits both. */
  generatedAtProperty: z.string().min(1).default('pn_generated_at'),
  /** How many slot pairs the portal has. A draft with more sends than slots is refused, never truncated. */
  maxSlots: z.number().int().positive().max(20).default(4),
});
export type NurtureSlotsConfig = z.infer<typeof nurtureSlotsSchema>;

export const DEFAULT_NURTURE_SLOTS: NurtureSlotsConfig = nurtureSlotsSchema.parse({});

/**
 * The config off a source's raw `configJson`, defaults filled in. Anything
 * malformed reads as the defaults rather than failing an enrollment on a
 * config typo; the property names are validated when the write happens.
 * @param raw - `configJson.nurtureSlots`, or undefined.
 */
export function readNurtureSlotsConfig(raw: unknown): NurtureSlotsConfig {
  const parsed = nurtureSlotsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_NURTURE_SLOTS;
}

/**
 * Whether a sequence is a ladder rung, by name.
 * @param sequenceName - As the library returned it.
 * @param cfg
 */
export function isNurtureSequence(sequenceName: string, cfg: NurtureSlotsConfig = DEFAULT_NURTURE_SLOTS): boolean {
  return sequenceName.trim().toLowerCase().startsWith(cfg.sequencePrefix.trim().toLowerCase());
}

/**
 * The property map that puts the approved sends into the slots, in order:
 * send 1 into slot 1, and so on, plus the generated-at stamp.
 * @param sends - The approved sends, subject and body, in position order.
 * @param cfg
 * @param now - The stamp; midnight UTC of this day is what is written.
 * @throws When there are more sends than slots: the ladder would silently drop copy.
 */
export function nurtureSlotProperties(
  sends: Array<{ subject: string; body: string }>,
  cfg: NurtureSlotsConfig = DEFAULT_NURTURE_SLOTS,
  now: Date = new Date(),
): Record<string, string> {
  if (sends.length > cfg.maxSlots) {
    throw new Error(`${sends.length} sends but the ladder has ${cfg.maxSlots} slots; the draft has to match the rung`);
  }
  const props: Record<string, string> = {};
  sends.forEach((s, i) => {
    const n = String(i + 1);
    props[cfg.subjectProperty.replaceAll('{n}', n)] = s.subject;
    props[cfg.bodyProperty.replaceAll('{n}', n)] = s.body;
  });
  const midnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  props[cfg.generatedAtProperty] = String(midnightUtc);
  return props;
}

/**
 * Write the slots onto the contact. One PATCH; the caller decides whether a
 * failure stops the enrollment (it does, for a ladder rung).
 * @param client
 * @param contactId
 * @param properties - From `nurtureSlotProperties`.
 */
export async function writeNurtureSlots(
  client: HubspotClient,
  contactId: string,
  properties: Record<string, string>,
): Promise<HubspotResult<{ written: number }>> {
  const res = await client.patch<{ id?: string }>(`/crm/v3/objects/contacts/${contactId}`, { properties });
  if (!res.ok) {
    return res;
  }
  return { ok: true, data: { written: Object.keys(properties).length } };
}
