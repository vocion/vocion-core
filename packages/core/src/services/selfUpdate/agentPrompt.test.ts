import { describe, expect, it } from 'vitest';
import { replaceInlinePrompt } from './agentPrompt';

/**
 * The fidelity claim `agent.revise_prompt` rests on: replacing an agent's
 * prompt changes the prompt and NOTHING else in the file.
 *
 * The first version of this went through the YAML document writer, which
 * re-emits every scalar it reads — an unrelated folded `description:` came
 * back re-flowed to a different line width, so a prompt diff carried noise
 * and `undo` could not restore the file byte-for-byte (probe, 2026-09-20).
 * These tests are why that cannot come back.
 */

const AGENT = `slug: frontline-lead
name: Frontline Lead
description: >-
  Leads Frontline — owns triage quality and the first reply on every
  ticket. Roughly 190 inbound a week.
# A comment the author wrote and expects to keep.
systemPrompt: |
  You lead the Frontline team.

  Escalate outages to the Escalations Lead.
skills:
  - triage-ticket
`;

describe('replacing an agent\'s own instructions in place', () => {
  it('changes the prompt and leaves every other line byte-identical', () => {
    const next = replaceInlinePrompt(AGENT, 'You lead the Frontline team.\n\nName the next step first.')!;

    expect(next).toContain('  Name the next step first.');
    // Everything around it survives: the folded description keeps its own
    // line breaks, and the comment is still there.
    expect(next).toContain('  Leads Frontline — owns triage quality and the first reply on every\n  ticket. Roughly 190 inbound a week.');
    expect(next).toContain('# A comment the author wrote and expects to keep.');
    expect(next).toContain('skills:\n  - triage-ticket\n');
  });

  it('round-trips exactly, which is what undo is', () => {
    const changed = replaceInlinePrompt(AGENT, 'Something else entirely.')!;
    const back = replaceInlinePrompt(changed, 'You lead the Frontline team.\n\nEscalate outages to the Escalations Lead.')!;

    expect(back).toBe(AGENT);
  });

  it('keeps the indentation the author used', () => {
    const wide = AGENT.replace(/^ {2}You lead/m, '    You lead').replace(/^ {2}Escalate/m, '    Escalate').replace(/^ {2}$/m, '');
    const next = replaceInlinePrompt(wide, 'One line.')!;

    expect(next).toContain('\n    One line.\n');
  });

  it('keeps a blank line inside the prompt blank, not indented whitespace', () => {
    const next = replaceInlinePrompt(AGENT, 'First.\n\nSecond.')!;

    expect(next).toContain('systemPrompt: |\n  First.\n\n  Second.\n');
  });

  it('refuses an agent that does not carry a block scalar, rather than guessing', () => {
    expect(replaceInlinePrompt('slug: x\nsystemPrompt: "one line"\n', 'new')).toBeNull();
    expect(replaceInlinePrompt('slug: x\nsystemPromptFile: x.system-prompt.md\n', 'new')).toBeNull();
  });
});
