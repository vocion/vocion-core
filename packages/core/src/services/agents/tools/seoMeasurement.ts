import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { WriteApiError } from '@/services/writeApi';

/**
 * Measurement tools never create targets, enable schedules, or impersonate a strategy owner.
 * @param ctx
 */
export function seoMeasurementTools(ctx: RuntimeContext) {
  return [
    tool(async ({ page_id }) => {
      if (!ctx.userId) {
        return 'Publication verification requires the client strategy owner’s user context.';
      }
      const { verifySeoPublication } = await import('@/services/seo/publicationVerification');
      try {
        return JSON.stringify(await verifySeoPublication(ctx.orgId, page_id, ctx.userId));
      } catch (error) {
        return error instanceof WriteApiError ? error.message : 'Publication verification could not be recorded. Reload the page and retry.';
      }
    }, {
      name: 'seo_verify_publication',
      description: 'On the client strategy owner’s request, safely read only the published URL already saved on an SEO page and record public HTML identity evidence. No arbitrary URL, login, publishing, or indexing claim. Timeouts and access restrictions remain unverified.',
      schema: z.object({ page_id: z.number().int().positive() }),
    }),
    tool(async ({ project_id }) => {
      const [{ getProject }, { readSeoReadiness, renderSeoMeasurementReport }] = await Promise.all([import('@/services/DataRoomService'), import('@/services/seo/readiness')]);
      const project = await getProject(ctx.orgId, project_id);
      const readiness = project ? await readSeoReadiness(ctx.orgId, project_id) : null;
      return project && readiness ? renderSeoMeasurementReport(project.title, readiness) : 'Client project not found in this workspace.';
    }, {
      name: 'seo_read_measurements',
      description: 'Read this client’s saved SEO delivery, sourced measurements, baseline dates, readiness and next actions. Use during an authorized weekly goal review. Does not refresh remote data; report observation dates and unknowns.',
      schema: z.object({ project_id: z.number().int().positive() }),
    }),
    tool(async ({ project_id, expected_revision }) => {
      if (!ctx.userId) {
        return 'Measurement capture requires the strategy owner’s user context. Read saved measurements instead; no schedule was enabled.';
      }
      const { captureSeoBaseline } = await import('@/services/seo/measurement');
      try {
        const saved = await captureSeoBaseline(ctx.orgId, project_id, ctx.userId, expected_revision);
        return `Saved sourced 28-day Search Console observations; roadmap revision ${saved.roadmap.revision}. The first baseline and its dates are preserved. This measures search activity, not attributed leads or revenue.`;
      } catch (error) {
        return error instanceof WriteApiError ? error.message : 'Measurements could not be saved. Reload the client roadmap and check its connection before retrying.';
      }
    }, {
      name: 'seo_capture_measurements',
      description: 'When the strategy owner requests a baseline or measurement refresh, read actual 28-day aggregate clicks and impressions from this client’s selected Search Console property and save dated observations to its roadmap. Requires owner context and current revision from seo_read_roadmap; preserves original baseline. Never invents impact or enables recurring work.',
      schema: z.object({ project_id: z.number().int().positive(), expected_revision: z.number().int().nonnegative() }),
    }),
  ];
}
