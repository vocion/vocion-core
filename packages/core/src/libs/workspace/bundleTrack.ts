/**
 * WHAT AN APP BUNDLE WROTE, SO AN UPGRADE CAN TELL A PERSON'S EDIT FROM CORE'S.
 *
 * An app turned on in a workspace with no folder (every Vocion Cloud
 * workspace) is applied from core's plugin templates
 * (`services/plugins/installBundle.ts`), and when core ships new templates the
 * app is applied again (`services/plugins/upgradeBundles.ts`). Between the two,
 * a person may have changed a row the bundle owns: an agent's prompt, an
 * automation's schedule. Without a record of what the bundle wrote, "this
 * differs from the new template" cannot say whether core moved or a person
 * did.
 *
 * So each install records, per row and per field, a hash of the value the
 * bundle left there (read back after the write, so a jsonb round trip cannot
 * fake an edit). The next apply compares the row as it stands with that hash:
 *
 * - **equal** — nobody touched it since the bundle wrote it: the new template
 *   wins.
 * - **different** — a person (or an agent acting for one) changed it: their
 *   value is kept, and the field is recorded as kept on the version row. The
 *   old hash is carried forward, so the field stays theirs on every later
 *   upgrade until they put it back.
 * - **no hash** (a row installed before this record existed) — nothing can
 *   tell the two apart, so the template wins, as it always did.
 *
 * Lifecycle fields (`active`, `status`) are not tracked: turning the app off
 * and on owns them, and a person's hold lives in its own columns
 * (`paused_at`), which no apply writes.
 */

import { createHash } from 'node:crypto';
import { canonical } from '@/libs/sources/upsert';

/** The bundle rows whose fields are tracked: the ones a person shapes. */
export type TrackedResource = 'agent' | 'mission' | 'automation';

/** Field name → hash of the value the bundle left in it. */
export type FieldHashes = Record<string, string>;

/** Per resource, per slug: what the bundle last left in each field. */
export type BundleFields = Partial<Record<TrackedResource, Record<string, FieldHashes>>>;

/**
 * One field an apply left as a person had changed it. A playbook's is its
 * text (`field: 'text'`): the workspace's own copy, kept whole
 * (`services/playbooks/owned.ts`).
 */
export type KeptChange = { resource: TrackedResource | 'trustRule' | 'playbook'; slug: string; field: string };

/** What an apply of the bundle needs to keep edits, and what it reports back. */
export type BundleTrack = {
  /** What the bundle last left here, merged from the app's version rows. */
  last: BundleFields;
  /** Filled by the apply: fields kept as a person changed them. */
  kept: KeptChange[];
  /** Filled by the apply: per resource and slug, the fields it owns, for the next record. */
  wrote: Partial<Record<TrackedResource, Record<string, string[]>>>;
};

/** Recorded on the `workspace_version` row of an app install or upgrade (`bundle`). */
export type AppBundleRecord = {
  /** Plugin slug → hash of its templates as this image ships them. */
  hashes: Record<string, string>;
  /** Plugin slug → what it shipped, so the next upgrade can tell what it dropped. */
  contents: Record<string, { agents: string[]; missions: string[]; automations: string[] }>;
  /** What the bundle left in each field it owns. */
  fields: BundleFields;
  /**
   * Playbook slug → hash of the text the bundle last left in the workspace's
   * copy (`services/playbooks/owned.ts`). A copy whose text no longer hashes
   * to this was edited, and an upgrade keeps it.
   */
  playbooks?: Record<string, string>;
  /** Fields left as a person changed them. */
  kept: KeptChange[];
  /** An upgrade: each plugin's hash before it (null when it was never recorded). */
  from?: Record<string, string | null>;
  /** An upgrade: what the old templates shipped and the new ones do not, disabled and kept. */
  retired?: { agents: string[]; missions: string[]; automations: string[] };
};

/** Fields no apply tracks: identity, and the lifecycle the app switch owns. */
const UNTRACKED = new Set(['orgId', 'slug', 'active', 'status']);

/**
 * A short, order-independent hash of a stored value.
 * @param value - A column's value; undefined reads as null.
 */
export function valueHash(value: unknown): string {
  return createHash('sha256').update(canonical(value ?? null)).digest('hex').slice(0, 16);
}

/**
 * Before a bundle row is written: keep, in `payload`, every field a person
 * changed since the bundle last wrote it, and note the fields this row owns.
 * Mutates `payload`; returns the fields kept. No track (a folder apply) is a
 * no-op.
 * @param track - The apply's track, or undefined.
 * @param resource - Which table.
 * @param slug - Which row.
 * @param existing - The row as it stands, when there is one.
 * @param payload - What the bundle is about to write.
 */
export function keepEdits(
  track: BundleTrack | undefined,
  resource: TrackedResource,
  slug: string,
  existing: Record<string, unknown> | undefined,
  payload: Record<string, unknown>,
): string[] {
  if (!track) {
    return [];
  }
  const fields = Object.keys(payload).filter(f => !UNTRACKED.has(f));
  (track.wrote[resource] ??= {})[slug] = fields;
  const last = track.last[resource]?.[slug];
  if (!existing || !last) {
    return [];
  }
  const kept: string[] = [];
  for (const field of fields) {
    const before = last[field];
    if (before === undefined) {
      continue;
    }
    const now = valueHash(existing[field]);
    if (now !== before && now !== valueHash(payload[field])) {
      payload[field] = existing[field];
      kept.push(field);
      track.kept.push({ resource, slug, field });
    }
  }
  return kept;
}

/**
 * The record of what an apply left, from the rows read back after it: a kept
 * field carries its old hash forward (it is still the person's), every other
 * field the hash of what is stored now.
 * @param track - The apply's track.
 * @param rows - Per resource, the rows it wrote, as stored now.
 */
export function fieldsAfter(track: BundleTrack, rows: Partial<Record<TrackedResource, ReadonlyArray<Record<string, unknown> & { slug: string }>>>): BundleFields {
  const out: BundleFields = {};
  for (const [resource, bySlug] of Object.entries(track.wrote) as Array<[TrackedResource, Record<string, string[]>]>) {
    for (const row of rows[resource] ?? []) {
      const fields = bySlug[row.slug];
      if (!fields) {
        continue;
      }
      const kept = new Set(track.kept.filter(k => k.resource === resource && k.slug === row.slug).map(k => k.field));
      const last = track.last[resource]?.[row.slug] ?? {};
      (out[resource] ??= {})[row.slug] = Object.fromEntries(fields.map(f => [f, kept.has(f) && last[f] ? last[f] : valueHash(row[f])]));
    }
  }
  return out;
}

/**
 * Fold version rows' records, oldest first, into what the bundle last left
 * per row: a later record of a row replaces an earlier one whole.
 * @param records - The `bundle` of each app version row, oldest first.
 */
export function mergeFields(records: ReadonlyArray<Pick<AppBundleRecord, 'fields'>>): BundleFields {
  const out: BundleFields = {};
  for (const r of records) {
    for (const [resource, bySlug] of Object.entries(r.fields ?? {}) as Array<[TrackedResource, Record<string, FieldHashes>]>) {
      Object.assign(out[resource] ??= {}, bySlug);
    }
  }
  return out;
}
