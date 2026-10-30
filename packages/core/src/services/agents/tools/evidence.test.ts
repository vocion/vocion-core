/**
 * The `locate_evidence` / `expand_evidence` tools (ADR 0012) over the eval's made-up workspace.
 */
import { describe, expect, it } from 'vitest';
import { corpusGraph } from '@/services/evals/wikiEvidence/corpus';
import { evidenceOn, expandEvidenceTool, locateEvidenceTool } from './evidence';

const graph = corpusGraph();
const provider = async () => graph;

describe('evidence tools', () => {
  it('are on only with the wiki and wiki-evidence plugins', () => {
    expect(evidenceOn({ enabledPlugins: ['wiki', 'wiki-evidence'] })).toBe(true);
    expect(evidenceOn({ enabledPlugins: ['wiki-evidence'] })).toBe(false);
    expect(evidenceOn({ enabledPlugins: ['wiki'] })).toBe(false);
  });

  it('locates nodes by words', async () => {
    const out = String(await locateEvidenceTool(provider).invoke({ terms: 'per diem travel' }));

    expect(out).toMatch(/wiki:travel|doc:10[12]/);
  });

  it('expands a stale claim to its changed passage, and says so for an unknown node', async () => {
    const tool = expandEvidenceTool(provider);

    expect(String(await tool.invoke({ node: 'claim:refunds#1' }))).toMatch(/SOURCE CHANGED/);
    expect(String(await tool.invoke({ node: 'doc 999' }))).toMatch(/not|no /i);
  });
});
