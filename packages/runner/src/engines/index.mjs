// The engine registry (Phase 1 of the engine plan). An engine is the one thing that differs between
// runs of the same contract: it turns the brief into edits in the checkout. Everything around it is
// the runner's and the same for every engine: the contract, the guard hooks and protected paths,
// the required checks, the budget and wall clock, cost reporting from the pass's result line, the
// verify, land and keep steps and the kept-branch retry.
//
// An engine module exports:
//   id                     the contract's engine.id
//   available(cfg)         { ok, why }: whether this image carries it
//   pass(ctx)              { bin, args, env, keepEnv }: one engineer or repair pass as a process
//                          that reads the prompt on stdin and prints Claude Code stream-json
import * as claudeCli from './claude-cli.mjs';
import * as openhands from './openhands.mjs';

const ENGINES = { [claudeCli.id]: claudeCli, [openhands.id]: openhands };

export const DEFAULT_ENGINE = claudeCli.id;
export const ENGINE_IDS = Object.keys(ENGINES);

/** The engine id a contract asks for: engine.id, or claude-cli when the contract has no engine. */
export function engineId(task) {
  return task?.engine?.id || DEFAULT_ENGINE;
}

/** The engine module for a contract. Throws on an id the registry does not know. */
export function engineFor(task) {
  const id = engineId(task);
  const engine = ENGINES[id];
  if (!engine) {
    throw new Error(`unknown engine ${id}; this runner knows ${ENGINE_IDS.join(', ')}`);
  }
  return engine;
}
