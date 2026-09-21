/**
 * The exit code `eval:run` gives a pipeline.
 *
 * Worth its own test because it is the one number that decides whether a
 * deploy goes ahead, and because the rule it holds — the dataset's bar beats
 * the runner's — is invisible from either side on its own.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PASS_THRESHOLD, evaluatePassGate } from './passGate';

describe('evaluatePassGate', () => {
  it('holds a dataset that names no bar to the runner default', () => {
    // Every dataset written before pass_threshold existed is in this case,
    // and none of them should change behaviour.
    expect(DEFAULT_PASS_THRESHOLD).toBe(0.8);
    expect(evaluatePassGate(0.85, null).passed).toBe(true);
    expect(evaluatePassGate(0.75, null).passed).toBe(false);
    expect(evaluatePassGate(0.75, undefined).passed).toBe(false);
  });

  it('lets a dataset set a bar below the default and pass on it', () => {
    // The whole reason the column exists: eleven cases against live websites
    // lose one whenever a site redesigns a page, and 0.8 would redden a build
    // nobody broke.
    const gate = evaluatePassGate(0.7, 0.6);

    expect(gate.passed).toBe(true);
    expect(gate.threshold).toBe(0.6);
  });

  it('lets a dataset set a bar above the default and fail on it', () => {
    // A stricter bar has to bite, or the field only ever weakens the gate.
    expect(evaluatePassGate(0.9, 0.95).passed).toBe(false);
  });

  it('passes a run that lands exactly on the bar', () => {
    // "This much is good enough" is what a threshold says; failing the run
    // that hit it precisely would make the number mean something nobody
    // wrote down.
    expect(evaluatePassGate(0.6, 0.6).passed).toBe(true);
  });

  it('fails a run with nothing graded rather than treating no score as a pass', () => {
    // A run where every case errored reports a pass rate of 0, and a gate
    // that waved that through would report a green build for a suite that
    // measured nothing.
    expect(evaluatePassGate(0, 0.6).passed).toBe(false);
    expect(evaluatePassGate(0, 0).passed).toBe(true);
  });

  it('says which bar it used, so a surprising exit code can be read back', () => {
    expect(evaluatePassGate(0.7, 0.6).summary).toContain('set by the dataset');
    expect(evaluatePassGate(0.7, null).summary).toContain('runner default');
    expect(evaluatePassGate(0.7, null).summary).toContain('80.0%');
  });
});
