/**
 * THE 8.0 CODEMOD (ADR 0008): rewrites a workspace, a plugin, or a folder of
 * template files from the old form to the new one, and changes nothing on the
 * clock. Idempotent: a second run plans no edits.
 *
 * - `workspace.yaml` `version: 1` → `2`.
 * - Every schedule automation that names no zone gets `timezone: UTC` — what
 *   it always meant. (`localize` instead rewrites a simple cron into the
 *   workspace's zone at today's offset and leaves the zone to the workspace.)
 * - A mission's `schedule:` becomes `automations/<slug>-check.yaml`. When an
 *   active automation already checks the mission on a schedule, the mission's
 *   cron was a second fire of the same check and is removed. A workspace's
 *   changed cadence on a plugin mission becomes its own copy of the plugin's
 *   automation, with its cron.
 * - A daily-team-report mail timed to go out after a mission check becomes the
 *   mission's `deliver:`, sent when the check finishes. Only when exactly one
 *   check fits; otherwise it is left and named in the notes.
 */

import type { Document } from 'yaml';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { nextFire, zoneOffsetMinutes } from '@/libs/cron/schedule';

/** One file the migration writes (`after`) or deletes (`after: null`). */
export type MigrationEdit = { path: string; before: string | null; after: string | null };

export type MigrationPlan = { edits: MigrationEdit[]; notes: string[] };

/** An automation from outside the folder (a plugin's), as the loader composed it. */
export type ForeignAutomation = { slug: string; schedule?: string; checkMission?: string; active: boolean; text: string };

type Parsed = { path: string; text: string; doc: Document; out: string };

const REPORT_JOB = 'daily-team-report';
const MAX_GAP_MINUTES = 60;

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      return yamlFiles(p);
    }
    return /\.ya?ml$/.test(name) ? [p] : [];
  }).sort();
}

function parse(path: string): Parsed {
  const text = readFileSync(path, 'utf8');
  return { path, text, doc: parseDocument(text), out: text };
}

/**
 * The text edits, line by line, so a file changes only where it must:
 * re-serializing a YAML document re-folds every long string in it. Each
 * returns null when the file is not written the plain way it expects.
 */
const SCHEDULE_IN_WHEN = /^([ \t]+)schedule:[^\n]*$/m;

function addZone(text: string, zone: string, cron?: string): string | null {
  const m = SCHEDULE_IN_WHEN.exec(text);
  if (!m) {
    return null;
  }
  const line = cron ? `${m[1]}schedule: '${cron}'` : m[0];
  return text.replace(m[0], `${line}\n${m[1]}timezone: ${zone}`);
}

function dropTopLevel(text: string, key: string): string {
  return text.replace(new RegExp(`^${key}:.*(?:\\n|$)`, 'm'), '');
}

function appendDeliver(text: string, email: true | string[]): string {
  const body = email === true ? '  email: true\n' : `  email:\n${email.map(e => `    - ${e}\n`).join('')}`;
  return `${text.replace(/\s*$/, '')}\ndeliver:\n${body}`;
}

const str = (doc: Document, path: (string | number)[]): string | undefined => {
  const v = doc.getIn(path);
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
};

/**
 * Rewrite a cron read in UTC into `zone`'s wall clock at `at`'s offset. Only
 * a single minute and hours that stay on the same day under the shift — what
 * a "every weekday at 7" cron is; anything else returns null and stays UTC.
 * @param cron - The UTC cron.
 * @param zone - The workspace's zone.
 * @param at - The instant whose offset is used.
 */
export function localizeCron(cron: string, zone: string, at: Date): string | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5 || !/^\d+$/.test(f[0]!) || !/^\d+(?:,\d+)*$/.test(f[1]!)) {
    return null;
  }
  const offset = zoneOffsetMinutes(at, zone);
  if (offset % 60 !== 0) {
    return null;
  }
  const hours = f[1]!.split(',').map(h => Number(h) + offset / 60);
  if (hours.some(h => h < 0 || h > 23)) {
    return null;
  }
  return [f[0], hours.join(','), f[2], f[3], f[4]].join(' ');
}

