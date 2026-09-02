/**
 * Run the kit-verification vision tools from the CLI — the same code path an
 * agent takes, minus the model loop. Useful for pre-running a batch before a
 * demo, for evals, and for measuring the reference comparison against the
 * labelled sample pack.
 *
 *   npm run kit:inspect -- --project <id|slug> --prefix templates/C-PM-134-PC/bad/
 *   npm run kit:inspect -- --project havis --key templates/X/good/file.jpg [--key …]
 *   npm run kit:inspect -- --project havis --prefix templates/ --limit 12 --classifier
 *
 * Every call writes a tool_call row (via the registry wrapper) and upserts the
 * inspection object exactly as a chat run would. Requires ANTHROPIC_API_KEY
 * and AWS credentials (AWS_PROFILE) in the environment.
 */

import type { RuntimeContext } from '@/services/agents/types';
import process from 'node:process';
import { eq, or } from 'drizzle-orm';
import { listKeys } from '@/libs/aws/s3';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { withToolCallRecord } from '@/services/agents/toolCallRecord';
import { kitVisionTools, orgS3Source } from '@/services/agents/tools/kitVision';

function parseArgs(argv: string[]) {
  const out: { project?: string; keys: string[]; prefix?: string; limit: number; classifier: boolean } = { keys: [], limit: 50, classifier: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--project') {
      out.project = argv[++i];
    } else if (a === '--key') {
      out.keys.push(argv[++i]!);
    } else if (a === '--prefix') {
      out.prefix = argv[++i];
    } else if (a === '--limit') {
      out.limit = Number(argv[++i]);
    } else if (a === '--classifier') {
      out.classifier = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || (!args.keys.length && !args.prefix)) {
    console.error('Usage: kit-inspect --project <id|slug> (--key <s3 key> … | --prefix <s3 prefix>) [--limit n] [--classifier]');
    process.exit(1);
  }
  const [project] = await db.select({ id: projectSchema.id }).from(projectSchema).where(or(eq(projectSchema.id, args.project), eq(projectSchema.slug, args.project))).limit(1);
  if (!project) {
    console.error(`No project matches "${args.project}".`);
    process.exit(1);
  }
  const src = await orgS3Source(project.id);
  if (!src) {
    console.error('No s3 source in this project.');
    process.exit(1);
  }
  let keys = args.keys;
  if (args.prefix) {
    const entries = await listKeys({ bucket: src.bucket, prefix: args.prefix, region: src.region, max: 2000 });
    keys = [...keys, ...entries.map(e => e.key).filter(k => /\.(?:jpe?g|png|webp)$/i.test(k))].slice(0, args.limit);
  }

  const ctx: RuntimeContext = {
    orgId: project.id,
    userId: 'cli:kit-inspect',
    agentSlug: 'pack-inspector',
    connectorSources: ['kit-photos'],
    objectTypeSlugs: ['inspection', 'kit-template'],
    searchConfig: { recencyDecay: 0, sourceWeights: {}, maxResults: 8, minRelevance: 0 } as RuntimeContext['searchConfig'],
    harnessConfig: { provider: 'local', grantTools: ['vision_compare_reference', 'vision_detect_labels'] },
    provider: 'local',
    emit: () => {},
    citationSeq: { current: 0 },
  };
  const tools = kitVisionTools(ctx).map(t => withToolCallRecord(t as never, ctx));
  const compare = tools.find(t => t.name === 'vision_compare_reference')!;
  const classify = tools.find(t => t.name === 'vision_detect_labels')!;

  let agree = 0;
  let total = 0;
  for (const key of keys) {
    const started = Date.now();
    const raw = await compare.invoke({ image_key: key });
    const r = JSON.parse(String(raw)) as { verdict?: string; confidence?: number; findings?: Array<{ region: string; issue: string }>; error?: string; inspection_id?: number };
    const label = key.includes('/good/') ? 'good' : key.includes('/bad/') ? 'bad' : '?';
    const expected = label === 'good' ? 'pass' : label === 'bad' ? 'hold' : '?';
    if (r.verdict) {
      total += 1;
      if (r.verdict === expected) {
        agree += 1;
      }
    }
    const mark = r.error ? '✗' : r.verdict === expected ? '✓' : r.verdict ? '≠' : '?';
    console.log(`${mark} ${key}\n    label=${label} verdict=${r.verdict ?? '-'} conf=${r.confidence ?? '-'} findings=${(r.findings ?? []).map(f => `${f.region}:${f.issue}`).join('; ') || 'none'} inspection=#${r.inspection_id ?? '-'} (${Math.round((Date.now() - started) / 1000)}s)${r.error ? `\n    error: ${r.error}` : ''}`);
    if (args.classifier) {
      const c = JSON.parse(String(await classify.invoke({ image_key: key }))) as { status?: string; top_label?: { name: string; confidence: number } | null; message?: string };
      console.log(`    classifier: ${c.status} ${c.top_label ? `${c.top_label.name} ${c.top_label.confidence}` : c.message ?? ''}`);
    }
  }
  console.log(`\nagreement with Havis labels: ${agree}/${total}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
