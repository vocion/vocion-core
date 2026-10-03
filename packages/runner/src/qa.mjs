// QA evidence: the before and after screenshots (and the video, when the contract asks) that every
// ui and marketing task carries. Plain Node 22 plus Playwright, which the worker image installs
// under /opt/factory/node_modules; nothing else.
//
// The pass runs after the required checks pass and before the branch is landed:
//
//   before   the same path on the surface's live URL (the contract's qa.surfaces[surface].live_url,
//            from the product's production environment), at each viewport. A path that 404s, a
//            path that bounces to sign-in, or a flow the contract marks `before: "none"` is
//            recorded absent with the reason in the caption. Nothing is invented.
//   after    the branch built inside the container with the surface's build block and served from
//            a static server (with a single page app's fallback when the block says so), then the
//            same path at each viewport.
//   video    only when qa.video is true, and only on the after run.
//
// Each image goes to s3://<bucket>/qa/<task id>/<run id>/, is presigned for seven days by the
// read-only presign user (its keys do not rotate, so seven days means seven days), and is
// published as an artifact on the engineering_task in the shape the feature report reads.
//
// Nothing here can fail a run. Every failure is caught, named, and reported in the qa-report
// artifact and as qaCaptured: false on the task record. A silent skip is the thing this replaces.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// ---------- the vocabulary ----------

/** The two viewports a flow may name. Widths are the ones the design is drawn at. */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/**
 * The surface a qa block's flows live on: its live URL and its build, from the contract (the repo
 * record's `surfaces` and the product's environments, filled at dispatch). Nothing about a product
 * is written in the runner. An empty object when the contract names none.
 */
export function surfaceOf(qa) {
  const name = qa?.surface || 'app';
  const s = qa?.surfaces && typeof qa.surfaces === 'object' ? qa.surfaces[name] : null;
  return s && typeof s === 'object' ? s : {};
}

const MIDDOT = String.fromCharCode(0xB7);
const WEEK_SECONDS = 7 * 24 * 60 * 60;

/** The live origin the before shot loads: the contract's own before_url, else the surface's live URL; '' when neither is known. */
export function productionBase(qa) {
  const explicit = String(qa?.before_url || '').replace(/\/+$/, '');
  return explicit || String(surfaceOf(qa).live_url || '').replace(/\/+$/, '');
}

/** "<flow> - <viewport> - before", with the middle dot the gallery expects. */
export function caption(flowName, viewport, side, extra = '') {
  const base = `${flowName} ${MIDDOT} ${viewport} ${MIDDOT} ${side}`;
  return extra ? `${base}: ${extra}` : base;
}

/** The gallery heading. The caption carries the detail, so the title stays short. */
export function evidenceTitle(flowName, viewport, side) {
  return `${flowName} ${MIDDOT} ${viewport} ${MIDDOT} ${side}`.slice(0, 100);
}

function slug(s, max = 40) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'flow';
}

/** qa/<task id>/<run id>/<flow>-<viewport>-<side>.<ext>. One prefix per run, so a retry never collides. */
export function evidenceKey(taskId, runId, flowName, viewport, side, ext) {
  return `qa/${slug(taskId, 64)}/${slug(String(runId), 32)}/${slug(flowName)}-${viewport}-${side}.${ext}`;
}

// ---------- the artifacts ----------
//
// The shape the feature report renders, and the only shape it renders: recordType 'object',
// recordId the engineering_task's id, recordRole one of qa-screenshot / qa-video / qa-report,
// kind 'file' | 'link' | 'markdown', title the gallery heading, spec.caption the line beneath it,
// spec.url the file.

function artifact(recordId, recordRole, kind, title, spec) {
  return { recordType: 'object', recordId: String(recordId), recordRole, kind, title, spec };
}

/**
 * A screenshot. `kind: 'link'` rather than `'file'` on purpose: core's file spec schema
 * (libs/cards/specs.ts) carries filename, contentType, bytes and url and nothing else, and a zod
 * object strips what it does not declare, so a caption posted on a file artifact would vanish
 * before the row was written. The link schema's `description` is the caption channel the report
 * reads (spec.caption, then spec.description, then spec.summary). The spec carries both spellings
 * of each field, so the gallery renders whichever validator the route ends up applying.
 */
export function screenshotArtifact({ recordId, flowName, viewport, side, url, note, bytes = 0, filename = '' }) {
  const text = caption(flowName, viewport, side, note);
  const title = evidenceTitle(flowName, viewport, side);
  return artifact(recordId, 'qa-screenshot', url ? 'link' : 'markdown', title, url
    ? { href: url, url, title, description: text, caption: text, filename, contentType: 'image/png', bytes }
    : { md: `${text}\n`, summary: text, caption: text, title });
}

export function videoArtifact({ recordId, flowName, viewport, url, seconds, bytes, filename = '' }) {
  const text = caption(flowName, viewport, 'after video', `${seconds}s, ${Math.round(bytes / 1024)} KB`);
  const title = evidenceTitle(flowName, viewport, 'after video');
  return artifact(recordId, 'qa-video', 'link', title, { href: url, url, title, description: text, caption: text, filename, contentType: 'video/webm', bytes });
}

// ---------- the repo's own test screenshots ----------
//
// Decision (2026-10-03, FE-398): pre-merge visual proof comes from the product repo's own
// browser tests, not from the runner building and serving a signed-in app it has no contract to
// build. A repo test that proves a line a person sees saves its screenshot under the contract's
// shots directory (default qa-shots/ at the repo root); the worker uploads whatever it finds
// there the same way it uploads its own shots, so QA can cite them from the task record.

const SHOT_FILE_RE = /\.(png|jpe?g)$/i;
const SHOT_CONTENT_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
export const REPO_SHOT_LIMITS = { files: 24, bytes: 5 * 1024 * 1024 };

/** Every PNG/JPEG under `dir`, recursively, sorted so the report and the upload order agree. */
function listShotFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(full, relPath);
      } else if (SHOT_FILE_RE.test(e.name)) {
        out.push({ full, rel: relPath, name: e.name });
      }
    }
  };
  walk(dir, '');
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/**
 * "title-line-phone.png" -> { caption: "title line · phone", viewport: "phone" }. A trailing
 * -phone, -desktop or -<width> names the viewport; anything else is read as one caption with no
 * viewport, so a file named plainly still uploads.
 */
export function captionForShotFile(filename) {
  const base = String(filename || '').replace(/\.[^.]+$/, '');
  const m = /^(.*[^-])-(phone|desktop|\d{2,4})$/.exec(base);
  const namePart = m ? m[1] : base;
  const viewport = m ? m[2] : '';
  const text = namePart.replace(/[-_]+/g, ' ').trim() || base;
  return { caption: viewport ? `${text} ${MIDDOT} ${viewport}` : text, viewport };
}

/**
 * Uploads the repo's own test screenshots as qa-screenshot artifacts, exactly the shape and
 * storage path (`evidenceKey`, `uploadEvidence`, `publishArtifact`) the worker's own shots use, so
 * `taskPicturesStored` sees them and QA can cite them. Never fails the run: a read, size or upload
 * problem for one file is recorded in `skipped` and the rest still upload. Capped at
 * REPO_SHOT_LIMITS so a test suite that writes hundreds of frames cannot flood the task record.
 */
/**
 * Keeps the repo's own QA shots out of the branch: appends an ignore line for the shots directory
 * to `.git/info/exclude` (never `.gitignore`, which would itself be a change the engineer commits)
 * unless it is already there. Called before the engineer's first commit, so a test run's
 * screenshots are never untracked files `git status` offers to `land`'s `git add`, whatever the
 * engineer or a test writes there later in the run.
 */
