/**
 * The workspace's vision models, as the dashboard shows them: the trained
 * classifier (Amazon Rekognition Custom Labels) with every training run,
 * its datasets and per-label scores, plus usage of both engines from the
 * tool_call record. Read-only; start/stop lives in /api/v1/vision/model.
 */

import process from 'node:process';
import {
  DescribeDatasetCommand,
  DescribeProjectsCommand,
  DescribeProjectVersionsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getObjectBytes, listKeys } from '@/libs/aws/s3';
import { db } from '@/libs/DB';
import { parseS3Config } from '@/libs/sources/s3';
import { knowledgeSourceSchema, toolCallSchema } from '@/models/Schema';

export type LabelMetric = { label: string; f1: number | null; precision: number | null; recall: number | null; testImages: number | null };

export type TrainingRun = {
  versionName: string;
  arn: string;
  status: string;
  statusMessage: string | null;
  createdAt: string | null;
  trainingEndedAt: string | null;
  billableTrainingSeconds: number | null;
  minInferenceUnits: number | null;
  f1: number | null;
  labels: LabelMetric[];
  evaluationSummaryKey: string | null;
};

export type DatasetInfo = { type: string; arn: string; status: string; entries: number | null; labelled: number | null; labels: number | null; updatedAt: string | null };

export type VisionModelsReport = {
  region: string;
  classifier: {
    configured: boolean;
    projectArn: string | null;
    projectName: string | null;
    projectCreatedAt: string | null;
    runs: TrainingRun[];
    datasets: DatasetInfo[];
    running: TrainingRun | null;
  };
  trainingSet: Array<{ template: string; good: number; bad: number; prefix: string }> | null;
  bucket: string | null;
  usage: {
    claude: { calls: number; lastAt: string | null; avgMs: number | null; errors: number };
    rekognition: { calls: number; lastAt: string | null; avgMs: number | null; errors: number };
  };
};

function region(): string {
  return process.env.VOCION_REKOGNITION_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
}

async function loadLabelMetrics(bucket: string | undefined, key: string | undefined): Promise<LabelMetric[]> {
  if (!bucket || !key) {
    return [];
  }
  try {
    const { bytes } = await getObjectBytes({ bucket, key, region: region() });
    const doc = JSON.parse(bytes.toString('utf8')) as { LabelEvaluationResults?: Array<{ Label: string; NumberOfTestingImages?: number; Metrics?: { F1Score?: number; Precision?: number; Recall?: number } }> };
    return (doc.LabelEvaluationResults ?? []).map(l => ({
      label: l.Label,
      f1: l.Metrics?.F1Score ?? null,
      precision: l.Metrics?.Precision ?? null,
      recall: l.Metrics?.Recall ?? null,
      testImages: l.NumberOfTestingImages ?? null,
    }));
  } catch {
    return [];
  }
}

