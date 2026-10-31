import type { RuntimeContext } from '../types';
import { beforeEach, expect, it, vi } from 'vitest';
import { WriteApiError } from '@/services/writeApi';
import { seoMeasurementTools } from './seoMeasurement';

const capture = vi.hoisted(() => vi.fn());
vi.mock('@/services/seo/measurement', () => ({ captureSeoBaseline: capture }));

beforeEach(() => vi.clearAllMocks());

it('never fabricates an owner identity for a scheduled run', async () => {
  const tool = seoMeasurementTools({ orgId: 'org-a' } as RuntimeContext).find(t => t.name === 'seo_capture_measurements')!;
  const result = await tool.invoke({ project_id: 9, expected_revision: 1 });

  expect(result).toContain('requires the strategy owner');
  expect(capture).not.toHaveBeenCalled();
});

it('passes actual owner context and revision, and returns useful sanitized refusals', async () => {
  const tool = seoMeasurementTools({ orgId: 'org-a', userId: 'person-a' } as RuntimeContext).find(t => t.name === 'seo_capture_measurements')!;
  capture.mockRejectedValue(new WriteApiError(403, 'forbidden', 'Only the strategy owner may capture.'));

  expect(await tool.invoke({ project_id: 9, expected_revision: 3 })).toContain('Only the strategy owner');
  expect(capture).toHaveBeenCalledWith('org-a', 9, 'person-a', 3);

  capture.mockRejectedValue(new Error('private internals'));

  expect(await tool.invoke({ project_id: 9, expected_revision: 3 })).not.toContain('private internals');
});
