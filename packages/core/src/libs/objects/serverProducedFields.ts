const SERVER_PRODUCED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  seo_page: ['publicationVerification'],
  seo_audit: ['projectId', 'site', 'checkedAt', 'findings', 'coverage', 'counts', 'openCount', 'highCount', 'pagesRead', 'listed', 'nextSteps', 'report', 'reportArtifactId', 'inventoryArtifactId', 'previousAuditId'],
};

/**
 * Fields only their domain evidence service may create or change.
 * @param typeSlug
 */
export function serverProducedFields(typeSlug: string): readonly string[] {
  return SERVER_PRODUCED_FIELDS[typeSlug.trim().toLowerCase()] ?? [];
}

/**
 * Evidence created by a verifier cannot be supplied through generic record editing or import.
 * @param typeSlug
 * @param fields
 */
export function serverProducedFieldsRefusal(typeSlug: string, fields: Record<string, unknown> = {}): string | undefined {
  const protectedKeys = serverProducedFields(typeSlug).filter(key => key in fields);
  return protectedKeys.length
    ? `${protectedKeys.join(', ')} ${protectedKeys.length === 1 ? 'is' : 'are'} server-produced evidence. Use the domain audit or publication verification workflow; generic record writes cannot create, replace, or clear it.`
    : undefined;
}
