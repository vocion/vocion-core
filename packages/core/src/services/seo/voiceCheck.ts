/**
 * The client voice, checked in code before a person sees a draft: a word the
 * client never uses, or a word that would make a claim they may not make, is
 * found in the text rather than left to the editor's reading. The editor still
 * reads for everything a list cannot catch (tone, point of view); this is the
 * part that never needs a model.
 *
 * The lines come from the project's voice block (`ClientVoice`), each one
 * sourced, so a finding quotes the line and where the client said it.
 */

import type { ClientVoice, VoiceLine } from '@/services/DataRoomService';
import type { SeoPageRecord } from '@/services/seo/records';

export type VoiceFinding = {
  kind: 'banned' | 'never-claim';
  /** The words found. */
  phrase: string;
  /** The voice line they break, with its source. */
  line: VoiceLine;
  /** The draft around the first place they appear. */
  excerpt: string;
  /** How many times they appear. */
  count: number;
};

/**
 * Text as it is compared: curly quotes straightened, so "don’t" in a draft
 * matches "don't" in a guide.
 * @param s - The text.
 */
function plain(s: string): string {
  return s.replace(/[‘’]/g, '\'').replace(/[“”]/g, '"');
}

/**
 * A phrase as a whole-word, case-blind pattern: "cheap" finds "Cheap" and
 * "cheap," but not "cheapest" — the client banned the word, not every word
 * that starts with it.
 * @param phrase - The words.
 */
function phrasePattern(phrase: string): RegExp {
  const body = plain(phrase).trim().replace(/^["']+|["']+$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * Every banned phrase and never-claim word the text carries. Pure.
 * @param text - The draft.
 * @param voice - The project's voice block.
 */
export function checkVoice(text: string, voice: ClientVoice | undefined): VoiceFinding[] {
  if (!voice || !text.trim()) {
    return [];
  }
  const body = plain(text);
  const findings: VoiceFinding[] = [];
  const look = (kind: VoiceFinding['kind'], phrase: string, line: VoiceLine) => {
    if (phrase.trim().length < 2) {
      return;
    }
    const matches = [...body.matchAll(phrasePattern(phrase))];
    if (matches.length === 0) {
      return;
    }
    const at = matches[0]!.index ?? 0;
    const from = Math.max(0, at - 50);
    const to = Math.min(body.length, at + matches[0]![0].length + 50);
    const excerpt = `${from > 0 ? '…' : ''}${body.slice(from, to).replace(/\s+/g, ' ').trim()}${to < body.length ? '…' : ''}`;
    findings.push({ kind, phrase: matches[0]![0], line, excerpt, count: matches.length });
  };
  for (const line of voice.bannedPhrases ?? []) {
    look('banned', line.text, line);
  }
  for (const line of voice.neverClaim ?? []) {
    for (const phrase of line.phrases ?? []) {
      look('never-claim', phrase, line);
    }
  }
  return findings;
}

/**
 * The findings, as the editor's tool says them: each quoting the words, the
 * line they break and where the client said it.
 * @param findings - From `checkVoice`.
 */
export function describeVoiceFindings(findings: readonly VoiceFinding[]): string {
  return findings.map((f, i) => f.kind === 'banned'
    ? `${i + 1}. Uses "${f.phrase}"${f.count > 1 ? ` (${f.count} times)` : ''}, which the client never uses (${f.line.source}): "${f.excerpt}"`
    : `${i + 1}. "${f.phrase}"${f.count > 1 ? ` (${f.count} times)` : ''} makes a claim the client may not make — "${f.line.text}" (${f.line.source}): "${f.excerpt}"`).join('\n');
}

/**
 * The voice findings on a page's current draft, read from its project.
 * Empty when the page has no draft, the project no voice, or nothing breaks it.
 * @param orgId - The workspace.
 * @param page - The page.
 */
export async function draftVoiceFindings(orgId: string, page: SeoPageRecord): Promise<VoiceFinding[]> {
  if (!page.meta.draftArtifactId) {
    return [];
  }
  const [{ getArtifact }, { artifactText, getProject }] = await Promise.all([import('@/services/ArtifactService'), import('@/services/DataRoomService')]);
  const [draft, project] = await Promise.all([getArtifact({ orgId, id: page.meta.draftArtifactId }), getProject(orgId, page.meta.projectId)]);
  return draft && project ? checkVoice(artifactText(draft), project.meta.voice) : [];
}
