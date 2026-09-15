#!/usr/bin/env tsx
/**
 * report-daily — run the `daily-team-report` job by hand.
 *
 *   npm run report:daily -- --org <id-or-slug>                 # store briefing, mail if enabled
 *   npm run report:daily -- --org <id-or-slug> --to a@b.com    # override recipients
 *   npm run report:daily -- --org <id-or-slug> --no-mail       # in-app only
 *   npm run report:daily -- --org <id-or-slug> --html out.html # also write the HTML for eyeballing
 *   npm run report:daily -- --org <id-or-slug> --hours 48
 *
 * Exit codes: 0 success · 1 execution error · 2 bad usage / not found.
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { runDailyTeamReportJob } from '@/services/jobs/dailyTeamReport';
import { collectDailyTeamReport } from '@/services/reports/dailyTeamReport';
import { renderDailyTeamReport } from '@/services/reports/renderDailyTeamReport';
import 'dotenv/config';

function printHelp(): void {
  console.warn(`Usage:
  report-daily --org <id-or-slug> [--to a@b,c@d] [--hours 24] [--no-mail] [--no-publish] [--html out.html]

Options:
  --org         Project id or slug
  --to          Recipient list (comma separated); default = workspace accountableUser
  --hours       Window length in hours (default 24)
  --no-mail     Do not send mail even if VOCION_MAIL_ENABLED=1
  --no-publish  Do not store the briefing row
  --html        Write the rendered HTML to this path
  -h, --help    Show this help`);
}

async function resolveOrg(idOrSlug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(or(eq(projectSchema.id, idOrSlug), eq(projectSchema.slug, idOrSlug)))
    .limit(1);
  return row?.id ?? null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'org': { type: 'string' },
      'to': { type: 'string' },
      'hours': { type: 'string' },
      'no-mail': { type: 'boolean', default: false },
      'no-publish': { type: 'boolean', default: false },
      'html': { type: 'string' },
      'help': { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help || !values.org) {
    printHelp();
    process.exit(values.help ? 0 : 2);
  }
  const orgId = await resolveOrg(values.org);
  if (!orgId) {
    console.error(`no project with id or slug "${values.org}"`);
    process.exit(2);
  }
  const hours = values.hours ? Number(values.hours) : 24;

  if (values.html) {
    const until = new Date();
    const data = await collectDailyTeamReport(orgId, { since: new Date(until.getTime() - hours * 3_600_000), until });
    const rendered = renderDailyTeamReport(data);
    writeFileSync(values.html, rendered.html);
    console.warn(`wrote ${values.html} (${rendered.html.length} bytes)`);
  }

  const result = await runDailyTeamReportJob(orgId, {
    to: values.to,
    hours,
    mail: !values['no-mail'],
    publish: !values['no-publish'],
  });
  console.warn(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