export function excludeShotsDir(repoDir, shotsDir) {
  const file = path.join(repoDir, '.git', 'info', 'exclude');
  const line = `/${String(shotsDir).replace(/^\/+|\/+$/g, '')}/`;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.split('\n').map(l => l.trim()).includes(line)) {
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${existing && !existing.endsWith('\n') ? '\n' : ''}${line}\n`);
}

export async function collectRepoTestShots({ dir, taskId, runId, recordId, aws, post, artifactUrl, limit = REPO_SHOT_LIMITS.files, maxBytes = REPO_SHOT_LIMITS.bytes }) {
  const uploaded = [];
  const skipped = [];
  const evidence = [];
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { uploaded, skipped, evidence };
  }
  const files = listShotFiles(dir);
  if (!files.length) {
    return { uploaded, skipped, evidence };
  }
  let credentials = null;
  try {
    credentials = await containerCredentials();
  } catch {
    // no task role; canUpload below records the reason per file
  }
  const canUpload = Boolean(credentials && aws?.bucket && aws?.presign?.accessKeyId);
  for (const f of files) {
    if (uploaded.length >= limit) {
      skipped.push({ file: f.rel, reason: `over the limit of ${limit} files; the rest were not uploaded` });
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(f.full);
    } catch (e) {
      skipped.push({ file: f.rel, reason: `could not read: ${String(e.message || e).slice(0, 150)}` });
      continue;
    }
    if (stat.size > maxBytes) {
      skipped.push({ file: f.rel, reason: `${(stat.size / 1024 / 1024).toFixed(1)} MB is over the ${(maxBytes / 1024 / 1024).toFixed(0)} MB cap` });
      continue;
    }
    if (!canUpload) {
      skipped.push({ file: f.rel, reason: 'the container could not reach the evidence bucket' });
      continue;
    }
    const ext = (f.name.match(/\.([^.]+)$/) || [, 'png'])[1].toLowerCase();
    const contentType = SHOT_CONTENT_TYPE[ext] || 'image/png';
    const { caption: text, viewport } = captionForShotFile(f.name);
    const title = text.slice(0, 100);
    let url = '';
    try {
      const body = fs.readFileSync(f.full);
      const key = evidenceKey(taskId, runId, `repo-test ${text}`, viewport || 'desktop', 'after', ext === 'jpg' ? 'jpeg' : ext);
      url = await uploadEvidence({ bucket: aws.bucket, region: aws.region, key, body, contentType, credentials, presign: aws.presign });
    } catch (e) {
      skipped.push({ file: f.rel, reason: `upload failed: ${String(e.message || e).slice(0, 200)}` });
      continue;
    }
    const spec = { href: url, url, title, description: text, caption: text, filename: f.name, contentType, bytes: stat.size };
    let artifactId = null;
    if (post && recordId) {
      const r = await publishArtifact(post, artifact(recordId, 'qa-screenshot', 'link', title, spec));
      if (r.ok) {
        artifactId = r.id;
      } else {
        skipped.push({ file: f.rel, reason: `artifact refused: ${r.error} (${r.status})` });
      }
    }
    uploaded.push({ file: f.rel, caption: text, viewport, url });
    evidence.push({ role: 'qa-screenshot', source: 'repo-test', flow: f.rel, viewport: viewport || undefined, url, caption: text, ...(artifactId ? { artifactId } : {}) });
  }
  return { uploaded, skipped, evidence };
}

export function reportArtifact({ recordId, taskId, markdown, summary }) {
  const title = `QA evidence for ${taskId}`.slice(0, 100);
  return artifact(recordId, 'qa-report', 'markdown', title, { md: markdown, summary: String(summary || 'What the worker captured, and anything it could not').slice(0, 200), caption: summary, title });
}

/**
 * The one markdown artifact that says what happened, including when nothing did. Absence is a row
 * in the table with a reason, never a missing row.
 */
export function qaReportMarkdown({ taskId, runId, base, qa, rows = [], failures = [], elapsedS = 0, bytes = 0, videoSeconds = 0, repoShots = null }) {
  const cell = v => String(v ?? '').replace(/\|/g, '\\|').slice(0, 200);
  const lines = [
    `# QA evidence for ${taskId}`,
    '',
    `Run ${runId}. Surface \`${qa?.surface || 'app'}\`, before from ${base || 'no live URL'}, ${qa?.video ? 'video on' : 'video off'}.`,
    `Captured in ${elapsedS}s, ${(bytes / 1024 / 1024).toFixed(2)} MB uploaded.`,
    '',
    '| flow | viewport | side | result |',
    '|---|---|---|---|',
    ...rows.map(r => `| ${cell(r.flow)} | ${cell(r.viewport)} | ${cell(r.side)} | ${cell(r.note || (r.url ? 'captured' : 'not captured'))} |`),
  ];
  if (!rows.length) {
    lines.push('| (none) | | | no flow produced a shot |');
  }
  if (videoSeconds) {
    lines.push('', `Video added ${videoSeconds}s to the pass.`);
  }
  // From the repo's own tests: a line a person sees, proven by a browser test in the repo rather
  // than by the worker building and serving the app (it has no contract to build a signed-in
  // surface; see the FE-398 decision). A reader should tell these apart from the worker's shots.
  if (repoShots && (repoShots.uploaded?.length || repoShots.skipped?.length)) {
    lines.push('', "## From the repo's own tests", '');
    if (repoShots.uploaded?.length) {
      lines.push('| file | caption | viewport |', '|---|---|---|');
      for (const s of repoShots.uploaded) {
        lines.push(`| ${cell(s.file)} | ${cell(s.caption)} | ${cell(s.viewport || 'desktop')} |`);
      }
    } else {
      lines.push('(none uploaded)');
    }
    if (repoShots.skipped?.length) {
      lines.push('', 'Skipped:');
      for (const s of repoShots.skipped) {
        lines.push(`- **${cell(s.file)}**: ${String(s.reason).slice(0, 300)}`);
      }
    }
  }
  if (failures.length) {
    lines.push('', '## What failed', '');
    for (const f of failures) {
      lines.push(`- **${f.scope}**: ${String(f.message).slice(0, 400)}`);
    }
  } else {
    lines.push('', 'Nothing failed.');
  }
  return lines.join('\n').split(String.fromCharCode(0x2014)).join(',');
}

// ---------- SigV4, without the AWS SDK ----------

const sha256hex = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const amzTime = d => d.toISOString().replace(/[:-]|\.\d{3}/g, '');
const uriEncode = (s, encodeSlash = true) =>
  String(s).replace(/[^\w.~\-/]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`).replace(/\//g, encodeSlash ? '%2F' : '/');

function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

/**
 * A presigned GET that lasts `expiresIn` seconds. Signed with the read-only presign user's static
 * keys, never with a role session: a role session dies in hours and would take the link with it.
 */
export function presignGet({ bucket, key, region, accessKeyId, secretAccessKey, expiresIn = WEEK_SECONDS, now = new Date(), contentType }) {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const amzDate = amzTime(now);
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const params = new Map([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  if (contentType) {
    params.set('response-content-type', contentType);
  }
  const query = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&');
  const canonical = ['GET', uriEncode(`/${key}`, false), query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const signature = hmac(signingKey(secretAccessKey, date, region, 's3'), toSign).toString('hex');
  return `https://${host}${uriEncode(`/${key}`, false)}?${query}&X-Amz-Signature=${signature}`;
}

