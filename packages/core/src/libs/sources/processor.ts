/**
 * Which document processor a source runs, and with what settings.
 *
 * Same convention as `_connector` and `_manifestDir`: a reserved key inside
 * the stored `config_json` blob, stamped by whoever wrote the source (the
 * workspace applier, or the sources API), and read back at sync time. A
 * processor is not part of any connector's config, the same web source may or
 * may not extract candidates from what it fetches, so it cannot live inside
 * the connector's own schema, and a second column for a feature most tenants
 * never use is not worth a migration.
 *
 * The blob holds the AUTHORED config, not the parsed one. Defaults are applied
 * when the run starts: storing them would bake today's default into every row,
 * so changing one later would rewrite every source's config and trigger a
 * full re-sync of all of them.
 */

/** Config key holding the processor this source runs. */
const PROCESSOR_KEY = '_processor';

export type ProcessorRef = {
  /** Slug of a processor in `libs/processors/registry`. */
  slug: string;
  /** The authored config blob, validated against that processor's schema. */
  config: Record<string, unknown>;
};

/**
 * Attach a processor reference to a source config blob.
 * @param config - The authored `config:` block from the source manifest.
 * @param ref - The processor this source runs, or undefined for none.
 */
export function withProcessor(
  config: Record<string, unknown>,
  ref: ProcessorRef | undefined,
): Record<string, unknown> {
  return ref ? { ...config, [PROCESSOR_KEY]: { slug: ref.slug, config: ref.config } } : { ...config };
}

/**
 * The processor a stored source config names, if any.
 *
 * Defensive about the shape: this is JSON read back from the database, which
 * an older writer or a hand-edited row may have left in any state at all.
 * @param config - The stored source config (may carry `_processor`).
 */
export function processorRefOf(config: Record<string, unknown> | undefined): ProcessorRef | undefined {
  const declared = config?.[PROCESSOR_KEY];
  if (!declared || typeof declared !== 'object') {
    return undefined;
  }
  const { slug, config: processorConfig } = declared as { slug?: unknown; config?: unknown };
  if (typeof slug !== 'string' || slug.length === 0) {
    return undefined;
  }
  return {
    slug,
    config: processorConfig && typeof processorConfig === 'object' ? processorConfig as Record<string, unknown> : {},
  };
}
