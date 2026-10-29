/**
 * The workflow manifest: agent steps, bounded repeats, conditions and labels
 * (ADR 0011), and the guide's examples, which have to be YAML the loader
 * accepts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { WorkflowManifestSchema } from './schemas';
import { assertWorkflowSteps } from './workflowSteps';

const base = { slug: 'page-pipeline', name: 'Write one page', trigger: { type: 'manual' } };

const research = {
  name: 'research',
  type: 'agent',
  label: 'Researching "{{input.keyword}}"',
  agent: 'serp-analyst',
  task: 'Research Google\'s top results for page {{input.page_id}} and save the SERP brief.',
  effort: 'standard',
  tools: ['web_search'],
  output: { type: 'object', required: ['briefArtifactId'], properties: { briefArtifactId: { type: 'integer' } } },
};

const review = {
  name: 'edit',
  type: 'repeat',
  until: '{{steps.review.output.verdict}} == \'pass\'',
  max: 3,
  steps: [
    { name: 'review', type: 'agent', agent: 'seo-editor', task: 'Review {{steps.research.output.briefArtifactId}}', output: { type: 'object', properties: { verdict: { enum: ['pass', 'revise'] } } } },
    { name: 'revise', type: 'agent', agent: 'seo-writer', task: 'Revise it.' },
  ],
};

/**
 * Parse a manifest and return the messages of its problems.
 * @param manifest - The raw manifest.
 */
function problems(manifest: unknown): string[] {
  const r = WorkflowManifestSchema.safeParse(manifest);
  return r.success ? [] : r.error.issues.map(i => i.message);
}

describe('WorkflowManifestSchema', () => {
  it('accepts an agent step, a bounded repeat, a run label and a condition', () => {
    const r = WorkflowManifestSchema.safeParse({
      ...base,
      runLabel: '{{input.batch_ref}} · page {{input.index}} of {{input.total}}',
      steps: [research, review, { name: 'signoff', type: 'approve', prompt: 'Sign off', reviews: 'review' }, { name: 'publish', type: 'action', action: 'site.publish_page', when: '{{input.target}} != \'none\'', input: {} }],
    });

    expect(r.success).toBe(true);

    const edit = r.success ? r.data.steps[1] : null;

    expect(edit?.type === 'repeat' && edit.onExhausted).toBe('continue');
  });

  it('requires a repeat\'s max, and holds it to 1–10', () => {
    const { max: _max, ...noMax } = review;

    expect(problems({ ...base, steps: [research, noMax] }).length).toBeGreaterThan(0);
    expect(problems({ ...base, steps: [research, { ...review, max: 11 }] }).length).toBeGreaterThan(0);
    expect(problems({ ...base, steps: [research, { ...review, max: 0 }] }).length).toBeGreaterThan(0);
  });

  it('refuses a gate or a nested group inside a repeat', () => {
    expect(problems({ ...base, steps: [research, { ...review, steps: [...review.steps, { name: 'ok', type: 'approve', prompt: 'ok?' }] }] }).length).toBeGreaterThan(0);
    expect(problems({ ...base, steps: [research, { ...review, steps: [{ ...review, name: 'inner' }] }] }).length).toBeGreaterThan(0);
  });

  it('refuses a condition that is not one comparison', () => {
    expect(problems({ ...base, steps: [{ ...research, when: '{{input.n}} > 3' }] })).toEqual([expect.stringContaining('is not a condition')]);
    expect(problems({ ...base, steps: [research, { ...review, until: 'verdict is pass' }] })).toEqual([expect.stringContaining('is not a condition')]);
  });

  it('refuses an output that is not an object schema, and an unknown effort', () => {
    expect(problems({ ...base, steps: [{ ...research, output: { type: 'string' } }] })).toEqual([expect.stringContaining('type: object')]);
    expect(problems({ ...base, steps: [{ ...research, effort: 'max' }] }).length).toBeGreaterThan(0);
  });

  it('refuses two steps with one name, inside a group or not', () => {
    expect(problems({ ...base, steps: [research, { ...review, steps: [{ ...review.steps[0], name: 'research' }] }] })).toContainEqual(expect.stringContaining('"research" is used twice'));
  });

  it('refuses a reference to a step that does not exist', () => {
    expect(problems({ ...base, steps: [{ ...research, task: 'Use {{steps.reserch.output.briefArtifactId}}' }] })).toEqual([expect.stringContaining('names step "reserch"')]);
  });

  it('still accepts a workflow with only the old steps', () => {
    expect(problems({ ...base, steps: [{ name: 'notes', type: 'ask', prompt: 'Paste', outputAs: 'release-notes' }, { name: 'go', type: 'action', action: 'gmail.send', input: { body: '{{steps.release-notes.output}}' } }] })).toEqual([]);
  });
});

describe('assertWorkflowSteps', () => {
  const wf = (steps: unknown[]) => ({ slug: 'p', sourceFile: 'workflows/p/workflow.yaml', steps: steps as never });

  it('passes when every agent step names an agent the workspace has', () => {
    expect(() => assertWorkflowSteps([{ slug: 'serp-analyst' }, { slug: 'seo-editor' }, { slug: 'seo-writer' }], [wf([research, review])])).not.toThrow();
  });

  it('names an agent step whose agent is missing, inside a group too', () => {
    expect(() => assertWorkflowSteps([{ slug: 'serp-analyst' }], [wf([research, review])])).toThrow(/step "review" asks agent "seo-editor"/);
  });

  it('names an output schema that does not compile', () => {
    expect(() => assertWorkflowSteps([{ slug: 'serp-analyst' }], [wf([{ ...research, output: { type: 'object', properties: { a: { type: 'nonsense' } } } }])])).toThrow(/does not compile/);
  });
});

describe('the workflows guide', () => {
  const guide = readFileSync(join(import.meta.dirname, '../../../../../docs/guides/workflows.md'), 'utf8');
  const manifests = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => parseYaml(m[1]!) as unknown).filter((y): y is Record<string, unknown> => y !== null && typeof y === 'object' && !Array.isArray(y) && 'slug' in y);

  it('has whole workflows to copy', () => {
    expect(manifests.map(m => m.slug)).toEqual(['seo-page', 'seo-batch']);
  });

  it.each(manifests.map(m => [m.slug, m] as const))('%s is a workflow the loader accepts', (_slug, manifest) => {
    expect(problems(manifest)).toEqual([]);
  });
});
