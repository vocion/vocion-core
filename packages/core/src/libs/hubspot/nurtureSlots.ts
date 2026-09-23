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
import { emailBodyHtml } from '@/libs/writing/emailBody';

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
    // The template renders the body token as HTML. A body a reviewer
    // formatted arrives as HTML and is sanitized; one an agent drafted is
    // prose and becomes paragraphs, where a bare \n would otherwise collapse.
    props[cfg.bodyProperty.replaceAll('{n}', n)] = emailBodyHtml(s.body);
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

/**
 * Make sure the portal has a subject and a body property for every slot the
 * draft needs, creating the ones it lacks. Idempotent: two GETs per slot
 * when everything exists, the same shape as `ensureUnenrollBridge`.
 *
 * Until 2026-09-23 the four slots were created by hand in the portal
 * (Jamie, 2026-09-04) and a fifth rung email had nowhere to go: `maxSlots`
 * could be raised in the workspace, but the PATCH at Enroll would name a
 * property HubSpot did not have and the enrollment would fail. Now raising
 * `maxSlots` is the whole change on the platform side; the sequence template
 * still has to reference the new tokens, which only a person can do.
 * @param client
 * @param cfg
 * @param slotsNeeded - How many slots the draft uses; never more than `cfg.maxSlots`.
 */
export async function ensureNurtureSlotProperties(
  client: HubspotClient,
  cfg: NurtureSlotsConfig,
  slotsNeeded: number,
): Promise<HubspotResult<{ created: string[] }>> {
  const created: string[] = [];
  for (let n = 1; n <= Math.min(slotsNeeded, cfg.maxSlots); n += 1) {
    const wanted: Array<{ name: string; label: string; fieldType: 'text' | 'textarea' }> = [
      { name: cfg.subjectProperty.replaceAll('{n}', String(n)), label: `Vocion nurture · email ${n} subject`, fieldType: 'text' },
      { name: cfg.bodyProperty.replaceAll('{n}', String(n)), label: `Vocion nurture · email ${n} body`, fieldType: 'textarea' },
    ];
    for (const prop of wanted) {
      const existing = await client.get<{ name?: string }>(`/crm/v3/properties/contacts/${prop.name}`);
      if (existing.ok) {
        continue;
      }
      if (existing.error !== 'hubspot_error' || existing.status !== 404) {
        return existing;
      }
      const made = await client.post(`/crm/v3/properties/contacts`, {
        name: prop.name,
        label: prop.label,
        description: `Written by the Vocion platform at Enroll with the approved personalized send ${n}; the Personalized Nurture sequence templates render it.`,
        groupName: 'contactinformation',
        type: 'string',
        fieldType: prop.fieldType,
      });
      if (!made.ok) {
        return made;
      }
      created.push(prop.name);
    }
  }
  return { ok: true, data: { created } };
}
