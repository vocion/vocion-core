import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema, toolCallSchema } = await import('@/models/Schema');
const { unopenedShots } = await import('./recordVerdict');

const ORG = 'org_opened';
const ctx = (missionRunId?: number) => ({ orgId: ORG, missionRunId } as never);

beforeEach(async () => {
  await db.delete(artifactSchema);
  await db.delete(toolCallSchema);
});

describe('unopenedShots', () => {
  it('refuses a verdict on a task with screenshots when this review opened none, and hands over every link', async () => {
    await db.insert(artifactSchema).values([
      { orgId: ORG, kind: 'file', title: 'Empty state · desktop · after', url: 'https://files.example/a.png', recordType: 'object', recordId: '176', recordRole: 'qa-screenshot', spec: {} },
      { orgId: ORG, kind: 'file', title: 'Chips · desktop · after', url: 'https://files.example/b.png', recordType: 'object', recordId: '176', recordRole: 'qa-screenshot', spec: {} },
    ] as never);
    const refusal = await unopenedShots(ctx(900), 176);

    expect(refusal).toMatch(/^Not recorded: task #176 has 2 screenshots and this review opened none of them/);
    expect(refusal).toMatch(/Empty state · desktop · after: \S*\/dashboard\/artifacts\/\d+/);

    await db.insert(toolCallSchema).values({ orgId: ORG, missionRunId: 900, tool: 'fetch_image', input: {}, output: 'Image fetched and verified: image/png, 1100×688', agentSlug: 'change-reviewer' } as never);

    expect(await unopenedShots(ctx(900), 176)).toBeNull();
  });

  it('asks nothing of a task with no screenshots, or of a call outside a review run', async () => {
    expect(await unopenedShots(ctx(900), 999)).toBeNull();
    expect(await unopenedShots(ctx(undefined), 176)).toBeNull();
  });
});
