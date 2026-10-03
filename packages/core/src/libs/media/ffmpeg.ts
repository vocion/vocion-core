/**
 * FFMPEG, AS THIS BUILD HAS IT: whether it is installed, what it can encode
 * and filter, how long and how large a video is, and one way to run it.
 *
 * The app image installs Alpine's `ffmpeg` (packages/core/Dockerfile); a dev
 * machine has whatever is on its PATH. `VOCION_FFMPEG` / `VOCION_FFPROBE`
 * name other binaries. Nothing here throws on a missing binary: a caller asks
 * {@link ffmpegCapabilities} first and refuses in words when it is absent.
 */

import type { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import process from 'node:process';

export function ffmpegBin(): string {
  return process.env.VOCION_FFMPEG?.trim() || 'ffmpeg';
}

export function ffprobeBin(): string {
  return process.env.VOCION_FFPROBE?.trim() || 'ffprobe';
}

export type RunResult = { code: number | null; stdout: string; stderr: string; error: string | null };

/**
 * Run a binary to completion, capturing its output (the tail of stderr, which
 * is where ffmpeg says what went wrong). Never throws.
 * @param bin - The binary.
 * @param args - Its arguments (no shell).
 * @param timeoutMs - Killed after this long.
 */
export function run(bin: string, args: readonly string[], timeoutMs = 120_000): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (r: RunResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      done({ code: null, stdout, stderr, error: (err as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ code: null, stdout, stderr, error: `${bin} did not finish within ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      stdout = (stdout + d.toString()).slice(-200_000);
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-20_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, error: null });
    });
  });
}

export type FfmpegCapabilities = {
  available: boolean;
  /** Why it is not, when it is not. */
  reason: string | null;
  encoders: Set<string>;
  filters: Set<string>;
};

let cached: Promise<FfmpegCapabilities> | null = null;

/**
 * Names from `ffmpeg -encoders` / `-filters` output: the second column of each
 * listing row.
 * @param listing - The command's stdout.
 */
export function listedNames(listing: string): Set<string> {
  const out = new Set<string>();
  for (const line of listing.split('\n')) {
    const m = /^\s*[A-Z.|]{2,8}\s+(\S+)\s/.exec(line);
    if (m?.[1] && m[1] !== '=') {
      out.add(m[1]);
    }
  }
  return out;
}

/**
 * What the installed ffmpeg can do, read once per process.
 * @param fresh - Read again (tests).
 */
export function ffmpegCapabilities(fresh = false): Promise<FfmpegCapabilities> {
  if (!cached || fresh) {
    cached = (async () => {
      const version = await run(ffmpegBin(), ['-hide_banner', '-version'], 15_000);
      if (version.code !== 0) {
        return { available: false, reason: `ffmpeg is not installed on this installation (${version.error ?? `exit ${version.code}`})`, encoders: new Set<string>(), filters: new Set<string>() };
      }
      const probe = await run(ffprobeBin(), ['-hide_banner', '-version'], 15_000);
      if (probe.code !== 0) {
        return { available: false, reason: `ffprobe is not installed on this installation (${probe.error ?? `exit ${probe.code}`})`, encoders: new Set<string>(), filters: new Set<string>() };
      }
      const [enc, fil] = await Promise.all([
        run(ffmpegBin(), ['-hide_banner', '-encoders'], 15_000),
        run(ffmpegBin(), ['-hide_banner', '-filters'], 15_000),
      ]);
      return { available: true, reason: null, encoders: listedNames(enc.stdout), filters: listedNames(fil.stdout) };
    })();
  }
  return cached;
}

/**
 * `HH:MM:SS.xx` → milliseconds.
 * @param s - The timestamp.
 */
export function clockMs(s: string): number | null {
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s.trim());
  return m ? Math.round(((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000) : null;
}

export type ProbedVideo = { width: number; height: number; durationMs: number };

/**
 * A video's size and length. A browser recording (Playwright's WebM) often
 * carries no duration in its header, so when ffprobe reads none the file is
 * decoded once to the end and the last timestamp is the length.
 * @param file - The video on disk.
 */
export async function probeVideo(file: string): Promise<ProbedVideo | { error: string }> {
  const res = await run(ffprobeBin(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], 30_000);
  if (res.code !== 0) {
    return { error: `the recording could not be read (${(res.stderr.trim().split('\n').pop() ?? res.error ?? '').slice(0, 200)})` };
  }
  let width = 0;
  let height = 0;
  let durationMs: number | null = null;
  try {
    const j = JSON.parse(res.stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
    width = Number(j.streams?.[0]?.width) || 0;
    height = Number(j.streams?.[0]?.height) || 0;
    const d = Number(j.format?.duration);
    durationMs = Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null;
  } catch { /* fall through */ }
  if (!width || !height) {
    return { error: 'the recording has no video stream.' };
  }
  if (durationMs === null) {
    const decoded = await run(ffmpegBin(), ['-hide_banner', '-nostats', '-i', file, '-map', '0:v:0', '-f', 'null', '-progress', 'pipe:1', '-'], 120_000);
    const times = [...decoded.stdout.matchAll(/out_time=(\d+:\d{2}:\d{2}(?:\.\d+)?)/g)].map(m => clockMs(m[1]!)).filter((x): x is number => x !== null && x > 0);
    durationMs = times.length > 0 ? Math.max(...times) : null;
  }
  if (!durationMs) {
    return { error: 'the recording\'s length could not be read.' };
  }
  return { width, height, durationMs };
}

/**
 * An audio file's length in milliseconds, or null.
 * @param file - The audio on disk.
 */
export async function probeAudioMs(file: string): Promise<number | null> {
  const res = await run(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], 15_000);
  const d = Number(res.stdout.trim());
  return res.code === 0 && Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null;
}
