/**
 * Vision tools for kit / assembly verification — granted-only
 * (`harness.grantTools`), because they spend real money on every call.
 *
 *   vision_compare_reference — reference-based matching. Sends the candidate
 *     photo plus up to two known-good photos of the SAME template to Claude
 *     and asks for a structured verdict: which silhouette regions are
 *     present, missing, wrong, mis-oriented or off-count. This is the check
 *     that scales without per-kit programming: enrol a template with one
 *     good photograph and the comparison does the rest.
 *
 *   vision_detect_labels — the trained classifier's second opinion (Amazon
 *     Rekognition Custom Labels, `DetectCustomLabels`). Whole-image labels
 *     with confidence. Degrades to a clear "model not running" message when
 *     the endpoint is stopped, so the demo never 500s on a cost control.
 *
 * Both tools UPSERT an `inspection` business object keyed on the image key,
 * so a photo inspected twice is one record with two checks, and the record
 * carries `image_url` for the review card, the pages and object detail.
 * Every call is a `tool_call` row via the registry wrapper.
 */

import type { RuntimeContext } from '../types';
import type { CreateBusinessObjectInput } from '@/validations/BusinessObjectValidation';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import { DescribeProjectVersionsCommand, DetectCustomLabelsCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import { tool } from '@langchain/core/tools';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { appImageUrl, getObjectBytes, guessContentType, listKeys, parseS3Ref } from '@/libs/aws/s3';
import { db } from '@/libs/DB';
import { metadataFromKey, parseS3Config } from '@/libs/sources/s3';
import { businessObjectSchema, businessObjectTypeSchema, knowledgeSourceSchema } from '@/models/Schema';
import { createBusinessObject, updateBusinessObject } from '@/services/BusinessObjectService';
import { getLearnings, listSteps } from '@/services/LearningsService';

export const KIT_VISION_TOOL_NAMES = ['vision_compare_reference', 'vision_detect_labels'] as const;

const VISION_MODEL = process.env.VOCION_VISION_MODEL ?? 'claude-sonnet-4-6';
const INSPECTION_TYPE = 'inspection';

type S3Source = { bucket: string; region?: string; prefix: string; cfg: ReturnType<typeof parseS3Config> };

/**
 * The org's first `s3` source — its bucket is the default for bare keys and its path rules parse metadata.
 * @param orgId
 */
export async function orgS3Source(orgId: string): Promise<S3Source | null> {
  const src = await db.query.knowledgeSourceSchema.findFirst({
    where: and(eq(knowledgeSourceSchema.orgId, orgId), sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 's3'`),
  });
  if (!src) {
    return null;
  }
  const { _connector, ...rest } = src.configJson as Record<string, unknown>;
  void _connector;
  const cfg = parseS3Config(rest);
  return { bucket: cfg.bucket, region: cfg.region, prefix: cfg.prefix, cfg };
}

function templateFromKey(key: string, hint?: string): string | null {
  if (hint) {
    return hint;
  }
  const segs = key.split('/');
  const t = segs.indexOf('templates');
  if (t >= 0 && segs[t + 1] && segs.length > t + 2) {
    return segs[t + 1]!;
  }
  if (segs.length >= 3 && ['good', 'bad', 'inbox'].includes(segs[1]!)) {
    return segs[0]!;
  }
  return null;
}

async function findInspection(orgId: string, imageKey: string) {
  return db.query.businessObjectSchema.findFirst({
    where: and(eq(businessObjectSchema.orgId, orgId), sql`${businessObjectSchema.metadata} ->> 'image_key' = ${imageKey}`),
  });
}

async function ensureInspectionType(orgId: string): Promise<boolean> {
  const t = await db.query.businessObjectTypeSchema.findFirst({
    where: and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, INSPECTION_TYPE)),
  });
  return !!t;
}

/**
 * The two engines side by side, derived from `metadata.checks` so pages and
 * the record can compare them without re-reading raw tool output.
 *
 * Hybrid rule (demo default): when both ran and agree → that verdict, at the
 * higher confidence; when they disagree → HOLD, flagged so a person looks;
 * when only one ran → its verdict. Claude Vision is the primary because it
 * names the region; the classifier is a whole-image second opinion.
 * @param checks
 * @param template
 */
export function summarizeEngines(checks: Record<string, unknown> | undefined, template: string | null): Record<string, unknown> {
  const ref = (checks?.reference ?? null) as { verdict?: string; confidence?: number; model?: string; at?: string } | null;
  const cls = (checks?.classifier ?? null) as { top?: { name: string; confidence: number } | null; labels?: Array<{ name: string; confidence: number }>; at?: string } | null;
  const claude = ref?.verdict
    ? { engine: 'Claude Vision', model: ref.model ?? null, verdict: ref.verdict, confidence: ref.confidence ?? null, at: ref.at ?? null }
    : null;
  let rekognition: Record<string, unknown> | null = null;
  if (cls?.top) {
    const good = cls.labels?.find(l => l.name.endsWith('_good') && (!template || l.name.startsWith(template)));
    const bad = cls.labels?.find(l => l.name.endsWith('_bad') && (!template || l.name.startsWith(template)));
    const verdict = cls.top.name.endsWith('_bad') ? 'hold' : cls.top.name.endsWith('_good') ? 'pass' : null;
    rekognition = { engine: 'Amazon Rekognition Custom Labels', label: cls.top.name, verdict, confidence: cls.top.confidence, good: good?.confidence ?? null, bad: bad?.confidence ?? null, at: cls.at ?? null };
  }
  let agreement: 'agree' | 'disagree' | 'one-engine' | 'none' = 'none';
  let hybrid: string | null = null;
  let hybridConfidence: number | null = null;
  let hybridReason = '';
  if (claude && rekognition?.verdict) {
    if (claude.verdict === rekognition.verdict) {
      agreement = 'agree';
      hybrid = claude.verdict;
      hybridConfidence = Math.max(claude.confidence ?? 0, Number(rekognition.confidence) || 0);
      hybridReason = 'Both engines agree.';
    } else {
      agreement = 'disagree';
      hybrid = 'hold';
      hybridConfidence = null;
      hybridReason = `Engines disagree (Claude Vision ${claude.verdict}, Rekognition ${String(rekognition.verdict)}) — held for a person.`;
    }
  } else if (claude) {
    agreement = 'one-engine';
    hybrid = claude.verdict;
    hybridConfidence = claude.confidence ?? null;
    hybridReason = 'Claude Vision only; the classifier did not run.';
  } else if (rekognition?.verdict) {
    agreement = 'one-engine';
    hybrid = String(rekognition.verdict);
    hybridConfidence = Number(rekognition.confidence) || null;
    hybridReason = 'Rekognition only; no reference comparison yet.';
  }
  return { claude, rekognition, agreement, hybrid_verdict: hybrid, hybrid_confidence: hybridConfidence, hybrid_reason: hybridReason };
}

/**
 * Create or update the inspection record for an image. Status follows the
 * verdict (`passed` | `held`); a person's later decision (qc.release, rework)
 * overrides it and is never clobbered by a re-check.
 * @param ctx
 * @param args
 * @param args.imageKey
 * @param args.bucket
 * @param args.template
 * @param args.pathMeta
 * @param args.patch
 * @param args.verdict
 */
async function upsertInspection(ctx: RuntimeContext, args: {
  imageKey: string;
  bucket: string;
  template: string | null;
  pathMeta: Record<string, unknown>;
  patch: Record<string, unknown>;
  verdict?: 'pass' | 'hold';
}): Promise<{ id: number; url: string } | null> {
  if (!(await ensureInspectionType(ctx.orgId))) {
    return null;
  }
  const existing = await findInspection(ctx.orgId, args.imageKey);
  const base = existing?.metadata ?? {};
  const decided = typeof (base as Record<string, unknown>).decision === 'object';
  const status = decided ? existing!.status : args.verdict === 'hold' ? 'held' : args.verdict === 'pass' ? 'passed' : (existing?.status ?? 'pending');
  const metadata: Record<string, unknown> = {
    ...base,
    ...args.pathMeta,
    image_key: args.imageKey,
    bucket: args.bucket,
    image_url: appImageUrl(args.bucket, args.imageKey),
    template_id: args.template ?? (base as Record<string, unknown>).template_id ?? null,
    ...args.patch,
    last_checked_at: new Date().toISOString(),
  };
  metadata.engines = summarizeEngines(metadata.checks as Record<string, unknown> | undefined, (metadata.template_id as string | null) ?? args.template);
  const title = `${args.template ?? 'kit'} · ${String(metadata.production_order ?? path.basename(args.imageKey, path.extname(args.imageKey)))}`;
  if (existing) {
    await updateBusinessObject({ id: existing.id, status: status ?? 'pending', metadata, title }, ctx.orgId);
    return { id: existing.id, url: `/dashboard/objects/${existing.id}` };
  }
  const input: CreateBusinessObjectInput = { typeSlug: INSPECTION_TYPE, title, status: status ?? 'pending', metadata } as CreateBusinessObjectInput;
  const obj = await createBusinessObject(input, ctx.orgId, ctx.userId ?? `agent:${ctx.agentSlug ?? 'unknown'}`);
  return obj ? { id: obj.id, url: `/dashboard/objects/${obj.id}` } : null;
}

const VerdictSchema = z.object({
  verdict: z.enum(['pass', 'hold']),
  confidence: z.number().min(0).max(1),
  kit_id: z.string().nullable().optional(),
  sheet_title: z.string().nullable().optional(),
  regions_checked: z.number().int().nonnegative().optional(),
  findings: z.array(z.object({
    region: z.string(),
    issue: z.enum(['missing', 'wrong_part', 'extra', 'orientation', 'count', 'unreadable', 'ok']),
    expected: z.string().optional(),
    observed: z.string().optional(),
    severity: z.enum(['blocking', 'minor', 'info']).default('minor'),
    confidence: z.number().min(0).max(1).optional(),
    /** Where to look: [x, y, w, h] normalised 0–1 of the CANDIDATE image. */
    box: z.array(z.number().min(0).max(1)).length(4).optional(),
  })).default([]),
  photo_quality: z.object({ readable: z.boolean(), notes: z.string().optional() }).optional(),
  explanation: z.string(),
});

const COMPARE_SYSTEM = `You are a kit-verification inspector at a hardware manufacturer. Each photo shows a printed, to-scale silhouette sheet on a pack station; the assembler lays every part of a hardware kit on its outline. The sheet prints the kit name and, under each outline, the part number and required quantity (e.g. "13405 (CM86508) QTY=4").

You receive one CANDIDATE photo and one or two REFERENCE photos of the same kit that were verified good. Compare region by region:
1. Read the sheet: list every labelled outline/region and its required quantity.
2. For each region, decide from the CANDIDATE whether the part is present, absent, the wrong part, mis-oriented (e.g. face-down, mirrored bracket), or off-count (count loose fasteners inside their box). Use the REFERENCES to know what "correct" looks like; ignore differences in station, lighting, hands, background clutter, packaging film wrinkles, or label placement.
3. Verdict: "pass" only if every region matches; otherwise "hold". Confidence is your honest probability the verdict is right. Screw counts in a QTY box are hard at this resolution — if you cannot count reliably, report issue "unreadable" with low confidence rather than guessing.
4. Never invent a part number that is not printed on the sheet. Quote the sheet's own labels.
5. For every finding give "box": [x, y, w, h] — the region of the CANDIDATE image to look at, as fractions 0–1 of image width/height measured from the top-left (x,y = top-left corner of the box). Cover the printed outline and its label; err generous (a box a little too big is fine, a box on the wrong part is not).

Respond with ONLY a JSON object: {"verdict":"pass|hold","confidence":0-1,"kit_id":"...","sheet_title":"...","regions_checked":n,"findings":[{"region":"<label as printed>","issue":"missing|wrong_part|extra|orientation|count|unreadable|ok","expected":"...","observed":"...","severity":"blocking|minor|info","confidence":0-1,"box":[x,y,w,h]}],"photo_quality":{"readable":true,"notes":"..."},"explanation":"2-4 plain sentences a line lead can act on"}
Include only regions with an issue other than "ok" in findings (keep "ok" out), but count every region in regions_checked. "confidence" on the verdict is your probability the pass/hold call is right; "confidence" on a finding is your probability that specific finding is real.`;

function toImageBlock(bytes: Uint8Array, contentType: string) {
  const mt = (contentType === 'image/png' || contentType === 'image/webp' || contentType === 'image/gif') ? contentType : 'image/jpeg';
  return { type: 'image' as const, source: { type: 'base64' as const, media_type: mt as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: Buffer.from(bytes).toString('base64') } };
}

export async function pickReferences(src: S3Source, template: string, excludeKey: string, want: number): Promise<string[]> {
  const prefixes = [
    `${src.prefix}${template}/good/`,
    `templates/${template}/good/`,
    `${template}/good/`,
  ];
  for (const p of prefixes) {
    const entries = await listKeys({ bucket: src.bucket, prefix: p, region: src.region, max: 200 });
    const keys = entries.map(e => e.key).filter(k => k !== excludeKey && /\.(?:jpe?g|png|webp)$/i.test(k)).sort().reverse();
    if (keys.length) {
      return keys.slice(0, want);
    }
  }
  return [];
}

/**
 * Every adopted learning in the org, flattened — the rules the vision prompt must apply.
 * @param orgId
 */
export async function loadLearningRules(orgId: string): Promise<Array<{ id: number; step: string; text: string }>> {
  const out: Array<{ id: number; step: string; text: string }> = [];
  try {
    const steps = await listSteps(orgId);
    for (const st of steps) {
      const l = await getLearnings(orgId, st.name);
      for (const r of l.rules) {
        out.push({ id: r.id, step: st.name, text: r.ruleText });
      }
    }
  } catch { /* no learning steps — fine */ }
  return out;
}

function progress(ctx: RuntimeContext, tool: string, meta: Record<string, unknown>) {
  try {
    ctx.emit({ type: 'tool_progress', tool, meta } as never);
  } catch { /* emit is best-effort */ }
}

export function kitVisionTools(ctx: RuntimeContext) {
  const grants = new Set(ctx.harnessConfig.grantTools ?? []);
  const tools = [];

  if (grants.has('vision_compare_reference')) {
    tools.push(tool(
      async (raw) => {
        const input = raw as { image_key: string; template_id?: string; reference_keys?: string[]; references?: number };
        const src = await orgS3Source(ctx.orgId);
        const { bucket, key } = parseS3Ref(input.image_key, src?.bucket);
        const region = src?.region;
        const template = templateFromKey(key, input.template_id);
        if (!template) {
          return JSON.stringify({ error: 'Could not determine the template id from the key; pass template_id.' });
        }
        const refKeys = input.reference_keys?.length
          ? input.reference_keys.map(r => parseS3Ref(r, bucket).key)
          : src ? await pickReferences(src, template, key, Math.min(Math.max(input.references ?? 2, 1), 3)) : [];
        if (!refKeys.length) {
          return JSON.stringify({ error: `No verified-good reference photos found for template ${template}. Enrol the template with at least one good photo first.` });
        }
        progress(ctx, 'vision_compare_reference', { phase: 'references', template, image_key: key, reference_keys: refKeys, reference_urls: refKeys.map(k => appImageUrl(bucket, k)) });

        const rules = await loadLearningRules(ctx.orgId);
        const learningsBlock = rules.length
          ? `\n\n## Workspace learnings — approved rules, apply them\n${rules.map(r => `- (${r.step} #${r.id}) ${r.text.trim().replace(/\s+/g, ' ')}`).join('\n')}`
          : '';
        const systemPrompt = COMPARE_SYSTEM + learningsBlock;

        const [cand, ...refs] = await Promise.all([key, ...refKeys].map(k => getObjectBytes({ bucket, key: k, region })));
        progress(ctx, 'vision_compare_reference', { phase: 'model', model: VISION_MODEL, images: 1 + refs.length, learnings: rules.length });
        const client = new Anthropic();
        const content: Anthropic.ContentBlockParam[] = [
          { type: 'text', text: `CANDIDATE photo (key: ${key}):` },
          toImageBlock(cand!.bytes, cand!.contentType ?? guessContentType(key)),
        ];
        refs.forEach((r, i) => {
          content.push({ type: 'text', text: `REFERENCE ${i + 1} — verified good (key: ${refKeys[i]}):` });
          content.push(toImageBlock(r.bytes, r.contentType ?? guessContentType(refKeys[i]!)));
        });
        content.push({ type: 'text', text: `Template id: ${template}. Return the JSON verdict now.` });

        const res = await client.messages.create({
          model: VISION_MODEL,
          max_tokens: 1500,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: 'user', content }],
        });
        const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
        const jsonText = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
        const start = jsonText.indexOf('{');
        const end = jsonText.lastIndexOf('}');
        let verdict: z.infer<typeof VerdictSchema>;
        try {
          verdict = VerdictSchema.parse(JSON.parse(jsonText.slice(start, end + 1)));
        } catch (err) {
          return JSON.stringify({ error: `Vision model returned an unparseable verdict: ${(err as Error).message}`, raw: text.slice(0, 800) });
        }

        progress(ctx, 'vision_compare_reference', { phase: 'parsed', verdict: verdict.verdict, confidence: verdict.confidence, findings: verdict.findings.length });
        const pathMeta = src ? metadataFromKey(src.cfg, key) : {};
        const record = await upsertInspection(ctx, {
          imageKey: key,
          bucket,
          template,
          pathMeta,
          verdict: verdict.verdict,
          patch: {
            source: 'model',
            verdict: verdict.verdict,
            confidence: verdict.confidence,
            findings: verdict.findings,
            explanation: verdict.explanation,
            regions_checked: verdict.regions_checked ?? null,
            reference_keys: refKeys,
            checks: {
              ...((await findInspection(ctx.orgId, key))?.metadata as { checks?: Record<string, unknown> } | undefined)?.checks,
              reference: {
                model: VISION_MODEL,
                verdict: verdict.verdict,
                confidence: verdict.confidence,
                at: new Date().toISOString(),
                usage: res.usage,
                prompt: { system: systemPrompt, user: `CANDIDATE photo (${key}) + ${refKeys.length} REFERENCE photo(s) (${refKeys.join(', ')}); "Template id: ${template}. Return the JSON verdict now."` },
                learnings_applied: rules.map(r => ({ id: r.id, step: r.step, text: r.text })),
                temperature: 0,
              },
            },
          },
        });
        progress(ctx, 'vision_compare_reference', { phase: 'saved', inspection_id: record?.id ?? null });
        return JSON.stringify({
          ...verdict,
          template_id: template,
          image_key: key,
          image_url: appImageUrl(bucket, key),
          reference_keys: refKeys,
          inspection_id: record?.id ?? null,
          inspection_url: record?.url ?? null,
          note: record ? undefined : 'No `inspection` object type in this workspace — verdict not persisted.',
        });
      },
      {
        name: 'vision_compare_reference',
        description: 'Verify a kit photo against verified-good reference photos of the same template (reference-based matching; no per-kit programming). Reads the silhouette sheet labels, compares region by region, and returns a JSON verdict {verdict: pass|hold, confidence, findings[], explanation}. Upserts the `inspection` record for the photo (returns inspection_id + inspection_url). Costs a vision-model call — use on one photo at a time, not for browsing.',
        schema: z.object({
          image_key: z.string().describe('S3 key of the candidate photo (or s3://bucket/key). Find keys via search_knowledge on the kit-photos source.'),
          template_id: z.string().optional().describe('Kit template id; inferred from a templates/<id>/ key path when omitted'),
          reference_keys: z.array(z.string()).optional().describe('Specific verified-good keys to compare against; auto-picked from templates/<id>/good/ when omitted'),
          references: z.number().int().min(1).max(3).optional().describe('How many references to auto-pick (default 2)'),
        }),
      },
    ));
  }

  if (grants.has('vision_detect_labels')) {
    tools.push(tool(
      async (raw) => {
        const input = raw as { image_key: string; min_confidence?: number };
        const src = await orgS3Source(ctx.orgId);
        const { bucket, key } = parseS3Ref(input.image_key, src?.bucket);
        const region = process.env.VOCION_REKOGNITION_REGION ?? src?.region ?? process.env.AWS_REGION ?? 'us-east-1';
        const rek = new RekognitionClient({ region });
        let modelArn = process.env.VOCION_REKOGNITION_MODEL_ARN ?? '';
        let status = 'UNKNOWN';
        const projectArn = process.env.VOCION_REKOGNITION_PROJECT_ARN;
        if (projectArn) {
          const d = await rek.send(new DescribeProjectVersionsCommand({ ProjectArn: projectArn }));
          const versions = d.ProjectVersionDescriptions ?? [];
          const running = versions.find(v => v.Status === 'RUNNING');
          if (running?.ProjectVersionArn) {
            modelArn = running.ProjectVersionArn;
            status = 'RUNNING';
          } else {
            const latest = versions[0];
            status = latest?.Status ?? 'NO_VERSIONS';
            if (latest?.ProjectVersionArn && !modelArn) {
              modelArn = latest.ProjectVersionArn;
            }
            const f1 = latest?.EvaluationResult?.F1Score;
            return JSON.stringify({
              status,
              message: status === 'TRAINING_IN_PROGRESS'
                ? 'The Rekognition Custom Labels model is still training; the classifier check is unavailable until it completes and is started.'
                : `The Rekognition model is not running (status ${status}). Start it (StartProjectVersion) to enable the classifier check.`,
              model_arn: modelArn || null,
              f1: f1 ?? null,
            });
          }
        }
        if (!modelArn) {
          return JSON.stringify({ status: 'NOT_CONFIGURED', message: 'Set VOCION_REKOGNITION_PROJECT_ARN or VOCION_REKOGNITION_MODEL_ARN.' });
        }
        const res = await rek.send(new DetectCustomLabelsCommand({
          ProjectVersionArn: modelArn,
          Image: { S3Object: { Bucket: bucket, Name: key } },
          MinConfidence: input.min_confidence ?? 10,
        }));
        const labels = (res.CustomLabels ?? []).map(l => ({ name: l.Name ?? '', confidence: Math.round((l.Confidence ?? 0) * 10) / 1000 })).sort((a, b) => b.confidence - a.confidence);
        const top = labels[0];
        const template = templateFromKey(key);
        const pathMeta = src ? metadataFromKey(src.cfg, key) : {};
        const record = await upsertInspection(ctx, {
          imageKey: key,
          bucket,
          template,
          pathMeta,
          patch: {
            checks: {
              ...((await findInspection(ctx.orgId, key))?.metadata as { checks?: Record<string, unknown> } | undefined)?.checks,
              classifier: { model_arn: modelArn, labels, top: top ?? null, at: new Date().toISOString() },
            },
          },
        });
        return JSON.stringify({
          status: 'RUNNING',
          image_key: key,
          template_id: template,
          top_label: top ?? null,
          labels,
          inspection_id: record?.id ?? null,
          inspection_url: record?.url ?? null,
          note: 'Whole-image classifier (Rekognition Custom Labels, trained on this workspace\'s good/bad sets). A second opinion — it cannot name which part is wrong; use vision_compare_reference for that.',
        });
      },
      {
        name: 'vision_detect_labels',
        description: 'Second-opinion classifier: run the workspace\'s trained Amazon Rekognition Custom Labels model on a kit photo and return whole-image labels with confidence (e.g. C-PM-134-PC_good 0.97). Cannot name a specific missing part. Reports clearly when the model is training or stopped.',
        schema: z.object({
          image_key: z.string().describe('S3 key of the photo (or s3://bucket/key)'),
          min_confidence: z.number().min(0).max(100).optional().describe('Minimum label confidence percent to return (default 10)'),
        }),
      },
    ));
  }

  return tools;
}
