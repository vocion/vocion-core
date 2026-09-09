#!/usr/bin/env node
/**
 * Guard against config-file payload injection (PolinRider / TaskJacker pattern).
 *
 * In June 2026 this repo was hit by the PolinRider supply-chain campaign: ~20KB of
 * obfuscated JavaScript was appended to `packages/core/postcss.config.mjs` after
 * ~20,000 spaces on the `export default config;` line, so it was invisible in an
 * editor while executing on every dev/build/lint/test run. See docs/internal/SECURITY-INCIDENT-2026-06.md.
 *
 * This check fails on the tells that attack (and its known variants) leaves behind:
 *   1. Absurdly long lines in build-config files — the hiding place for the payload.
 *   2. Known campaign signature markers.
 *   3. VS Code tasks that auto-run on folder open — the TaskJacker execution trigger.
 *   4. Propagation artifacts (temp_auto_push.bat, config.bat).
 *
 * Run: npm run check:integrity
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

// Defaults to the repository root. A directory may be passed instead, which is
// how the test suite drives this script over a throwaway tree.
const ROOT = process.argv[2] === undefined
  ? new URL('..', import.meta.url).pathname
  : resolve(process.argv[2]);

/** Directories never worth scanning. */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  'storybook-static',
  'playwright-report',
  'test-results',
  '.turbo',
]);

/** Build-config files that execute at dev/build/lint/test time — the campaign's targets. */
const CONFIG_RE = /(?:^|\/)(?:postcss|tailwind|next|vite|webpack|rollup|astro|gridsome|vue|svelte|nuxt|eslint|babel|jest|vitest|playwright|commitlint|knip|truffle)\.config\.[cm]?[jt]s$/;

/**
 * A payload has to be long to be useful, and legitimate config lines are short.
 * Real content in these files sits well under 400 chars; the observed payload line was 20,642.
 */
const MAX_CONFIG_LINE = 500;

/** Signature markers from the observed PolinRider variants. */
const SIGNATURES = [
  'rmcej%otb%', // original variant marker
  'Cot%3t=shtP', // second variant marker
  '_$_1e42', // original decoder fn
  'e9b53a7c-2342-4b15-b02d-bd8b8f6a03f9', // StakingGame tasks.json UUID
  'default-configuration.vercel.app',
  'vscode-settings-bootstrap',
  'vscode-bootstrapper',
  'vscode-load-config',
  'geomi.dev', // EtherHiding stage-2 host used against this repo
];

/** Files whose mere presence indicates compromise. */
const BANNED_FILES = ['temp_auto_push.bat', 'config.bat'];

/**
 * Walk the tree, invoking `onFile` for every file outside SKIP_DIRS.
 * @param dir - Absolute directory to walk.
 * @param onFile - Called once per file.
 * @param onUnreadable - Called once per path that cannot be stat-ed.
 */
function walk(dir, onFile, onUnreadable) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const abs = join(dir, entry);

    // A dangling symlink makes statSync throw, which would end this check with
    // a stack trace instead of a verdict — and it is the first thing CI runs.
    // A broken link has no content to scan, so note it and carry on. The
    // committed case is a separate concern, covered by `npm run check:symlinks`.
    const rel = relative(ROOT, abs).split(sep).join('/');
    let stat;
    try {
      stat = statSync(abs);
    } catch (cause) {
      if (cause.code === 'ENOENT') {
        // A dangling symlink: nothing to read, so nothing to scan. Saying so
        // beats ending this check with a stack trace instead of a verdict —
        // and it is the first thing CI runs. The links that actually trigger
        // this are the untracked, gitignored ones a developer leaves in a
        // worktree, `packages/core/.env.local` pointing at another checkout
        // being the common one; `node_modules` never reaches here, since
        // SKIP_DIRS drops it before the stat.
        console.warn(`  - skipped ${rel} (not an error): dangling symlink, so there is nothing to scan.`);
        continue;
      }
      // Anything else is a path this guard could not inspect. Report it as a
      // finding rather than skipping quietly: a file that refuses to be read
      // is the opposite of a reason to pass.
      onUnreadable(`${rel}: could not be read — ${cause.message}. The integrity guard cannot vouch for a file it cannot stat.`);
      continue;
    }

    if (stat.isDirectory()) {
      walk(abs, onFile, onUnreadable);
    } else if (stat.isFile()) {
      onFile(abs, relative(ROOT, abs).split(sep).join('/'));
    }
  }
}

const findings = [];

walk(ROOT, (abs, rel) => {
  const base = rel.split('/').pop() ?? rel;

  if (BANNED_FILES.includes(base)) {
    findings.push(`${rel}: propagation artifact — this file is an indicator of compromise, not a build input.`);
    return;
  }

  // Only read text we care about: config files, VS Code json, and font-shaped decoys.
  const isConfig = CONFIG_RE.test(rel);
  const isVscodeTasks = rel === '.vscode/tasks.json';
  const isFont = /\.(?:woff2?|ttf|otf)$/.test(rel);

  if (isFont) {
    // A real font starts with a known magic number; a JS payload renamed to .woff2 does not.
    const head = readFileSync(abs).subarray(0, 4).toString('latin1');
    const magic = ['wOF2', 'wOFF', '\0\0\0', 'OTTO', 'true', 'ttcf'];
    if (!magic.some(m => head.startsWith(m))) {
      findings.push(`${rel}: font file does not start with a font magic number — possible disguised payload.`);
    }
    return;
  }

  if (!isConfig && !isVscodeTasks) {
    return;
  }

  const text = readFileSync(abs, 'utf8');

  for (const sig of SIGNATURES) {
    if (text.includes(sig)) {
      findings.push(`${rel}: contains known malware signature ${JSON.stringify(sig)}.`);
    }
  }

  if (isVscodeTasks && /"runOn"\s*:\s*"folderOpen"/.test(text)) {
    findings.push(`${rel}: task set to run on folder open — the TaskJacker execution trigger. Remove it or run the task explicitly.`);
  }

  if (isConfig) {
    const lines = text.split('\n');
    for (const [i, line] of lines.entries()) {
      if (line.length > MAX_CONFIG_LINE) {
        findings.push(
          `${rel}:${i + 1}: line is ${line.length} chars (limit ${MAX_CONFIG_LINE}). `
          + `Build configs do not have lines this long — check for a payload hidden past trailing whitespace.`,
        );
      }
    }
  }
}, message => findings.push(message));

if (findings.length > 0) {
  console.error('\n  Config integrity check FAILED:\n');
  for (const f of findings) {
    console.error(`  ✗ ${f}`);
  }
  console.error('\n  See docs/internal/SECURITY-INCIDENT-2026-06.md before dismissing any of these.\n');
  process.exit(1);
}

console.log('Config integrity check passed.');
