/**
 * Finding and replacing ONE agent's system prompt in the workspace that
 * authors it.
 *
 * An agent's prompt is authored in one of two shapes, and both are legal:
 *
 *   agents/<slug>.yaml  →  systemPromptFile: <slug>.system-prompt.md
 *   agents/<slug>.yaml  →  systemPrompt: |   (inline)
 *
 * `agent.revise_prompt` has to work on both or it works on half the
 * workspaces, so this resolves which shape an agent uses and writes back into
 * the same one.
 *
 * The inline write is a SURGICAL text replacement of the `systemPrompt: |`
 * block, not a YAML re-serialisation. Round-tripping the document through a
 * writer re-emits every other scalar in it: the first version of this
 * re-flowed an unrelated folded `description:` to a different line width, and
 * an undo could then not restore the file byte-for-byte. A prompt change has
 * to leave a diff containing only the prompt, or nobody can read it — and
 * "restores exactly" has to be exact.
 *
 * The DB column `agent.system_prompt` is deliberately NOT written here.
 * Workspace files are the source of truth (context as code); writing the
 * column directly would produce a prompt that the next `workspace:apply`
 * silently reverts, and a self-update that quietly un-does itself is worse
 * than one that refuses.
 */

import type { WorkspaceApplyResult } from './workspaceDoc';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { applyAfterDocEdit, readWorkspaceDoc, resolveWorkspacePath, writeWorkspaceDoc } from './workspaceDoc';

/** Where an agent's prompt is authored, and what it currently says. */
export type AgentPromptLocation = {
  /** `file` — a sibling markdown file; `inline` — a scalar in the agent's own YAML. */
  shape: 'file' | 'inline';
  /** Workspace-relative path of the file that holds it. */
  relPath: string;
  /** The prompt as authored. */
  text: string;
};

const AGENT_EXTS = ['.yaml', '.yml'] as const;

/**
 * Where this agent's prompt lives in this workspace, or null when the
 * workspace does not author it — a plugin-provided agent, or one hired from
 * the catalog straight into the database. Both are real cases, and refusing
 * on them beats editing a file that is not the one in force.
 * @param dir - The workspace directory.
 * @param slug - The agent slug.
 */
export function locateAgentPrompt(dir: string, slug: string): AgentPromptLocation | null {
  for (const ext of AGENT_EXTS) {
    const relYaml = join('agents', `${slug}${ext}`);
    let raw: string;
    try {
      raw = readFileSync(resolveWorkspacePath(dir, relYaml, AGENT_EXTS), 'utf8');
    } catch {
      continue;
    }
    const doc = parseDocument(raw);
    const promptFile = doc.get('systemPromptFile');
    if (typeof promptFile === 'string' && promptFile.length > 0) {
      // `systemPromptFile` is relative to the agent file, which lives in
      // `agents/` — exactly as the workspace loader resolves it. `join`
      // normalises any `..` in it, and the resolver refuses one that leaves
      // the workspace.
      const rel = join('agents', promptFile);
      const text = readWorkspaceDoc(dir, rel);
      if (text === null) {
        return null;
      }
      return { shape: 'file', relPath: rel, text };
    }
    const inline = doc.get('systemPrompt');
    if (typeof inline === 'string') {
      return { shape: 'inline', relPath: relYaml, text: inline };
    }
    return null;
  }
  return null;
}

/**
 * Replace the prompt in the shape it is authored in, then apply.
 * @param opts - The write.
 * @param opts.orgId - The project to apply into.
 * @param opts.dir - The workspace directory.
 * @param opts.at - Where the prompt lives, from {@link locateAgentPrompt}.
 * @param opts.prompt - The whole new prompt.
 * @param opts.appliedBy - Who, for the `workspace_version` row.
 */
export async function writeAgentPrompt(opts: {
  orgId: string;
  dir: string;
  at: Pick<AgentPromptLocation, 'shape' | 'relPath'>;
  prompt: string;
  appliedBy: string;
}): Promise<{ applied: WorkspaceApplyResult }> {
  if (opts.at.shape === 'file') {
    const res = await writeWorkspaceDoc({
      orgId: opts.orgId,
      dir: opts.dir,
      relPath: opts.at.relPath,
      content: `${opts.prompt.trim()}\n`,
      appliedBy: opts.appliedBy,
    });
    return { applied: res.applied };
  }
  const abs = resolveWorkspacePath(opts.dir, opts.at.relPath, AGENT_EXTS);
  const next = replaceInlinePrompt(readFileSync(abs, 'utf8'), opts.prompt);
  if (next === null) {
    throw new Error(`"${opts.at.relPath}" does not carry its prompt as a \`systemPrompt: |\` block, so it cannot be revised in place`);
  }
  writeFileSync(abs, next, 'utf8');
  return { applied: await applyAfterDocEdit(opts.orgId, opts.dir, opts.appliedBy) };
}

/** `systemPrompt: |` (or `|-`, `|+`, `>`, `>-`) at the top level, and the indented block under it. */
const INLINE_PROMPT = /^systemPrompt:[ \t]*([|>][-+]?)[ \t]*\r?\n((?:[ \t][^\n]*\n|\n)*)/m;

/**
 * Replace the `systemPrompt:` block scalar in an agent YAML, leaving every
 * other byte of the file exactly as it was.
 *
 * Pure, so the fidelity claim this whole action rests on is a unit test. The
 * block's own indentation is reused for the new text, so the file stays
 * valid YAML without the writer ever seeing it. Returns null when the agent
 * does not carry its prompt as a block scalar — the caller refuses rather
 * than guessing.
 * @param raw - The agent YAML as it is on disk.
 * @param prompt - The whole new prompt.
 */
export function replaceInlinePrompt(raw: string, prompt: string): string | null {
  const m = raw.match(INLINE_PROMPT);
  if (!m || m.index === undefined) {
    return null;
  }
  const block = m[2] ?? '';
  // The indent the author used for the block's first non-blank line.
  const indent = block.match(/^([ \t]+)\S/m)?.[1] ?? '  ';
  const body = `${prompt.trim().split('\n').map(l => (l.trim() === '' ? '' : indent + l)).join('\n')}\n`;
  return `${raw.slice(0, m.index)}systemPrompt: ${m[1]}\n${body}${raw.slice(m.index + m[0].length)}`;
}
