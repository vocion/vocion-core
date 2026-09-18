/**
 * The YAML in the eval guides has to be YAML the loader would accept.
 *
 * A guide is the first thing someone copies from, and a wrong example costs
 * them an apply cycle and a confusing error about a field they did not write.
 * These examples were wrong for exactly that reason once already — written as
 * a list under a top-level `evals:` key, when the loader reads one bare
 * manifest per file — and nothing failed when they were.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AutomationManifestSchema, EvalDatasetManifestSchema } from './schemas';

/**
 * Every guide whose YAML examples are meant to be copied and applied.
 *
 * Both are read by the same assertion because the failure they guard against is
 * the same one: someone copies a block, applies it, and gets an error about a
 * field they did not write.
 */
const GUIDES = [
  join(import.meta.dirname, '../../../../../docs/guides/agentcore-evals.md'),
  join(import.meta.dirname, '../../../../../docs/guides/evals.md'),
];

/** One fenced block, and which guide it came from, so a failure names the file. */
type GuideBlock = {
  guide: string;
  index: number;
  block: string;
};

/**
 * Every YAML block across every guide, tagged with where it came from.
 * @param guides - Absolute paths to the guides to read.
 */
function blocksAcross(guides: string[]): GuideBlock[] {
  const collected: GuideBlock[] = [];
  for (const guide of guides) {
    yamlBlocksIn(readFileSync(guide, 'utf8')).forEach((block, index) => {
      collected.push({ guide: basename(guide), index, block });
    });
  }
  return collected;
}

/**
 * Every fenced YAML block in a Markdown document.
 *
 * A block inside a numbered list is indented on the page. Only the shared
 * leading indent comes off — stripping a fixed number of spaces would flatten
 * the nesting that makes the YAML mean what it means.
 * @param markdown - The document to read.
 */
function yamlBlocksIn(markdown: string): string[] {
  const blocks: string[] = [];
  const fence = /```yaml\n([\s\S]*?)```/g;
  let match = fence.exec(markdown);
  while (match) {
    blocks.push(dedent(match[1]!));
    match = fence.exec(markdown);
  }
  return blocks;
}

/**
 * Remove the indentation every non-blank line shares.
 * @param block - The block as it appears on the page.
 */
function dedent(block: string): string {
  const lines = block.split('\n');
  const indents = lines
    .filter(line => line.trim().length > 0)
    .map(line => line.length - line.trimStart().length);
  const shared = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map(line => line.slice(shared)).join('\n');
}

/**
 * Which manifest a block is, by what it carries.
 *
 * A block with no `slug` is a fragment shown in place — the `evaluators` list
 * on its own — and is checked against the piece of the schema it belongs to
 * rather than as a whole file.
 * @param doc - One parsed block.
 */
function describeBlock(doc: Record<string, unknown>): 'automation' | 'evalDataset' | 'evaluatorsFragment' {
  if ('when' in doc) {
    return 'automation';
  }
  if (!('slug' in doc) && 'evaluators' in doc) {
    return 'evaluatorsFragment';
  }
  return 'evalDataset';
}

describe('the eval guides\' examples', () => {
  const blocks = blocksAcross(GUIDES);

  it('has examples to check', () => {
    // A rename or a rewrite that empties a guide would otherwise make every
    // assertion below pass by having nothing to assert on.
    expect(blocks.length).toBeGreaterThan(3);
  });

  it('covers every guide', () => {
    // One guide losing all of its YAML would still leave the count above
    // healthy, because the other guide's blocks would carry it.
    for (const guide of GUIDES) {
      expect(blocks.filter(entry => entry.guide === basename(guide))).not.toEqual([]);
    }
  });

  it('every example is something the workspace loader would accept', () => {
    const failures: string[] = [];
    for (const entry of blocks) {
      const doc = parseYaml(entry.block) as Record<string, unknown>;
      const kind = describeBlock(doc);
      const where = `${entry.guide} block ${entry.index}`;
      if (kind === 'evaluatorsFragment') {
        // Graft the fragment onto the smallest valid dataset so the evaluator
        // entries themselves are still checked.
        const grafted = {
          slug: 'fragment-host',
          name: 'Fragment host',
          agentSlug: 'support-agent',
          provider: 'agentcore',
          items: [{ input: 'hello' }],
          ...doc,
        };
        const result = EvalDatasetManifestSchema.safeParse(grafted);
        if (!result.success) {
          failures.push(`${where} (evaluators fragment): ${result.error.issues.map(i => i.message).join('; ')}`);
        }
        continue;
      }
      const schema = kind === 'automation' ? AutomationManifestSchema : EvalDatasetManifestSchema;
      const result = schema.safeParse(doc);
      if (!result.success) {
        failures.push(`${where} (${kind}): ${result.error.issues.map(i => i.message).join('; ')}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
