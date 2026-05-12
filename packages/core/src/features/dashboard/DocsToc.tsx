'use client';

import { useEffect, useState } from 'react';

/**
 * DocsToc — sticky right-rail table of contents for the docs viewer.
 *
 * Walks the rendered `<article>` for H2/H3 headings (matched by id,
 * which rehype-slug attaches), renders a vertical link list, and
 * highlights the entry whose heading is currently scrolled into view
 * via IntersectionObserver.
 *
 * Hidden below `lg:` breakpoint — the mobile/tablet experience uses
 * a separate collapsible "On this page" element rendered inline at
 * the top of the article.
 */

type Heading = { id: string; text: string; level: 2 | 3 };

export function DocsToc() {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const article = document.querySelector('article');
    if (!article) {
      return;
    }
    const nodes = Array.from(article.querySelectorAll('h2[id], h3[id]')) as HTMLHeadingElement[];
    setHeadings(nodes.map(h => ({
      id: h.id,
      text: h.innerText,
      level: (h.tagName === 'H2' ? 2 : 3) as 2 | 3,
    })));

    if (nodes.length === 0) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveId(entry.target.id);
        }
      }
    }, {
      rootMargin: '-80px 0px -70% 0px',
      threshold: [0, 1],
    });

    for (const h of nodes) {
      observer.observe(h);
    }
    return () => observer.disconnect();
  }, []);

  if (headings.length === 0) {
    return null;
  }

  return (
    <nav className="hidden text-sm lg:block" aria-label="On this page">
      <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        On this page
      </div>
      <ul className="space-y-1.5 border-l border-border">
        {headings.map(h => (
          <li key={h.id} className={h.level === 3 ? 'pl-6' : 'pl-3'}>
            <a
              href={`#${h.id}`}
              className={`-ml-px block border-l py-0.5 transition-colors ${
                activeId === h.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