export async function visionModelsReport(orgId: string): Promise<VisionModelsReport> {
  const projectArn = process.env.VOCION_REKOGNITION_PROJECT_ARN ?? null;
  const rek = new RekognitionClient({ region: region() });

  // The org's s3 source → the training set on disk.
  const src = await db.query.knowledgeSourceSchema.findFirst({
    where: and(eq(knowledgeSourceSchema.orgId, orgId), sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 's3'`),
  });
  let bucket: string | null = null;
  let trainingSet: VisionModelsReport['trainingSet'] = null;
  if (src) {
    const { _connector, ...rest } = src.configJson as Record<string, unknown>;
    void _connector;
    const cfg = parseS3Config(rest);
    bucket = cfg.bucket;
    try {
      const entries = await listKeys({ bucket: cfg.bucket, prefix: cfg.prefix || undefined, region: cfg.region, max: 5000 });
      const byTemplate = new Map<string, { good: number; bad: number }>();
      for (const e of entries) {
        const m = e.key.match(/(?:^|\/)([^/]+)\/(good|bad)\/[^/]+\.(?:jpe?g|png|webp)$/i);
        if (!m) {
          continue;
        }
        const t = byTemplate.get(m[1]!) ?? { good: 0, bad: 0 };
        t[m[2]!.toLowerCase() as 'good' | 'bad'] += 1;
        byTemplate.set(m[1]!, t);
      }
      trainingSet = [...byTemplate.entries()].map(([template, c]) => ({ template, ...c, prefix: `${cfg.prefix}${template}/` })).sort((a, b) => a.template.localeCompare(b.template));
    } catch { /* bucket unreachable — leave null */ }
  }

  const classifier: VisionModelsReport['classifier'] = { configured: !!projectArn, projectArn, projectName: null, projectCreatedAt: null, runs: [], datasets: [], running: null };
  if (projectArn) {
    try {
      const projects = await rek.send(new DescribeProjectsCommand({ ProjectNames: [projectArn.split(':project/')[1]?.split('/')[0] ?? projectArn] }));
      const p = projects.ProjectDescriptions?.find(d => d.ProjectArn === projectArn) ?? projects.ProjectDescriptions?.[0];
      classifier.projectName = p?.ProjectArn?.split(':project/')[1]?.split('/')[0] ?? null;
      classifier.projectCreatedAt = p?.CreationTimestamp?.toISOString() ?? null;
      for (const d of p?.Datasets ?? []) {
        let entries: number | null = null;
        let labelled: number | null = null;
        let labels: number | null = null;
        try {
          const dd = await rek.send(new DescribeDatasetCommand({ DatasetArn: d.DatasetArn }));
          entries = dd.DatasetDescription?.DatasetStats?.TotalEntries ?? null;
          labelled = dd.DatasetDescription?.DatasetStats?.LabeledEntries ?? null;
          labels = dd.DatasetDescription?.DatasetStats?.TotalLabels ?? null;
        } catch { /* keep nulls */ }
        classifier.datasets.push({ type: d.DatasetType ?? 'UNKNOWN', arn: d.DatasetArn ?? '', status: d.Status ?? 'UNKNOWN', entries, labelled, labels, updatedAt: d.CreationTimestamp?.toISOString() ?? null });
      }
      const versions = await rek.send(new DescribeProjectVersionsCommand({ ProjectArn: projectArn }));
      for (const v of versions.ProjectVersionDescriptions ?? []) {
        const summary = v.EvaluationResult?.Summary?.S3Object;
        const run: TrainingRun = {
          versionName: v.ProjectVersionArn?.split('/version/')[1]?.split('/')[0] ?? 'v?',
          arn: v.ProjectVersionArn ?? '',
          status: v.Status ?? 'UNKNOWN',
          statusMessage: v.StatusMessage ?? null,
          createdAt: v.CreationTimestamp?.toISOString() ?? null,
          trainingEndedAt: v.TrainingEndTimestamp?.toISOString() ?? null,
          billableTrainingSeconds: v.BillableTrainingTimeInSeconds ?? null,
          minInferenceUnits: v.MinInferenceUnits ?? null,
          f1: v.EvaluationResult?.F1Score ?? null,
          labels: await loadLabelMetrics(summary?.Bucket, summary?.Name),
          evaluationSummaryKey: summary?.Name ?? null,
        };
        classifier.runs.push(run);
        if (run.status === 'RUNNING') {
          classifier.running = run;
        }
      }
    } catch (err) {
      classifier.runs = [];
      classifier.projectName = `error: ${(err as Error).message}`;
    }
  }

  const usageRows = await db
    .select({
      tool: toolCallSchema.tool,
      calls: sql<number>`count(*)`,
      errors: sql<number>`count(*) filter (where ${toolCallSchema.error} is not null)`,
      avgMs: sql<number | null>`avg(${toolCallSchema.durationMs})`,
      lastAt: sql<Date | null>`max(${toolCallSchema.createdAt})`,
    })
    .from(toolCallSchema)
    .where(and(eq(toolCallSchema.orgId, orgId), inArray(toolCallSchema.tool, ['vision_compare_reference', 'vision_detect_labels'])))
    .groupBy(toolCallSchema.tool)
    .orderBy(desc(sql`count(*)`));
  const pick = (tool: string) => {
    const r = usageRows.find(u => u.tool === tool);
    return { calls: Number(r?.calls ?? 0), errors: Number(r?.errors ?? 0), avgMs: r?.avgMs != null ? Math.round(Number(r.avgMs)) : null, lastAt: r?.lastAt ? new Date(r.lastAt).toISOString() : null };
  };

  return {
    region: region(),
    classifier,
    trainingSet,
    bucket,
    usage: { claude: pick('vision_compare_reference'), rekognition: pick('vision_detect_labels') },
  };
}
