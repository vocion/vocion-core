/**
 * Registry of document processors, by slug.
 *
 * Deliberately NOT the static-import pattern of `libs/sources/registry.ts`.
 * A processor's `run` is the expensive half, a model client, a prompt, an
 * HTTP hop, and two static import graphs would pull it in whether a tenant
 * uses it or not: `SourceSyncService` (and through it the Temporal worker) and
 * `libs/workspace/applier.ts`, which validates a processor's config
 * synchronously while applying a workspace.
 *
 * So each entry is split. Everything needed to VALIDATE and to decide whether
 * to run at all, the config schema, the name, `runsOn`, is eager and
 * model-free; `run` sits behind `load()`, a dynamic import that only happens
 * once a document has actually been ingested for a source that declares the
 * processor. Apply-time validation therefore never touches a model library, and
 * a worker whose tenants declare no processor never loads one.
 */

import type { z } from 'zod';
import type { DocumentProcessor } from './types';
import { CANDIDATE_EXTRACTOR_DOCUMENT_TIMEOUT_MS, candidateExtractorConfigSchema } from './candidateExtractor/config';

/**
 * A processor as the registry holds it: its eager half, plus the loader for
 * the half that is only needed when a document is actually processed.
 */
export type RegisteredProcessor = Omit<DocumentProcessor, 'run'> & {
  load: () => Promise<Pick<DocumentProcessor, 'run'>>;
};

const registry = new Map<string, RegisteredProcessor>([
  ['candidate-extractor', {
    slug: 'candidate-extractor',
    name: 'Candidate extractor',
    description: 'Reads each changed document and proposes review candidates of a configured object type.',
    configSchema: candidateExtractorConfigSchema,
    // Two model attempts, a ticket hop and the proposals, see the constant.
    documentTimeoutMs: CANDIDATE_EXTRACTOR_DOCUMENT_TIMEOUT_MS,
    load: () => import('./candidateExtractor/run'),
  }],
]);

/**
 * The processor registered under a slug, or undefined when nothing is.
 * @param slug - Processor slug, as written in a manifest's `processor.slug`.
 */
export function getProcessor(slug: string): RegisteredProcessor | undefined {
  return registry.get(slug);
}

/**
 * The schema validating a processor's config blob, eager, and free of any
 * model code, so the applier can call it while parsing a workspace.
 * @param slug - Processor slug, as written in a manifest's `processor.slug`.
 */
export function processorConfigSchema(slug: string): z.ZodTypeAny | undefined {
  return registry.get(slug)?.configSchema;
}

/** Every registered slug, for error messages that name the alternatives. */
export function listProcessorSlugs(): string[] {
  return [...registry.keys()];
}
