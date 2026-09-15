'use client';

import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { recordRef } from '@/services/chat/recordContext';
import { isActionSection, splitSections } from './briefingSectionsModel';
import { AskAboutThis } from './context/AskAboutThis';

/**
 * A briefing rendered section by section, with the brief → action loop wired
 * in (R4). Every `##` heading gets an "Ask about this"; inside sections that
 * hold work for a person (needs you / moves / actions / at-risk / close this
 * week / not in HubSpot) each bullet gets a "Do this" that opens the agent
 * surface with the bullet as the prompt and the briefing as the record — so
 * reading the brief and working the pipeline are one motion.
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
      {sections.map((sec, i) => {
        const actionable = sec.heading ? isActionSection(sec.heading) : false;
        return (
          <section key={i} data-briefing-section={sec.heading ? slug(sec.heading) : 'preamble'}>
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
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={actionable
                ? {
                    li: ({ children, ...rest }) => (
                      <li {...rest}>
                        <span className="group/bullet inline">
                          {children}
                          <DoThis record={record} agentSlug={props.agentSlug} fallbackContext={props.content} text={textOf(children)} />
                        </span>
                      </li>
                    ),
                  }
                : undefined}
            >
              {sec.body}
            </Markdown>
          </section>
        );
      })}
    </>
  );
}

function DoThis(props: { record: ReturnType<typeof recordRef>; agentSlug?: string; fallbackContext: string; text: string }) {
  if (!props.text.trim()) {
    return null;
  }
  return (
    <AskAboutThis
      record={props.record}
      variant="button"
      label="Do this"
      prompt={`Do this: ${props.text.trim()}`}
      send
      agentSlug={props.agentSlug}
      fallbackContext={props.fallbackContext}
      className="ml-2 px-2 py-0.5 align-middle text-[11px] opacity-60 group-hover/bullet:opacity-100"
    />
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

/**
 * Plain text of a bullet's children, for the prompt — bold/links flattened, nested lists dropped.
 * @param node
 */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (typeof node === 'object' && 'props' in node) {
    const el = node as { type?: unknown; props: { children?: ReactNode } };
    if (el.type === 'ul' || el.type === 'ol') {
      return '';
    }
    return textOf(el.props.children);
  }
  return '';
}
