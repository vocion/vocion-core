import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { echoesToolName, fallbackStepLabels } from './stepLabels';

/**
 * NO TOOL NAME IN AN ACTIVITY LINE (founder, 2026-10-09: "Ran the offer
 * connection"). Every tool core registers for an agent, named the way the
 * trace names it when no model is there to help — running and done, with no
 * arguments — must say what it did, never its own name back. A new tool that
 * would read as "Ran the <its name>" fails here until it says what it does
 * (a verb the generic rule knows, or a line in `stepLabels.ts`).
 */

const TOOLS_DIR = path.resolve(__dirname, '../../services/agents/tools');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    return statSync(full).isDirectory() ? files(full) : (/\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [full] : []);
  });
}

/** The tool names core declares: `name: 'x_y'` in a tool definition, and `X_TOOL = 'x_y'` constants. */
function coreToolNames(): string[] {
  const names = new Set<string>();
  for (const file of files(TOOLS_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bname:\s*'([a-z][a-z0-9]*(?:_[a-z0-9]+)+)'/g)) {
      names.add(m[1]!);
    }
    for (const m of src.matchAll(/_TOOL\s*=\s*'([a-z][a-z0-9]*(?:_[a-z0-9]+)+)'/g)) {
      names.add(m[1]!);
    }
  }
  return [...names].sort();
}

describe('activity lines', () => {
  const names = coreToolNames();

  it('finds the tools core registers', () => {
    expect(names.length).toBeGreaterThan(40);
    expect(names).toEqual(expect.arrayContaining(['offer_connection', 'describe_setup', 'propose_setup', 'file_ask']));
  });

  it('never say a tool\'s own name back', () => {
    const echoes = names.flatMap((tool) => {
      const { running, done } = fallbackStepLabels(tool, undefined, {});
      return [running, done].filter(line => echoesToolName(line, tool)).map(line => `${tool}: "${line}"`);
    });

    expect(echoes).toEqual([]);
  });
});
