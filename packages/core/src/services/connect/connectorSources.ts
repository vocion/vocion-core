/**
 * The one rule for "this connector's sources", shared by the login callback
 * and the one-time move of old logins, so the two can never disagree.
 */

import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { knowledgeSourceSchema } from '@/models/Schema';

/**
 * A where-clause fragment: the source runs this connector. The connector is
 * named in `config_json._connector`; older rows predate that hint and are
 * named by their own slug. Same rule `findSourceBySlug` uses.
 * @param connectorSlug - The connector, e.g. `github`.
 */
export function sourceIsOfConnector(connectorSlug: string): SQL {
  return sql`coalesce(${knowledgeSourceSchema.configJson}->>'_connector', ${knowledgeSourceSchema.slug}) = ${connectorSlug}`;
}
