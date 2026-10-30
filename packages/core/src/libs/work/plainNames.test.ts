/**
 * Every shipped mission, automation, workflow, team and agent is named by
 * what is done, to what — never by its slug or a word that only says work is
 * happening (`plainNames.ts`). Reads every definition under
 * `packages/core/templates`, so a plugin that ships "Seo continue" or "Keep
 * the pipeline humming" fails here, naming the file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { fromRepoRoot } from '@/libs/repo-root';
import { nameProblem } from './plainNames';

const KINDS = new Set(['missions', 'automations', 'workflows', 'teams', 'agents']);

/**
 * Every definition file: `<kind>/<slug>.yaml`, or `workflows/<slug>/workflow.yaml`.
 * @param dir - The directory to read.
 * @param out - The files found so far.
 */
function definitions(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      definitions(abs, out);
    } else if (/\.ya?ml$/.test(entry) && (KINDS.has(basename(dirname(abs))) || (entry === 'workflow.yaml' && basename(dirname(dirname(abs))) === 'workflows'))) {
      out.push(abs);
    }
  }
  return out;
}

describe('nameProblem', () => {
  it('passes a name that says what is done, to what', () => {
    expect(nameProblem('Draft the release announcement', 'release-announcement-draft')).toBeNull();
    expect(nameProblem('Advance approved SEO batches: research, brief, draft and review the next pages', 'seo-batches-moving')).toBeNull();
    expect(nameProblem('Finance', 'finance')).toBeNull();
  });

  it('refuses a slug, or a slug title-cased', () => {
    expect(nameProblem('seo-continue', 'seo-continue')).toContain('slug');
    expect(nameProblem('Seo continue', 'seo-continue')).toContain('slug');
    expect(nameProblem('', 'x')).toBe('has no name');
  });

  it('refuses the few words that only say work is happening', () => {
    for (const name of ['Every client\'s SEO pages keep moving', 'Continue the SEO work', 'Weekday queue sweep', 'Carry stuck requests on', 'Nudge the late payers', 'Daily pulse', 'Factory heartbeat', 'Stay on top of the inbox', 'Keeps the books humming', 'Every client hears what moved']) {
      expect(nameProblem(name, 'any-slug'), name).not.toBeNull();
    }
  });

  it('does not flag a word that merely contains one', () => {
    expect(nameProblem('Check the tickets waiting on a reply', 'ticket-check')).toBeNull();
    expect(nameProblem('Remove duplicate contacts', 'dedupe')).toBeNull();
  });
});

describe('every shipped definition has a plain name', () => {
  const root = fromRepoRoot('packages/core/templates');
  const files = existsSync(root) ? definitions(root) : [];

  it('finds the definitions', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('names each one by what is done, to what', () => {
    const problems: string[] = [];
    for (const file of files) {
      const doc = parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null;
      if (!doc || typeof doc !== 'object') {
        continue;
      }
      const rel = relative(root, file);
      const slug = typeof doc.slug === 'string' ? doc.slug : basename(file).replace(/\.ya?ml$/, '') === 'workflow' ? basename(dirname(file)) : basename(file).replace(/\.ya?ml$/, '');
      // A durable flow is addressed by `<plugin>/<flow>` (`libs/durable/flowDefinitions.ts`):
      // that `name` is its reference, not a display name.
      const flowRef = /^plugins\/([^/]+)\/workflows\/([^/]+)\.ya?ml$/.exec(rel);
      if (flowRef && doc.name === `${flowRef[1]}/${flowRef[2]}`) {
        continue;
      }
      // An automation's `label` and `doing` title its runs (`libs/factory/runTitle.ts`), so they are held to it too.
      for (const field of ['name', 'label', 'doing'] as const) {
        if (field !== 'name' && (doc[field] === undefined || !rel.includes('/automations/'))) {
          continue;
        }
        // A role is often named exactly as its slug reads ("Product manager", `product-manager`),
        // so agents and teams are held only to the raw-slug and vague-word rules.
        const problem = nameProblem(typeof doc[field] === 'string' ? doc[field] : null, /\/(?:agents|teams)\//.test(`/${rel}`) ? null : slug);
        if (problem) {
          problems.push(`${rel} ${field}: ${problem}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
