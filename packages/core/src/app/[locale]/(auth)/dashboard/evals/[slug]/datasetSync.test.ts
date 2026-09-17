/**
 * What the dataset page is allowed to claim about the grader's copy.
 *
 * Each of these is a sentence someone could act on wrongly: telling them the
 * cases are in AWS when they are not, telling them a run was worthless when it
 * was scored fine, or showing a version number that belongs to older cases.
 */
import type { DatasetSyncState } from '@/services/evals/publish';
import { describe, expect, it } from 'vitest';
import { summariseDatasetSync } from './datasetSync';

function state(overrides: Partial<DatasetSyncState> = {}): DatasetSyncState {
  return {
    provider: 'agentcore',
    remoteId: 'ds-1',
    remoteVersion: '3',
    status: 'ACTIVE',
    syncError: null,
    syncedAt: new Date('2026-09-15T10:00:00Z'),
    drifted: false,
    ...overrides,
  };
}

describe('summariseDatasetSync', () => {
  it('says nothing is copied anywhere for a grader that reads the cases from Vocion', () => {
    const summary = summariseDatasetSync({
      graderLabel: 'Vocion',
      keepsDataset: false,
      workspaceVersion: 4,
      state: null,
    });

    // A permanent "not synced" badge on our own judge would send people
    // looking for a sync that is never coming.
    expect(summary.tone).toBe('local');
    expect(summary.remoteId).toBeNull();
    expect(summary.headline).toContain('v4');
  });

  it('calls a dataset that has never been published pending, not broken', () => {
    const summary = summariseDatasetSync({
      graderLabel: 'AgentCore',
      keepsDataset: true,
      workspaceVersion: 1,
      state: null,
    });

    expect(summary.tone).toBe('pending');
    expect(summary.headline).toContain('Not copied to AgentCore yet');
    expect(summary.remoteVersion).toBeNull();
  });

  it('is still pending when a row exists but nothing has landed in the account', () => {
    // The row is created before the first publish is attempted, so its bare
    // existence must not be read as "AgentCore has these cases".
    const summary = summariseDatasetSync({
      graderLabel: 'AgentCore',
      keepsDataset: true,
      workspaceVersion: 1,
      state: state({ remoteId: null, remoteVersion: null, status: null, syncedAt: null }),
    });

    expect(summary.tone).toBe('pending');
  });

  it('says a failed copy did not cost the run its scores', () => {
    const summary = summariseDatasetSync({
      graderLabel: 'AgentCore',
      keepsDataset: true,
      workspaceVersion: 2,
      state: state({ syncError: 'AWS refused the dataset.', drifted: true }),
    });

    expect(summary.tone).toBe('failed');
    expect(summary.detail).toContain('AWS refused the dataset.');
    // Without this, a red banner reads as "these numbers are worthless" when
    // the scoring call carries the expected answers itself.
    expect(summary.detail).toContain('still scored');
  });

  it('puts the failure ahead of the drift, so the reason comes before the symptom', () => {
    const summary = summariseDatasetSync({
      graderLabel: 'AgentCore',
      keepsDataset: true,
      workspaceVersion: 2,
      state: state({ syncError: 'AWS timed out.', drifted: true }),
    });

    expect(summary.tone).toBe('failed');
  });

  it('names both versions when the cases here have moved on', () => {
    const summary = summariseDatasetSync({
      graderLabel: 'AgentCore',
      keepsDataset: true,
      workspaceVersion: 7,
      state: state({ drifted: true, remoteVersion: '3' }),
    });

    expect(summary.tone).toBe('behind');
    expect(summary.detail).toContain('v7');
    expect(summary.detail).toContain('version 3');
  });

  it('reports the remote id even when everything is in step', () => {
    const summary = summariseDatasetSync({
      graderLabel: 'AgentCore',
      keepsDataset: true,
      workspaceVersion: 3,
      state: state({ remoteId: 'ds-abc123' }),
    });

    expect(summary.tone).toBe('in-step');
    // Support's first question is "which dataset in the console?" — that id is
    // the only way to answer it.
    expect(summary.remoteId).toBe('ds-abc123');
  });
});
