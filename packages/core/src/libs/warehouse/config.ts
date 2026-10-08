/**
 * The settings every warehouse source shares, whatever the vendor: the
 * schemas the agent may read, and the limits on one query. Each warehouse
 * connector spreads these into its own `configSchema`, and `configFields.ts`
 * asks for them with `warehouseConfigFields`, so the four forms read the same.
 */

import type { ConfigField } from '@/libs/sources/configFields';
import { z } from 'zod';

/** The zod shape every warehouse config spreads in. */
export const warehouseConfigShape = {
  /**
   * The schemas the agent may read, and nothing else: a query that reads an
   * object outside them is refused before it runs. At least one, so a
   * connected warehouse never means "everything the key can see".
   */
  schemas: z.array(z.string().min(1)).min(1),
  /** The most rows one query hands back. */
  maxRows: z.number().int().min(1).max(10_000).default(1000),
  /** The most kilobytes of rows one query hands back. */
  maxResultKb: z.number().int().min(16).max(20_000).default(2000),
  /** How long the engine may run one statement before it cancels it. */
  timeoutSeconds: z.number().int().min(5).max(900).default(60),
};

/**
 * The form fields for the shared settings, after the vendor's own.
 * @param schemaWord - What this warehouse calls a schema ("schema", "dataset").
 * @param example - An allowlist entry the way this warehouse writes one.
 */
export function warehouseConfigFields(schemaWord: string, example: string): ConfigField[] {
  return [
    {
      key: 'schemas',
      label: `Allowed ${schemaWord}s`,
      type: 'stringArray',
      required: true,
      placeholder: example,
      help: `The only ${schemaWord}s an agent may read. A query that reads anything else is refused before it runs. Separate with commas.`,
    },
    {
      key: 'maxRows',
      label: 'Most rows per query',
      type: 'number',
      advanced: true,
      defaultValue: 1000,
      min: 1,
      max: 10_000,
      help: 'Rows past this are not read back. The agent is told the result was cut.',
    },
    {
      key: 'maxResultKb',
      label: 'Most kilobytes per query',
      type: 'number',
      advanced: true,
      defaultValue: 2000,
      min: 16,
      max: 20_000,
      help: 'The rows handed back stop at this size, whatever the row count.',
    },
    {
      key: 'timeoutSeconds',
      label: 'Statement timeout (seconds)',
      type: 'number',
      advanced: true,
      defaultValue: 60,
      min: 5,
      max: 900,
      help: 'The warehouse cancels a statement that runs longer than this.',
    },
  ];
}
