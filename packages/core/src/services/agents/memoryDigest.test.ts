/**
 * The digest middleware is the guarantee that approved rules are APPLIED, not
 * merely mounted. Worth pinning: which files count as memory, the injection
 * into the system message, the no-op when nothing is mounted (so every agent
 * can carry the middleware unconditionally), and the gate-safe guidance (the
 * text must never tell the model to edit memory files itself).
 */
import { SystemMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { createMemoryDigestMiddleware, memoryMountPaths, renderMemoryDigest } from './memoryDigest';

const fileData = (content: string) => ({
  content,
  mimeType: 'text/markdown',
  created_at: new Date().toISOString(),
  modified_at: new Date().toISOString(),
});

describe('renderMemoryDigest', () => {
  it('includes /learnings/ and /memories/ files, skips everything else', () => {
    const digest = renderMemoryDigest({
      '/learnings/global.md': fileData('# Global learnings\nNever invent numbers.'),
      '/memories/agents/lead/procedures/r1.md': fileData('Cite the contact brief.'),
      '/playbooks/voice/SKILL.md': fileData('should not appear'),
      '/scratch/notes.md': fileData('should not appear'),
    });

    expect(digest).toContain('Never invent numbers.');
    expect(digest).toContain('Cite the contact brief.');
    expect(digest).toContain('### /learnings/global.md');
    expect(digest).not.toContain('should not appear');
  });

  it('returns null when nothing memory-like is mounted', () => {
    expect(renderMemoryDigest(undefined)).toBeNull();
    expect(renderMemoryDigest({})).toBeNull();
    expect(renderMemoryDigest({ '/playbooks/x.md': fileData('nope') })).toBeNull();
    expect(renderMemoryDigest({ '/learnings/empty.md': fileData('   ') })).toBeNull();
  });

  it('drops whole files past the budget and says how many', () => {
    const big = 'x'.repeat(30_000);
    const digest = renderMemoryDigest({
      '/learnings/a.md': fileData('short rule'),
      '/learnings/b.md': fileData(big),
    });

    expect(digest).toContain('short rule');
    expect(digest).not.toContain(big);
    expect(digest).toContain('1 more memory file(s) omitted');
  });

  it('reads bare-string file entries too (loop-B payload shape)', () => {
    expect(renderMemoryDigest({ '/learnings/g.md': 'plain string rule' })).toContain('plain string rule');
  });
});

describe('memoryMountPaths', () => {
  it('lists only memory paths, sorted', () => {
    expect(memoryMountPaths({
      '/learnings/b.md': fileData('x'),
      '/learnings/a.md': fileData('x'),
      '/skills/s/SKILL.md': fileData('x'),
    })).toEqual(['/learnings/a.md', '/learnings/b.md']);
  });
});

describe('createMemoryDigestMiddleware', () => {
  const middleware = createMemoryDigestMiddleware() as unknown as {
    wrapModelCall: (request: unknown, handler: (request: unknown) => unknown) => unknown;
  };

  it('appends the digest to the system message and keeps the base prompt', async () => {
    let seen: { systemMessage: SystemMessage } | undefined;
    await middleware.wrapModelCall(
      {
        state: { files: { '/learnings/global.md': fileData('Never invent numbers.') } },
        systemMessage: new SystemMessage('You are the revenue lead.'),
      },
      (request) => {
        seen = request as { systemMessage: SystemMessage };
        return 'ok';
      },
    );

    const text = JSON.stringify(seen!.systemMessage.content);

    expect(text).toContain('You are the revenue lead.');
    expect(text).toContain('<approved_learnings>');
    expect(text).toContain('Never invent numbers.');
    // Gate-safe: the guidance must never invite the model to write memory
    // files itself — approval is the only write path.
    expect(text).not.toContain('edit_file');
    expect(text).toContain('approval is the only write path');
  });

  it('passes the request through untouched when nothing is mounted', async () => {
    const request = { state: { files: {} }, systemMessage: new SystemMessage('base') };
    let seen: unknown;
    await middleware.wrapModelCall(request, (r) => {
      seen = r;
      return 'ok';
    });

    expect(seen).toBe(request);
  });
});
