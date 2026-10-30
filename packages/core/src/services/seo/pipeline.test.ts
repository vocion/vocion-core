/**
 * The SEO pipeline's workflows ship with the plugin: a workspace with the SEO
 * app loads them (a plugin's workflows join the workspace's; a workspace
 * workflow of the same slug wins), and each is valid as the engine reads it.
 * The page run's steps are the procedure the agency named: research, brief,
 * draft, the editor's review at most three rounds, the person's one sign-off,
 * the sign-off recorded, publishing as a draft, and going live for
 * Squarespace on its own card.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from '@/libs/workspace/loader';
import { seoPageRunOf } from './pipeline';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function workspace(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'seo-pipeline-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: t\nname: t\nplugins: [seo]\n');
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

describe('the SEO pipeline\'s workflows', () => {
  it('ship with the plugin and load valid, the page run in the agency\'s order', () => {
    const ws = loadWorkspace(workspace());
    const bySlug = Object.fromEntries(ws.workflows.map(w => [w.slug, w]));

    expect(Object.keys(bySlug).sort()).toEqual(['seo-batch', 'seo-opportunities', 'seo-page', 'seo-plan']);

    const page = bySlug['seo-page']!;

    expect(page.steps.map(s => `${s.name}:${s.type}`)).toEqual(['feedback:agent', 'research:agent', 'brief:agent', 'draft:agent', 'edit:repeat', 'signoff:approve', 'record:action', 'publish:action', 'go-live:action']);

    const edit = page.steps.find(s => s.name === 'edit') as { max: number; until: string; onExhausted: string };

    expect(edit).toMatchObject({ max: 3, until: '{{steps.review.output.verdict}} == \'pass\'', onExhausted: 'continue' });
    expect(page.steps.filter(s => s.type === 'action').map(s => (s as { action: string }).action)).toEqual(['seo.record_signoff', 'site.publish_page', 'site.publish_live']);
    expect(bySlug['seo-batch']!.steps[0]).toMatchObject({ type: 'action', action: 'workflow.start' });
  });

  it('lets a workspace keep its own version of one', () => {
    const own = 'slug: seo-plan\nname: Our plan revision\nagent: seo-strategist\ntrigger: {type: manual}\nsteps:\n  - {name: revise, type: agent, agent: seo-strategist, task: Revise it.}\n';
    const ws = loadWorkspace(workspace({ 'workflows/seo-plan/workflow.yaml': own }));

    expect(ws.workflows.filter(w => w.slug === 'seo-plan').map(w => w.name)).toEqual(['Our plan revision']);
  });

  it('knows a turn that runs inside a page run', () => {
    expect(seoPageRunOf('workflow:seo-page:42')).toBe(42);
    expect(seoPageRunOf('workflow:seo-plan:42')).toBeNull();
    expect(seoPageRunOf('usr-mara')).toBeNull();
  });
});