/** The Authorization header for a PUT, signed with whatever credentials the container holds. */
export function signPut({ bucket, key, region, body, contentType, credentials, now = new Date() }) {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const amzDate = amzTime(now);
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const payloadHash = sha256hex(body);
  const headers = {
    host,
    'content-type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (credentials.sessionToken) {
    headers['x-amz-security-token'] = credentials.sessionToken;
  }
  const names = Object.keys(headers).sort();
  const canonical = [
    'PUT',
    uriEncode(`/${key}`, false),
    '',
    `${names.map(n => `${n}:${String(headers[n]).trim()}`).join('\n')}\n`,
    names.join(';'),
    payloadHash,
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const signature = hmac(signingKey(credentials.secretAccessKey, date, region, 's3'), toSign).toString('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return { url: `https://${host}${uriEncode(`/${key}`, false)}`, headers };
}

/** The task role's credentials, from the ECS credential endpoint. Null when there is none. */
export async function containerCredentials(env = process.env) {
  const rel = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  const full = env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN || '' };
  }
  const url = rel ? `http://169.254.170.2${rel}` : full;
  if (!url) {
    return null;
  }
  const res = await fetch(url, { headers: env.AWS_CONTAINER_AUTHORIZATION_TOKEN ? { authorization: env.AWS_CONTAINER_AUTHORIZATION_TOKEN } : {}, signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    return null;
  }
  const j = await res.json();
  return { accessKeyId: j.AccessKeyId, secretAccessKey: j.SecretAccessKey, sessionToken: j.Token };
}

// ---------- the static server ----------

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml', '.pdf': 'application/pdf' };

/**
 * Serves a built directory the way its host does: a single page app (`spa_fallback`) answers every
 * unknown path with index.html and a 200, as a CDN mapping 403 and 404 there does; a static site
 * has clean URLs, so /pricing resolves to pricing/index.html.
 */
export function serveDist(dir, port, { spaFallback }) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '');
    const candidates = rel === '' ? ['index.html'] : [rel, `${rel}/index.html`, `${rel}.html`];
    for (const c of candidates) {
      const file = path.join(dir, c);
      if (!file.startsWith(dir)) {
        break;
      }
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    if (spaFallback && fs.existsSync(path.join(dir, 'index.html'))) {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      fs.createReadStream(path.join(dir, 'index.html')).pipe(res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  // The usual port, or any free one: run 384 lost every screenshot because something the
  // engineer started still held 5274 (EADDRINUSE). The URL comes from the server, not the config.
  const listen = p => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, '127.0.0.1', () => {
      server.removeListener('error', reject); resolve(server);
    });
  });
  return listen(port).catch(e => (e && e.code === 'EADDRINUSE' ? listen(0) : Promise.reject(e)));
}

// ---------- route placeholders ----------
//
// A contract's flow path can come from a real request's surfaceUrl, which names the pattern, not a
// record: `/documents/[id]`. Prod evidence (2026-09-28, runs 405/406, task #214): the worker loaded
// the literal id "[id]", the app answered "Could not load this document - That document does not
// exist", and every screenshot for that flow showed the same error, before and after, so QA could
// never prove the criterion. A placeholder is resolved to a real record from the app this worker
// just built and served, before the flow's first navigation, and the same resolved path is used for
// both the before and the after shot.

/** One path segment that names a placeholder rather than a value: `[id]`, `[slug]`, `:id`, `{id}`. */
export const PLACEHOLDER_SEGMENT_RE = /^(\[[^[\]/]+\]|:[^/]+|\{[^{}/]+\})$/;

/** True when any segment of `pathStr` is a placeholder. */
export function hasPlaceholder(pathStr) {
  return String(pathStr || '').split('/').some(s => PLACEHOLDER_SEGMENT_RE.test(s));
}

function placeholderName(segment) {
  return segment.replace(/^[[{:]/, '').replace(/[\]}]$/, '');
}

/**
 * The first placeholder in `pathStr`: its index among the path's segments, the segments themselves,
 * the bare name (`id` for `[id]`, `:id` or `{id}`), and the prefix (the segments before it, joined
 * back into a path) - the list route a record for it should come from. Null when there is none.
 */
export function findPlaceholder(pathStr) {
  const segments = String(pathStr || '').split('/');
  const index = segments.findIndex(s => PLACEHOLDER_SEGMENT_RE.test(s));
  if (index === -1) {
    return null;
  }
  return { index, segments, name: placeholderName(segments[index]), prefix: segments.slice(0, index).join('/') || '/' };
}

