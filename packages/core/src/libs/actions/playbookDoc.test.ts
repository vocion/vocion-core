import { describe, expect, it } from 'vitest';
import { composePlaybookDoc, splitPlaybookDoc } from './playbook-write';

/**
 * A playbook self-update rewrites the PROCEDURE and never the manifest.
 *
 * The manifest is structure the workspace applier validates; letting a
 * confidence score rewrite it would put schema errors behind a threshold, and
 * an apply that fails leaves the workspace in a state nobody asked for. So the
 * frontmatter is carried across verbatim, and these tests are the guarantee.
 */

const EXISTING = `---
slug: queue-health-note
name: Queue health note
description: How the daily note is written.
version: 3
---

## When

Every morning.
`;

describe('writing a playbook without touching its manifest', () => {
  it('splits the authored file into its frontmatter and its body', () => {
    const { frontmatter, body } = splitPlaybookDoc(EXISTING);

    expect(frontmatter).toContain('slug: queue-health-note');
    expect(frontmatter).toContain('version: 3');
    expect(body).toBe('## When\n\nEvery morning.');
  });

  it('keeps the existing manifest exactly, including a version the agent never sees', () => {
    const next = composePlaybookDoc({
      existing: EXISTING,
      slug: 'queue-health-note',
      // Even when the proposal carries a different name, the authored
      // manifest wins: the agent is revising a procedure, not renaming one.
      name: 'Something the agent made up',
      description: 'Also made up.',
      body: '## When\n\nBefore standup, and after the first escalation.',
    });

    expect(next).toContain('name: Queue health note');
    expect(next).toContain('version: 3');
    expect(next).not.toContain('Something the agent made up');
    expect(next).toContain('Before standup, and after the first escalation.');
  });

  it('builds a minimal, valid manifest for a playbook that does not exist yet', () => {
    const next = composePlaybookDoc({
      existing: null,
      slug: 'breach-watch',
      name: 'Breach watch',
      description: 'What to do when an SLA is at risk.',
      body: '## Steps\n\n1. Name the ticket.',
    });

    expect(next.startsWith('---\nslug: breach-watch\n')).toBe(true);
    expect(splitPlaybookDoc(next).body).toBe('## Steps\n\n1. Name the ticket.');
  });

  it('treats a file with no frontmatter as all body, so nothing is silently dropped', () => {
    expect(splitPlaybookDoc('just prose').body).toBe('just prose');
    expect(splitPlaybookDoc('just prose').frontmatter).toBeNull();
  });
});
