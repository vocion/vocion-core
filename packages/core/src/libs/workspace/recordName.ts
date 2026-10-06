/**
 * A RECORD'S NAME, TICKET-SIZED (Chris, 2026-10-03: "The title is too long
 * and verbose … we need a better ticket-sized name for what the feature is;
 * not a full request or spec in the title").
 *
 * A record filed from chat often carried the person's whole ask as its title
 * ("On the library list, let me sort the documents by name, upload date or
 * last opened, newest first by default, and remember my choice…"), and every
 * surface that leads with the title then led with a paragraph. The ask is
 * evidence and is kept verbatim where the type keeps it (its body); the name
 * is what a person reads the work by.
 *
 * A record's short name lives on `metadata.name` — written when a long title
 * is read into a name by a model (`services/objects/recordName.ts`), at filing
 * or later. Where that has not happened, the title IS the name. One rule,
 * read here, by every surface that shows a record's name.
 *
 * Pure and client-safe.
 */

/** The longest a name is: one line on a phone, a ticket's title. */
export const NAME_MAX = 60;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.replace(/\s+/g, ' ').trim() : null;
}

/**
 * What a person reads a record by: its short name when one is stored, else its title.
 * @param title - The record's title.
 * @param meta - Its metadata.
 */
export function recordName(title: string, meta: Record<string, unknown> | null | undefined): string {
  return text(meta?.name) ?? title;
}

/**
 * Whether a record wants a name read for it: its title is longer than a
 * name and none is stored yet.
 * @param title - The record's title.
 * @param meta - Its metadata.
 * @param max - The type's limit, when it declares one.
 */
export function wantsName(title: string, meta: Record<string, unknown> | null | undefined, max: number = NAME_MAX): boolean {
  return text(meta?.name) === null && title.replace(/\s+/g, ' ').trim().length > max;
}