/** `pathStr` with the segment at `index` replaced by `value`. */
export function substitutePlaceholder(pathStr, index, segments, value) {
  const next = [...segments];
  next[index] = value;
  return next.join('/');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Named list routes worth a look beyond the placeholder's own prefix, since a resource's list often
 * lives elsewhere (an app's document list may be its root, `/`, not `/documents`). The surface
 * names its own (`list_routes`); the root is tried last either way. Tried in order, after the
 * prefix itself, until one page's links name a real record.
 */
export const LIST_ROUTE_FALLBACKS = ['/'];

/** The list routes for a surface: its own, then the root. */
export function listRoutesFor(surface) {
  const own = Array.isArray(surface?.list_routes) ? surface.list_routes.filter(r => typeof r === 'string' && r.startsWith('/')) : [];
  return [...new Set([...own, ...LIST_ROUTE_FALLBACKS])];
}

/**
 * Opens `listPath` on the running app and returns the first link whose path starts with `prefix`
 * plus one more segment - "the list's first item" - or null when the page has none (a 404, an empty
 * list, or a list of some other resource).
 */
export async function firstListItemHref(page, base, listPath, prefix) {
  const res = await page.goto(`${base}${listPath}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
  if (!res) {
    return null;
  }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const hrefs = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href') || '')).catch(() => []);
  const re = new RegExp(`^${escapeRe(prefix === '/' ? '' : prefix)}/[^/?#]+`);
  const match = hrefs.find(h => re.test(h));
  return match ? match.split(/[?#]/)[0] : null;
}

/**
 * Resolves every placeholder in `path` to a real record from the app running at `base`: for each
 * one, in turn, tries its own prefix as a list route, then the named fallbacks, taking the first
 * page whose links hold a record under that prefix, and the first such link as the record. Logs
 * `qa.path.resolved {from, to}` per substitution. Stops, unresolved, at the first placeholder
 * nothing could fill in - a silent 404 screenshot is the thing this replaces.
 */
export async function resolveRoutePlaceholders({ page, base, path, log = () => {}, fallbacks = LIST_ROUTE_FALLBACKS }) {
  let current = String(path || '');
  const replacements = [];
  for (let guard = 0; guard < 5; guard += 1) {
    const found = findPlaceholder(current);
    if (!found) {
      return { path: current, ok: true, replacements };
    }
    const candidates = [found.prefix, ...fallbacks].filter((c, i, arr) => arr.indexOf(c) === i);
    let href = null;
    for (const candidate of candidates) {
      href = await firstListItemHref(page, base, candidate, found.prefix);
      if (href) {
        break;
      }
    }
    if (!href) {
      return { path: current, ok: false, unresolved: found };
    }
    const prefixDepth = found.prefix === '/' ? 0 : found.prefix.split('/').filter(Boolean).length;
    const value = href.split('/').filter(Boolean)[prefixDepth];
    if (!value) {
      return { path: current, ok: false, unresolved: found };
    }
    const next = substitutePlaceholder(current, found.index, found.segments, value);
    log('qa.path.resolved', { from: current, to: next });
    replacements.push({ from: current, to: next });
    current = next;
  }
  return { path: current, ok: true, replacements };
}

// ---------- an app error mistaken for the feature ----------

/**
 * Phrases an app's error states commonly show. The surface adds its own (`error_text`): a
 * product's 404 page and its empty-record message are its words, not the runner's.
 */
export const ERROR_STATE_PATTERNS = [/could not load/i, /does not exist/i, /page not found/i];

/** The error phrases for a surface: the generic ones and its own, as plain substrings, case-insensitive. */
export function errorPatternsFor(surface) {
  const own = Array.isArray(surface?.error_text) ? surface.error_text.filter(t => typeof t === 'string' && t.trim()) : [];
  return [...ERROR_STATE_PATTERNS, ...own.map(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))];
}

/** True when the page's own text says it hit an app error - a broken id, a 404 - not the feature. */
export async function detectErrorState(page, patterns = ERROR_STATE_PATTERNS) {
  try {
    // innerText, not textContent: an error message a page renders is what counts, not one hidden in the DOM.
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    const text = await page.evaluate(() => document.body?.innerText || '');
    return patterns.some(re => re.test(text));
  } catch {
    return false;
  }
}

// ---------- driving a page ----------

// ---------- values a flow carries from one step to the next ----------
//
// A flow on a live product prepares its own state (Chris, 2026-10-01: the live check reached 0 of 6
// states because the QA account had none of the mock build's records). Preparing it means carrying
// what one step made into the next: the page a just-uploaded record landed on, the link it shares.
// `remember` keeps a value under a name, and `{{name}}` in any later path, target or value reads it.

/** `{{name}}` in a flow's strings: a value an earlier `remember` kept. */
export const VAR_RE = /\{\{\s*([a-z][\w-]{0,40})\s*\}\}/gi;

/**
 * `value` with every `{{name}}` read from `vars`; strings inside objects and arrays too. A name
 * nothing remembered is an error that says which: a step pointed at a value that does not exist
 * would otherwise load or click the literal braces.
 */
export function fillVars(value, vars = {}) {
  if (typeof value === 'string') {
    return value.replace(VAR_RE, (_, name) => {
      if (vars[name] === undefined || vars[name] === null || vars[name] === '') {
        throw new Error(`{{${name}}} was never remembered by an earlier step`);
      }
      return String(vars[name]);
    });
  }
  if (Array.isArray(value)) {
    return value.map(v => fillVars(v, vars));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillVars(v, vars)]));
  }
  return value;
}

/** Where a flow's path or a `goto` points: an absolute address as it is, a path on `base`. */
export function addressOf(base, target) {
  const t = String(target || '');
  return /^https?:\/\//i.test(t) ? t : `${String(base || '').replace(/\/+$/, '')}${t.startsWith('/') ? '' : '/'}${t}`;
}

/** How long `remember from url` waits for a page an earlier step moved to, in milliseconds. */
export const URL_MOVE_TIMEOUT_MS = 15000;

/**
 * The page's address for `remember from url`. When an earlier step in this flow acted (an upload, a
 * click, a fill) and the page is still where the flow started, it waits for the page to move; if it
 * never does, the record the action was to make was not reached, and remembering the start page
 * would send every later flow back to it (run 3, 2026-10-01: the upload failed on production, the
 * setup remembered /new, and every check ran on the upload page).
 * @param {object} page - The Playwright page.
 * @param {object} ctx - The flow's context: `startUrl` (where it opened) and `acted`.
 * @returns {Promise<string>} The address.
 */
async function urlAfterAction(page, ctx) {
  const start = ctx.startUrl;
  if (!ctx.acted || !start || page.url() !== start) {
    return page.url();
  }
  const moved = await page.waitForURL(u => String(u) !== start, { timeout: ctx.urlMoveTimeoutMs ?? URL_MOVE_TIMEOUT_MS }).then(() => true).catch(() => false);
  if (!moved) {
    throw new Error(`the page never left ${new URL(start).pathname}, where this flow started, after its steps acted, so what they were to make was not reached`);
  }
  return page.url();
}

// ---------- what the page asked the server, and what it answered ----------
//
// A promise about an API is proven by its response, not by a picture (2026-10-02, FE-314: "after
// deploy, GET /v1/documents with a valid signed-in session returns 200" could only be shot as the
// page around it). Every flow keeps the responses its page received (method, path, status; never a
// body, a header or a query), and `expect_response` passes when one answered as promised.

/** How long `expect_response` waits for the response it names, in milliseconds. */
export const EXPECT_RESPONSE_TIMEOUT_MS = 10000;

/** The path part of a path or an address: what `expect_response` compares. */
function pathOf(target) {
  const t = String(target || '').trim();
  try {
    return /^https?:\/\//i.test(t) ? new URL(t).pathname : t.split(/[?#]/)[0];
  } catch {
    return t;
  }
}

/**
 * Whether a response the page received answered as `want` promised: its path is `want.path` or ends
 * with it (at a segment), its method is `want.method` when one is named (a CORS preflight never
 * stands in when none is), and its status is `want.status`. When none did, `line` says what was seen
 * instead: "GET /v1/documents returned 500", or "no request to /v1/documents (the page made: …)".
 * @param {Array<{method: string, url: string, status: number, type?: string}>} seen - The responses, in order.
 * @param {{path: string, status: number, method?: string}} want - The promise.
 * @returns {{ok: boolean, line: string, match?: {method: string, path: string, status: number}}}
 */
export function matchResponse(seen, want) {
  const path = pathOf(want.path);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const method = want.method ? String(want.method).toUpperCase() : null;
  const status = Number(want.status);
  const at = r => pathOf(r.url);
  const named = (seen || []).filter((r) => {
    const p = at(r);
    return (p === path || p.endsWith(suffix)) && (method ? r.method === method : r.method !== 'OPTIONS');
  });
  const hit = named.find(r => r.status === status);
  if (hit) {
    return { ok: true, line: `${hit.method} ${at(hit)} returned ${hit.status}`, match: { method: hit.method, path: at(hit), status: hit.status } };
  }
  if (named.length > 0) {
    const answers = [...new Set(named.map(r => `${r.method} ${at(r)} returned ${r.status}`))];
    return { ok: false, line: `${answers.slice(0, 3).join('; ')}, not ${status}` };
  }
  const made = [...new Set((seen || []).filter(r => !r.type || ['fetch', 'xhr', 'document'].includes(r.type)).map(r => `${r.method} ${at(r)} ${r.status}`))];
  return { ok: false, line: `no ${method ? `${method} ` : ''}request to ${path} was made${made.length ? ` (the page made: ${made.slice(0, 6).join(', ')})` : ''}` };
}

/** The longest `pause` a step may ask for, in seconds. */
export const MAX_PAUSE_SECONDS = 30;

/**
 * One step of the declarative vocabulary. Unknown verbs never reach here; the contract refuses them.
 * `ctx.vars` holds what `remember` kept; `ctx.allow(url)` says whether an address may be opened
 * (the live check allows only the product's own origins).
 */
async function runStep(page, rawStep, shoot, ctx = {}) {
  const vars = ctx.vars || {};
  const step = fillVars(rawStep, vars);
  if (step.goto) {
    const url = addressOf(ctx.base || page.url(), step.goto);
    if (ctx.allow && !ctx.allow(url)) {
      throw new Error(`${new URL(url).origin} is not one of the product's own addresses, so it was not opened`);
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    return;
  }
  if (step.remember) {
    const { name, from = step.remember.selector ? 'text' : 'url', selector } = step.remember;
    let value = '';
    if (from === 'url') {
      value = await urlAfterAction(page, ctx);
    } else {
      const el = locate(page, selector).first();
      await el.waitFor({ state: 'attached', timeout: 15000 });
      value = from === 'href'
        ? await el.evaluate(n => n.href || n.getAttribute('href') || '')
        : from === 'value'
          ? await el.inputValue()
          // What the element shows a person, as rendered.
          // eslint-disable-next-line unicorn/prefer-dom-node-text-content
          : await el.innerText();
    }
    value = String(value || '').trim();
    if (!value) {
      throw new Error(`nothing to remember as ${name}: the ${from}${selector ? ` of ${JSON.stringify(selector).slice(0, 80)}` : ''} is empty`);
    }
    vars[name] = value;
    return;
  }
  if (step.expect_response) {
    const want = step.expect_response;
    const seen = ctx.responses || [];
    const deadline = Date.now() + (ctx.expectResponseTimeoutMs ?? EXPECT_RESPONSE_TIMEOUT_MS);
    let found = matchResponse(seen, want);
    while (!found.ok && Date.now() < deadline) {
      await page.waitForTimeout(250);
      found = matchResponse(seen, want);
    }
    if (!found.ok) {
      throw new Error(found.line);
    }
    (ctx.proofs ||= []).push(found.match);
    return;
  }
  if (step.pause !== undefined) {
    await page.waitForTimeout(Math.min(MAX_PAUSE_SECONDS, Math.max(0, Number(step.pause) || 0)) * 1000);
    return;
  }
  if (step.wait_for) {
    await locate(page, step.wait_for).first().waitFor({ state: 'visible', timeout: 15000 });
    return;
  }
  if (step.click) {
    await locate(page, step.click).first().click({ timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    return;
  }
  if (step.fill) {
    await page.locator(step.fill.selector).first().fill(String(step.fill.value ?? ''), { timeout: 15000 });
    return;
  }
  // A bad connection is a state too (2026-09-28, #126: "No signal · N% kept · retrying" could not be
  // shown because the capture could neither pick a large file nor drop the network).
  if (step.upload) {
    const mb = Math.min(64, Math.max(0.001, Number(step.upload.megabytes) || 1));
    const name = step.upload.name || `sample-${mb}mb.pdf`;
    await page.locator(step.upload.selector).first().setInputFiles({ name, mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', buffer: samplePdf(Math.round(mb * 1024 * 1024)) }, { timeout: 15000 });
    return;
  }
  if (typeof step.offline === 'boolean') {
    await page.context().setOffline(step.offline);
    return;
  }
  if (step.shoot) {
    await shoot(step.shoot);
  }
}

/**
 * A real one-page PDF of `bytes` (or the smallest one, when that is fewer): a catalog, a page that
 * says it is a QA sample, and a cross-reference table, padded with a comment after the header. A
 * product that opens what it is given (a live upload renders its pages) needs a PDF a reader can
 * open; a padded header and an end marker was refused.
 */
export function samplePdf(bytes, text = 'Sample file for a QA flow') {
  const words = String(text).replace(/[()\\\r\n]/g, ' ').slice(0, 80);
  const stream = `BT /F1 24 Tf 72 700 Td (${words}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const build = (padding) => {
    let out = `%PDF-1.4\n${padding}`;
    const offsets = [];
    objects.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  };
  const bare = build('');
  const room = Math.max(0, Math.floor(bytes) - bare.length);
  // A comment line is "%", the filler, "\n"; startxref's digits may grow by the padding's own length.
  if (room < 2) {
    return Buffer.from(bare, 'latin1');
  }
  let padding = `%${' '.repeat(room - 2)}\n`;
  let out = build(padding);
  padding = `%${' '.repeat(Math.max(0, room - 2 - (out.length - bare.length - room)))}\n`;
  out = build(padding);
  return Buffer.from(out, 'latin1');
}

/** A Playwright selector engine prefix: `text=Remind`, `role=switch`, `css=...`, `data-testid=...`. */
export const SELECTOR_ENGINE_RE = /^(?:css|text|xpath|role|id|data-testid|data-test-id|data-test|internal:[a-z-]+)=/i;

/**
 * True when the step's target is a selector rather than words a person sees. Prod evidence
 * (2026-09-29, #130 runs 409 and 410): the engineer wrote `text=Remind`,
 * `button:text-is('Send reminder')` and `button[role=switch]:has-text('Remind automatically')`,
 * all valid Playwright, and every one was read as a button's accessible name because it held an
 * `=` or a space, so no step reached its state. Spaces inside quotes, brackets or a pseudo-class's
 * parentheses no longer make a selector into text.
 */
export function isSelector(target) {
  const t = String(target || '').trim();
  if (SELECTOR_ENGINE_RE.test(t)) {
    return true;
  }
  const bare = t.replace(/'[^']*'|"[^"]*"/g, '\'\'').replace(/\([^()]*\)/g, '()').replace(/\[[^\]]*\]/g, '[]');
  return /^(?:[.#[]|[a-z][a-z0-9-]*[.#[:])/i.test(bare) && !/\s/.test(bare);
}

/** A CSS selector when it looks like one, otherwise the accessible name or the visible text. */
function locate(page, target) {
  const t = String(target);
  if (isSelector(t)) {
    return page.locator(t);
  }
  // One bare word is a tag name OR the text a person sees: "main" is an element, "Uploading" is
  // words on the page (it was only ever read as a tag, so one-word waits never matched text).
  if (/^[a-z-]+$/i.test(t)) {
    return page.locator(t).or(page.getByRole('button', { name: t })).or(page.getByText(t, { exact: false }));
  }
  return page.getByRole('button', { name: t }).or(page.getByRole('link', { name: t })).or(page.getByText(t, { exact: false }));
}

/**
 * Where the page was when it was shot: path and query. A screenshot has no address bar, so a
 * criterion about the URL ("the query and filter live in the URL") could never be proven by one;
 * #131 went four attempts with that line unproven (2026-09-27). The caption says it instead.
 */
export function pageAt(page) {
  try {
    const u = new URL(page.url()); return `${u.pathname}${u.search}`;
  } catch {
    return '';
  }
}

/** A shot's caption note: what the engineer named it, then where the page was. */
export function shotNote(shot) {
  return [shot.label, shot.at ? `at ${shot.at}` : ''].filter(Boolean).join(' · ');
}

/** True when a path is the app's sign-in page, where an auth-gated path sends a signed-out visitor. */
export function isSignInPath(pathname) {
  return /sign-?in|login/.test(String(pathname || ''));
}

/** True when the page answered 404, or bounced to sign-in, so no honest before exists. */
function absentReason(response, page, path) {
  if (!response) {
    return 'the surface did not answer';
  }
  if (response.status() === 404) {
    return 'New surface, nothing to compare';
  }
  const landed = new URL(page.url()).pathname;
  if (landed !== new URL(path, 'https://x').pathname && isSignInPath(landed)) {
    return 'Production needs a signed in session, no before captured';
  }
  return '';
}

/**
 * AN ADDRESS BAR IN THE PICTURE. A screenshot is the viewport, so "the query and filter live in
 * the URL" could never be seen in one; QA asked for the address bar on #131 attempt 186 and left
 * the criterion open. Every shot now carries a strip with the page's own path and query, read
 * from the browser at the moment of the shot, removed right after.
 */
export const URL_BAR_ID = 'vocion-qa-url-bar';
// A shot is taken once the page has settled: network quiet, then a beat longer than a typical
// input debounce. On #131 attempt 187 one "URL state" shot caught skeleton rows mid-load and the
// other caught the URL a moment before the debounced ?q= write, and QA read both as proof.
export const SETTLE_MS = 800;
async function screenshotWithUrl(page, file) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await page.evaluate((id) => {
    const bar = document.createElement('div');
    bar.id = id;
    bar.textContent = `URL  ${location.pathname}${location.search}${location.hash}`;
    bar.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483647;height:22px;line-height:22px;padding:0 8px;font:12px ui-monospace,Menlo,monospace;background:#1f2937;color:#f9fafb;opacity:0.92;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
    document.documentElement.appendChild(bar);
  }, URL_BAR_ID).catch(() => {});
  try {
    await page.screenshot({ path: file, fullPage: false });
  } finally {
    await page.evaluate(id => document.getElementById(id)?.remove(), URL_BAR_ID).catch(() => {});
  }
}

/** The words the page shows a person, first `max` characters: what a reader of the shot needs to steer the next try. */
export async function pageText(page, max = 900) {
  try {
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    const text = await page.evaluate(() => document.body?.innerText || '');
    return String(text).replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, max);
  } catch {
    return '';
  }
}

/** The browser context options for one viewport: its size, scale and touch. */
export function viewportContextOptions(viewport) {
  const vp = VIEWPORTS[viewport];
  return { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch };
}

/**
 * Loads one flow at one viewport, runs its steps and shoots, or returns a reason it could not.
 * `record` turns on Playwright's video for this context; the webm lands in `outDir`. `context` is an open browser context
 * to use instead of a fresh one (the live check after a release passes one that is already signed
 * in, and it is left open for the next flow). `stopAtFailure` stops at the first failed step and
 * shoots where the page got, instead of trying the rest: on production a failed step means the
 * state is not there, and every later step would only wait out its own timeout.
 */
export async function shootFlow({ browser, base, flow, viewport, side, outDir, record = false, log = () => {}, context: given = null, stopAtFailure = false, errorPatterns = ERROR_STATE_PATTERNS, vars = {}, allow = null, withText = false, urlMoveTimeoutMs = URL_MOVE_TIMEOUT_MS, expectResponseTimeoutMs = EXPECT_RESPONSE_TIMEOUT_MS }) {
  const vp = VIEWPORTS[viewport];
  const context = given || await browser.newContext({
    ...viewportContextOptions(viewport),
    ...(record ? { recordVideo: { dir: outDir, size: { width: vp.width, height: vp.height } } } : {}),
  });
  const page = await context.newPage();
  const shots = [];
  // A step that fails means every shot after it shows the page short of the state the flow was
  // written to reach. It used to be one log line, and the at-rest picture went out as the proof.
  const stepFailures = [];
  const shortOf = () => (stepFailures.length ? stepFailureText(stepFailures[0]) : '');
  const shoot = async (label) => {
    const file = path.join(outDir, `${slug(flow.name)}-${viewport}-${side}-${slug(label, 24)}-${shots.length}.png`);
    await screenshotWithUrl(page, file);
    shots.push({ file, label, at: pageAt(page), errorState: await detectErrorState(page, errorPatterns), ...(shortOf() ? { shortOf: shortOf() } : {}), ...(withText ? { text: await pageText(page) } : {}) });
  };
  let absent = '';
  let video = null;
  // What production answered for the flow's page, so a live check can say "page not found".
  let httpStatus = null;
  // Every response the page received, for `expect_response`: method, address, status, kind. No body.
  const responses = [];
  page.on('response', (r) => {
    try {
      responses.push({ method: r.request().method(), url: r.url(), status: r.status(), type: r.request().resourceType() });
    } catch { /* a response the page dropped as it closed */ }
  });
  const proofs = [];
  try {
    const target = addressOf(base, fillVars(flow.path, vars));
    if (allow && !allow(target)) {
      throw new Error(`${new URL(target).origin} is not one of the product's own addresses, so it was not opened`);
    }
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    httpStatus = response ? response.status() : null;
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    if (side === 'before') {
      absent = absentReason(response, page, flow.path);
    }
    if (!absent) {
      // Where the flow opened, so `remember from url` can tell a page its steps moved to from the start.
      const flowCtx = { vars, allow, base, startUrl: page.url(), acted: false, urlMoveTimeoutMs, responses, proofs, expectResponseTimeoutMs };
      for (const [index, step] of flow.steps.entries()) {
        try {
          await runStep(page, step, shoot, flowCtx);
          if (step.upload || step.click || step.fill) {
            flowCtx.acted = true;
          }
        } catch (e) {
          const verb = Object.keys(step)[0];
          const failure = { index, verb, target: stepTarget(step), error: String(e.message || e).split('\n')[0].slice(0, 200) };
          stepFailures.push(failure);
          log('qa.step.failed', { flow: flow.name, viewport, side, step: verb, index, target: failure.target, error: String(e.message || e).slice(0, 200) });
          if (stopAtFailure) {
            break;
          }
        }
      }
      const file = path.join(outDir, `${slug(flow.name)}-${viewport}-${side}.png`);
      await screenshotWithUrl(page, file);
      shots.push({ file, label: '', at: pageAt(page), errorState: await detectErrorState(page, errorPatterns), ...(shortOf() ? { shortOf: shortOf() } : {}), ...(withText ? { text: await pageText(page) } : {}) });
    }
  } finally {
    video = record ? page.video() : null;
    if (given) {
      await page.close().catch(() => {});
    } else {
      await context.close();
    }
  }
  // The webm is written when the context closes; a video that never materialized is no video.
  const videoPath = video ? await video.path().catch(() => null) : null;
  return { shots, absent, stepFailures, videoPath, httpStatus, responses: proofs };
}

/** What a step pointed at, for a failure a person can read: the selector, the text, the file. */
export function stepTarget(step) {
  const v = step && Object.values(step)[0];
  if (v && typeof v === 'object') {
    return String(v.selector || v.path || '');
  }
  return String(v ?? '');
}

/** "step 2 (click "text=Remind") failed: <error>" */
export function stepFailureText(f) {
  return `step ${f.index + 1} (${f.verb}${f.target ? ` ${JSON.stringify(f.target).slice(0, 80)}` : ''}) failed${f.error ? `: ${f.error}` : ''}`;
}

/**
 * The first flow whose shot is byte-for-byte this one, or ''. Two criteria cannot be proven by
 * one picture: in #130 run 410 two criteria's screenshots were identical because both flows'
 * steps failed and both fell back to the page at rest. `seen` maps a sha256 to the flow that
 * shot it first; a flow never duplicates itself.
 */
export function duplicateOf(seen, hash, flowName) {
  const first = seen.get(hash);
  if (first && first !== flowName) {
    return first;
  }
  if (!first) {
    seen.set(hash, flowName);
  }
  return '';
}

// ---------- building the branch ----------

/**
 * Builds the surface the flows live on, with the command the contract's surface names. A flow that
 * needs a signed in account builds with the surface's `signed_in_env`, the repo's own preview mode
 * (an in-memory API, a sample account already signed in), so the after shot shows the page and no
 * credential exists anywhere to leak. `app` carries what serving needs: dist, port, spaFallback.
 */
export function buildSurface(repoDir, qa, run) {
  const surface = surfaceOf(qa);
  const build = surface.build;
  if (!build || !build.command || !build.dist) {
    return { ok: false, error: `the contract names no build for surface "${qa.surface}" (qa.surfaces.${qa.surface}.build: command and dist, from the repo record's surfaces)` };
  }
  const needsSignIn = qa.flows.some(f => f.sign_in);
  const signedIn = needsSignIn && build.signed_in_env && Object.keys(build.signed_in_env).length > 0;
  const env = { ...(build.env || {}), ...(signedIn ? build.signed_in_env : {}) };
  const r = run('sh', ['-c', build.command], { cwd: repoDir, env, timeoutSeconds: 1200 });
  const dist = path.join(repoDir, build.dist);
  const app = { dist: build.dist, port: Number(build.port) || 0, spaFallback: Boolean(build.spa_fallback) };
  if (r.code !== 0) {
    return { ok: false, error: `${build.command} failed (${r.code}): ${String(r.stderr || r.stdout).trim().slice(-600)}` };
  }
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    return { ok: false, error: `${build.dist}/index.html is missing after the build` };
  }
  return { ok: true, dist, app, mock: Boolean(signedIn) };
}

// ---------- uploading and publishing ----------

/** PUT the bytes, then presign a GET that lasts seven days. Returns the url, or throws. */
export async function uploadEvidence({ bucket, region, key, body, contentType, credentials, presign }) {
  const { url, headers } = signPut({ bucket, key, region, body, contentType, credentials });
  const res = await fetch(url, { method: 'PUT', headers, body, signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    throw new Error(`s3 PUT ${key} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  if (!presign?.accessKeyId) {
    throw new Error('no presign keys in the environment; the object is stored but cannot be linked');
  }
  return presignGet({ bucket, key, region, accessKeyId: presign.accessKeyId, secretAccessKey: presign.secretAccessKey, contentType });
}

/**
 * Posts one artifact. Vocion has no artifact write route today (POST /api/v1/artifacts answers
 * 404 in production on 2026-09-21), so this is written to the shape the feature report reads and
 * degrades to a named refusal rather than a throw. The urls reach the task record either way.
 */
export async function publishArtifact(post, body) {
  try {
    const r = await post('/artifacts', body);
    if (r.ok) {
      return { ok: true, id: r.json?.artifact?.id ?? r.json?.id ?? null };
    }
    return { ok: false, status: r.status, error: r.status === 404 ? 'Vocion has no POST /api/v1/artifacts route yet' : String(r.json?.error || r.json?.raw || '').slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e).slice(0, 200) };
  }
}

// ---------- the pass ----------

/**
 * The whole capture: build, serve, shoot before and after for every flow and viewport, upload,
 * publish. Never throws. Returns what was captured, what was not and why, and the report markdown.
 *
 * `run` is the worker's spawnSync wrapper, `log` its JSON logger, `post` its Vocion POST.
 */
export async function captureEvidence({ qa, taskId, runId, recordId, repoDir, outDir, aws, run, log, post, artifactUrl, refusedFlows = [] }) {
  const started = Date.now();
  const rows = [];
  const failures = [];
  const evidence = [];
  // sha256 of each after shot -> the flow that took it first (see duplicateOf).
  const seenShots = new Map();
  // A flow the engineer wrote that the worker refused is a named failure in the report, not a gap.
  for (const m of refusedFlows) {
    failures.push({ scope: 'engineer flow refused', message: m });
  }
  // Declared before the first shot: `record` runs inside `shoot`, which is called before the
  // line this used to sit on, so every capture died on "Cannot access 'seq' before initialization".
  let seq = 0;
  let bytes = 0;
  let videoSeconds = 0;
  const base = productionBase(qa);
  const surface = surfaceOf(qa);
  const errorPatterns = errorPatternsFor(surface);
  const fallbacks = listRoutesFor(surface);
  fs.mkdirSync(outDir, { recursive: true });

  let playwright;
  try {
    playwright = await import('playwright');
  } catch (e) {
    failures.push({ scope: 'playwright', message: `playwright is not in this image: ${String(e.message || e).slice(0, 200)}` });
    return finish();
  }

  let credentials = null;
  try {
    credentials = await containerCredentials();
  } catch (e) {
    failures.push({ scope: 'aws', message: `no task credentials: ${String(e.message || e).slice(0, 160)}` });
  }
  const canUpload = Boolean(credentials && aws.bucket && aws.presign?.accessKeyId);
  // No bucket is not a failure: the shots go into Vocion itself, inline on the artifact.
  if (!canUpload && aws.bucket) {
    failures.push({ scope: 'aws', message: `cannot store evidence in ${aws.bucket}: ${!credentials ? 'no task role credentials' : ''}${!aws.presign?.accessKeyId ? ' no presign keys (PRESIGN_ACCESS_KEY_ID)' : ''}`.trim() });
  }

  const built = buildSurface(repoDir, qa, run);
  if (!built.ok) {
    failures.push({ scope: 'build', message: built.error });
  }
  log('qa.built', { ok: built.ok, surface: qa.surface, mock: built.mock || false, dist: built.dist ? path.relative(repoDir, built.dist) : null });

  let server = null;
  let afterBase = '';
  if (built.ok) {
    try {
      server = await serveDist(built.dist, built.app.port, built.app);
      afterBase = `http://127.0.0.1:${server.address().port}`;
    } catch (e) {
      failures.push({ scope: 'serve', message: `could not serve ${built.app.dist}: ${String(e.message || e).slice(0, 200)}` });
    }
  }

  const browser = await playwright.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch((e) => {
    failures.push({ scope: 'playwright', message: `chromium did not start: ${String(e.message || e).slice(0, 200)}` });
    return null;
  });

  // A flow whose path names a placeholder ([id], :id, {id}) is resolved to a real record from the
  // app just built and served, once, before its first navigation, and the same path is then used
  // for both the before and the after shot (see "route placeholders" above). A flow nothing could
  // resolve is never shot: it would only repeat the same "could not load" screenshot on every
  // viewport and side.
  const unresolvable = new Map();
  if (browser) {
    if (afterBase) {
      const resolveContext = await browser.newContext();
      const resolvePage = await resolveContext.newPage();
      for (const flow of qa.flows) {
        if (!hasPlaceholder(flow.path)) {
          continue;
        }
        const originalPath = flow.path;
        const result = await resolveRoutePlaceholders({ page: resolvePage, base: afterBase, path: flow.path, log, fallbacks }).catch(e => ({ ok: false, unresolved: findPlaceholder(flow.path), error: e }));
        if (result.ok) {
          flow.path = result.path;
        } else {
          const segment = result.unresolved?.segments?.[result.unresolved.index] || '(unknown)';
          const message = `qa.flows["${flow.name}"].path names ${segment}, which no record under ${result.unresolved?.prefix || '?'} (nor ${fallbacks.join(', ')}) resolved to`;
          unresolvable.set(flow, message);
          log('qa.path.unresolved', { flow: flow.name, path: originalPath, placeholder: segment });
        }
      }
      await resolvePage.close().catch(() => {});
      await resolveContext.close().catch(() => {});
    } else {
      for (const flow of qa.flows) {
        if (!hasPlaceholder(flow.path)) {
          continue;
        }
        const found = findPlaceholder(flow.path);
        unresolvable.set(flow, `qa.flows["${flow.name}"].path names ${found.segments[found.index]}, but the branch could not be built and served, so no record could be resolved`);
      }
    }

    for (const flow of qa.flows) {
      const refusal = unresolvable.get(flow);
      if (refusal) {
        failures.push({ scope: `${flow.name}/path`, message: refusal });
        for (const viewport of flow.viewports) {
          if (!VIEWPORTS[viewport]) {
            continue;
          }
          await record(flow, viewport, 'before', null, refusal);
          await record(flow, viewport, 'after', null, refusal);
        }
        continue;
      }
      for (const viewport of flow.viewports) {
        if (!VIEWPORTS[viewport]) {
          continue;
        }
        // before
        if (flow.before === 'none') {
          await record(flow, viewport, 'before', null, 'New surface, nothing to compare');
        } else if (!base) {
          await record(flow, viewport, 'before', null, `no live URL is recorded for surface "${qa.surface}"`);
        } else {
          await one({ base, flow, viewport, side: 'before', record: false });
        }
        // after
        if (afterBase) {
          const t0 = Date.now();
          const r = await one({ base: afterBase, flow, viewport, side: 'after', record: Boolean(qa.video) });
          if (qa.video && r?.videoPath) {
            videoSeconds += Math.round((Date.now() - t0) / 1000);
            await storeVideo(flow, viewport, r.videoPath, Math.round((Date.now() - t0) / 1000));
          }
        } else {
          await record(flow, viewport, 'after', null, 'the branch could not be built and served in this container');
        }
      }
    }
    await browser.close().catch(() => {});
  }
  if (server) {
    await new Promise(r => server.close(r));
  }

  return finish();

  async function one({ base: b, flow, viewport, side, record: rec }) {
    try {
      const r = await shootFlow({ browser, base: b, flow, viewport, side, outDir, record: rec, log, errorPatterns });
      if (r.absent) {
        await record(flow, viewport, side, null, r.absent); return r;
      }
      // Only the after side proves a criterion; a before step that fails on production is the
      // feature not being there yet.
      if (side === 'after' && r.stepFailures?.length) {
        failures.push({ scope: `${flow.name}/${viewport}/${side}`, message: `${r.stepFailures.map(stepFailureText).join('; ')}. The shot shows the page short of the state this flow was written to reach, so it is not evidence for its criterion` });
      }
      for (const shot of r.shots) {
        await record(flow, viewport, side, shot.file, shotNote(shot), shot.errorState, side === 'after' && shot.shortOf ? `not the state: ${shot.shortOf}` : '');
      }
      return r;
    } catch (e) {
      const message = String(e.message || e).slice(0, 300);
      failures.push({ scope: `${flow.name}/${viewport}/${side}`, message });
      await record(flow, viewport, side, null, `capture failed: ${message}`);
      return null;
    }
  }

  async function record(flow, viewport, side, file, note, errorState = false, notEvidence = '') {
    let url = '';
    seq += 1;
    let dup = '';
    if (file && side === 'after' && fs.existsSync(file)) {
      dup = duplicateOf(seenShots, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), flow.name);
      if (dup) {
        notEvidence = notEvidence || `duplicate of ${dup}`;
        if (!notEvidence.includes('duplicate of')) {
          notEvidence = `${notEvidence}; duplicate of ${dup}`;
        }
        failures.push({ scope: `${flow.name}/${viewport}/${side}`, message: `duplicate of ${dup}: byte-for-byte the same picture, so it is not evidence for this flow's criterion` });
        log('qa.shot.duplicate', { flow: flow.name, viewport, side, duplicate_of: dup });
      }
    }
    if (notEvidence) {
      note = [note, notEvidence].filter(Boolean).join(' · ');
    }
    if (file && canUpload) {
      try {
        const body = fs.readFileSync(file);
        bytes += body.length;
        // A `shoot` step carries its label into the key, and a sequence with it so two labels that
        // slug the same never share one. The flow's own final shot keeps the plain name.
        const key = evidenceKey(taskId, runId, note ? `${flow.name} ${note} ${seq}` : flow.name, viewport, side, 'png');
        url = await uploadEvidence({ bucket: aws.bucket, region: aws.region, key, body, contentType: 'image/png', credentials, presign: aws.presign });
      } catch (e) {
        failures.push({ scope: `upload ${flow.name}/${viewport}/${side}`, message: String(e.message || e).slice(0, 250) });
      }
    } else if (file && !canUpload && post && recordId) {
      // NO BUCKET, STILL EVIDENCE (2026-09-26): a worker with no S3 keys (a laptop, a new
      // account) stores the shot in Vocion itself, inline on the artifact, so the task's
      // evidence is a picture a reviewer can see instead of "captured but not stored".
      const body = fs.readFileSync(file);
      bytes += body.length;
      url = `data:image/png;base64,${body.toString('base64')}`;
    } else if (file && !canUpload) {
      note = note || 'captured but not stored: the container could not reach the evidence bucket';
    }
    const inline = url.startsWith('data:');
    // A shot of the app's own error state ("Could not load...", "...does not exist") is named as
    // one: a reviewer or QA reading the caption must never mistake a broken record id for the
    // feature under test.
    const shownNote = (note || (url ? (inline ? 'captured, stored in Vocion' : 'captured') : 'not captured')) + (errorState ? ' (app error state)' : '');
    rows.push({ flow: flow.name, viewport, side, url: inline ? '' : url, note: shownNote, error_state: errorState || undefined, duplicate_of: dup || undefined, not_evidence: notEvidence || undefined });
    const body = screenshotArtifact({ recordId, flowName: flow.name, viewport, side, url, note: url ? shownNote : (shownNote || 'not captured'), bytes: file && fs.existsSync(file) ? fs.statSync(file).size : 0, filename: file ? path.basename(file) : '' });
    let artifactId = null;
    if (post && recordId) {
      const r = await publishArtifact(post, body); if (!r.ok) {
        noteRefusal(r);
      } else {
        artifactId = r.id;
      }
    }
    // The task record keeps a reference, never the inline image.
    evidence.push({ role: 'qa-screenshot', flow: flow.name, viewport, side, url: inline ? (artifactId ? (artifactUrl ? artifactUrl(artifactId) : `vocion:artifact:${artifactId}`) : '') : url, caption: body.spec.caption, error_state: errorState || undefined, ...(dup ? { duplicate_of: dup } : {}), ...(notEvidence ? { not_evidence: notEvidence } : {}), ...(flow.criterion ? { criterion: flow.criterion } : {}), ...(artifactId ? { artifactId } : {}) });
  }

  async function storeVideo(flow, viewport, file, seconds) {
    try {
      const body = fs.readFileSync(file);
      bytes += body.length;
      if (!canUpload) {
        throw new Error('the container could not reach the evidence bucket');
      }
      const key = evidenceKey(taskId, runId, flow.name, viewport, 'after', 'webm');
      const url = await uploadEvidence({ bucket: aws.bucket, region: aws.region, key, body, contentType: 'video/webm', credentials, presign: aws.presign });
      rows.push({ flow: flow.name, viewport, side: 'after video', url, note: `${seconds}s, ${Math.round(body.length / 1024)} KB` });
      const artifactBody = videoArtifact({ recordId, flowName: flow.name, viewport, url, seconds, bytes: body.length, filename: path.basename(file) });
      evidence.push({ role: 'qa-video', flow: flow.name, viewport, side: 'after', url, caption: artifactBody.spec.caption });
      if (post && recordId) {
        const r = await publishArtifact(post, artifactBody); if (!r.ok) {
          noteRefusal(r);
        }
      }
    } catch (e) {
      failures.push({ scope: `video ${flow.name}/${viewport}`, message: String(e.message || e).slice(0, 250) });
    }
  }

  function noteRefusal(r) {
    const message = `${r.error} (${r.status})`;
    if (!failures.some(f => f.scope === 'artifacts' && f.message === message)) {
      failures.push({ scope: 'artifacts', message });
    }
  }

  async function finish() {
    const elapsedS = Math.round((Date.now() - started) / 1000);
    const markdown = qaReportMarkdown({ taskId, runId, base, qa, rows, failures, elapsedS, bytes, videoSeconds });
    const shots = rows.filter(r => r.url).length;
    const notEvidence = rows.filter(r => r.not_evidence).length;
    const summary = `${shots} of ${rows.length} shots stored, ${failures.length} problem${failures.length === 1 ? '' : 's'}${notEvidence ? `, ${notEvidence} shot${notEvidence === 1 ? '' : 's'} not evidence (a failed step or a duplicate)` : ''}`;
    let reportPublished = false;
    if (post && recordId) {
      const r = await publishArtifact(post, reportArtifact({ recordId, taskId, markdown, summary }));
      reportPublished = r.ok;
      if (!r.ok) {
        noteRefusal(r);
      }
    }
    fs.writeFileSync(path.join(outDir, 'qa-report.md'), markdown);
    return { captured: shots > 0, shots, rows, failures, evidence, markdown, summary, elapsedS, bytes, videoSeconds, reportPublished, base };
  }
}