/**
 * A string as a YAML scalar: plain when it can be, single-quoted when not.
 * @param v - The string.
 */
function yamlScalar(v: string): string {
  return /^[\s'"\-?{}[\]!&*|>%@`#,]|: |\s#|[\s:]$/.test(v) ? `'${v.replace(/'/g, '\'\'')}'` : v;
}

/**
 * Plan the migration of one folder. Pure but for reading the folder.
 * @param dir - A workspace (has workspace.yaml), a plugin (has plugin.yaml) or a folder of template files.
 * @param opts - Options.
 * @param opts.foreign - The plugins' automations a workspace composes, so a mission's cron already kept by one is not doubled.
 * @param opts.localize - Rewrite simple crons into the workspace's zone instead of pinning UTC.
 * @param opts.now - The instant whose offset `localize` uses.
 */
export function planMigration(dir: string, opts: { foreign?: ForeignAutomation[]; localize?: boolean; now?: Date } = {}): MigrationPlan {
  const edits = new Map<string, MigrationEdit>();
  const notes: string[] = [];
  const write = (p: Parsed) => {
    if (p.out !== p.text) {
      edits.set(p.path, { path: p.path, before: p.text, after: p.out });
    }
  };
  const rel = (p: string) => relative(dir, p);

  let zone: string | null = null;
  const manifestPath = join(dir, 'workspace.yaml');
  if (existsSync(manifestPath)) {
    const m = parse(manifestPath);
    zone = str(m.doc, ['defaults', 'timezone']) ?? null;
    if (m.doc.get('version') === 1) {
      m.out = m.out.replace(/^version:[ \t]*1[ \t]*$/m, 'version: 2');
      write(m);
    }
  }

  const automations = yamlFiles(join(dir, 'automations')).map(parse);
  const missions = yamlFiles(join(dir, 'missions')).map(parse);

  // 1. Every schedule names the clock it always meant.
  for (const a of automations) {
    const cron = str(a.doc, ['when', 'schedule']);
    if (!cron || a.doc.hasIn(['when', 'timezone'])) {
      continue;
    }
    const local = opts.localize && zone ? localizeCron(cron, zone, opts.now ?? new Date()) : null;
    const edited = local ? addZone(a.out, zone!, local) : addZone(a.out, 'UTC');
    if (edited === null) {
      notes.push(`${rel(a.path)}: its when: is not written one key per line — add timezone: UTC to it by hand.`);
      continue;
    }
    a.out = edited;
    if (local) {
      notes.push(`${rel(a.path)}: "${cron}" UTC is "${local}" in ${zone} (today's offset).`);
    }
    write(a);
  }

  // 2. A mission's cron becomes an automation, or goes when one already keeps it.
  const slugs = new Set([...automations.map(a => str(a.doc, ['slug'])), ...(opts.foreign ?? []).map(f => f.slug)].filter(Boolean) as string[]);
  for (const m of missions) {
    const cron = str(m.doc, ['schedule']);
    const slug = str(m.doc, ['slug']) ?? basename(m.path).replace(/\.ya?ml$/, '');
    if (!cron) {
      continue;
    }
    const own = automations.find(a => str(a.doc, ['do', 'checkMission']) === slug && a.doc.hasIn(['when', 'schedule']) && str(a.doc, ['status']) !== 'disabled');
    const foreign = (opts.foreign ?? []).find(f => f.checkMission === slug && f.schedule && f.active);
    m.out = dropTopLevel(m.out, 'schedule');
    write(m);
    if (own) {
      notes.push(`${rel(m.path)}: schedule "${cron}" removed — ${rel(own.path)} already checks it on a schedule (both fired).`);
      continue;
    }
    if (foreign && foreign.schedule === cron) {
      notes.push(`${rel(m.path)}: schedule "${cron}" removed — the plugin's automation "${foreign.slug}" keeps the same cadence.`);
      continue;
    }
    if (foreign) {
      const moved = foreign.text.replace(SCHEDULE_IN_WHEN, (_line, indent: string) => `${indent}schedule: '${cron}'`);
      const copy = /^\s+timezone:/m.test(moved) ? moved : addZone(moved, 'UTC') ?? moved;
      const path = join(dir, 'automations', `${foreign.slug}.yaml`);
      edits.set(path, { path, before: null, after: `# This workspace's cadence for the plugin's "${foreign.slug}" (moved from the mission's schedule: in 8.0).\n${copy}` });
      notes.push(`${rel(m.path)}: schedule "${cron}" now overrides the plugin's automation "${foreign.slug}".`);
      continue;
    }
    const name = [`${slug}-check`, `${slug}-scheduled-check`].find(s => !slugs.has(s));
    if (!name) {
      notes.push(`${rel(m.path)}: schedule "${cron}" removed, but the slugs ${slug}-check and ${slug}-scheduled-check are taken — write its automation by hand.`);
      continue;
    }
    slugs.add(name);
    const agent = str(m.doc, ['agent']);
    const title = str(m.doc, ['name']) ?? slug;
    const path = join(dir, 'automations', `${name}.yaml`);
    const body = [
      `# The cadence of the "${title}" mission (moved from its schedule: in 8.0).`,
      `slug: ${name}`,
      `name: ${yamlScalar(`${title} (scheduled check)`)}`,
      'status: active',
      ...(agent ? [`agent: ${agent}`] : []),
      'when:',
      `  schedule: '${cron}'`,
      '  timezone: UTC',
      'do:',
      `  checkMission: ${slug}`,
      '',
    ].join('\n');
    edits.set(path, { path, before: null, after: body });
    notes.push(`${rel(m.path)}: schedule "${cron}" → ${rel(path)}.`);
  }

  // 3. A timed mail after a check becomes that mission's deliver:.
  const at = (cron: string, tz: string) => nextFire(cron, new Date('2026-06-01T00:00:00Z'), tz)?.getTime() ?? null;
  for (const mail of automations) {
    const cron = str(mail.doc, ['when', 'schedule']);
    if (!cron || str(mail.doc, ['do', 'job']) !== REPORT_JOB || !mail.doc.hasIn(['do', 'input', 'briefing'])) {
      continue;
    }
    const tz = str(mail.doc, ['when', 'timezone']) ?? 'UTC';
    const mailAt = at(cron, tz);
    const checks = automations.filter((a) => {
      const c = str(a.doc, ['when', 'schedule']);
      const t = c ? at(c, str(a.doc, ['when', 'timezone']) ?? 'UTC') : null;
      return str(a.doc, ['do', 'checkMission']) && t !== null && mailAt !== null && mailAt - t > 0 && mailAt - t <= MAX_GAP_MINUTES * 60_000;
    });
    const mission = checks.length === 1 ? missions.find(m => (str(m.doc, ['slug']) ?? '') === str(checks[0]!.doc, ['do', 'checkMission'])) : undefined;
    if (!mission) {
      notes.push(`${rel(mail.path)}: a timed ${REPORT_JOB} mail, left as it is — ${checks.length === 0 ? 'no mission check runs before it' : checks.length > 1 ? 'more than one check runs before it' : 'its mission is not in this folder'}. Move it to that mission's deliver: by hand.`);
      continue;
    }
    const to = (mail.doc.toJS() as { do?: { input?: { to?: unknown } } }).do?.input?.to;
    const listed = Array.isArray(to) ? to.map(String) : typeof to === 'string' ? to.split(',').map(s => s.trim()).filter(Boolean) : [];
    mission.out = appendDeliver(mission.out, listed.length > 0 ? listed : true);
    write(mission);
    edits.set(mail.path, { path: mail.path, before: mail.text, after: null });
    notes.push(`${rel(mail.path)}: removed — ${rel(mission.path)} now delivers its briefing when its check (${rel(checks[0]!.path)}) finishes.`);
  }

  return { edits: [...edits.values()].sort((a, b) => a.path.localeCompare(b.path)), notes };
}
