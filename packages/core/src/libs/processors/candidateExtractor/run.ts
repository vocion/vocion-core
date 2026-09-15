/**
 * The `candidate-extractor` model stage.
 *
 * Placeholder: this file is what the registry's lazy `import()` resolves to,
 * so the hook, the config schema and the apply-time validation can land and be
 * tested without any model code in the tree. The stage that reads the document,
 * calls the model and proposes candidates replaces this body.
 *
 * Whatever lands here may import LangChain and a model client. Nothing else in
 * the processor tree may: `scripts/temporal-worker.imports.test.ts` asserts
 * this file is unreachable from the worker's static import graph, which is only
 * true while the registry reaches it through a dynamic import.
 */

import type { DocumentProcessor } from '../types';

export const run: DocumentProcessor['run'] = () => {
  throw new Error('candidate-extractor: model stage not implemented yet');
};
