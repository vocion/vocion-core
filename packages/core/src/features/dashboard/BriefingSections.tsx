'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { recordRef } from '@/services/chat/recordContext';
import { splitSections } from './briefingSectionsModel';
import { AskAboutThis } from './context/AskAboutThis';

/**
 * A pre-v2 briefing — markdown, rendered section by section. Every brief
 * published before `docs/specs/briefing-v2.md` reads through here; a brief
 * with a typed document renders through `briefings/BriefingView`.
 *
 * Every `##` heading gets an "Ask about this". Bullets no longer do.
 *
 * They used to: each bullet in a "needs you" section carried a **Do this**
 * chip that opened the conversation with the bullet's own text as the
 * message. Chris, 2026-09-16, clicked one beside "4 learning candidates to
 * adopt or reject" and watched the composer send exactly that back as a chat
 * message. It was a prompt pretending to be an action — the work still had to
 * be done afterwards, somewhere else. The typed briefing routes every
 * actionable item to the surface that does the thing instead; a markdown
 * brief cannot know where its bullets route, so it offers no action at all
 * rather than a fake one. "Ask about this" remains, as what it always was: a
 * way to ask, not a way to act.
 *
 * Split is on `## ` at line start; the preamble before the first heading is
 * rendered as-is. Markdown inside each section is untouched.
 * @param props
 * @param props.briefingId
 * @param props.briefingTitle
 * @param props.content
 * @param props.agentSlug
 */
export function BriefingSections(props: { briefingId: number; briefingTitle: string; content: string; agentSlug?: string }) {
  const record = recordRef('briefing', props.briefingId, props.briefingTitle);
  const sections = splitSections(props.content);

  return (
    <>
      {sections.map(sec => (
        <section key={sec.heading ?? '__preamble__'} data-briefing-section={sec.heading ? slug(sec.heading) : 'preamble'}>
          {sec.heading && (
            <div className="not-prose mt-6 mb-2 flex flex-wrap items-baseline justify-between gap-2 first:mt-0">
              <h2 className="text-base font-semibold tracking-tight">{sec.heading}</h2>
              <AskAboutThis
                record={record}
                variant="icon"
                label={`Ask about “${sec.heading}”`}
                prompt={`About the "${sec.heading}" section of this brief: `}
                agentSlug={props.agentSlug}
                fallbackContext={props.content}
              />
            </div>
          )}
          <Markdown remarkPlugins={[remarkGfm]}>{sec.body}</Markdown>
        </section>
      ))}
    </>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}
