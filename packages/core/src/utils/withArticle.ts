/**
 * A noun with the right indefinite article in front, or none where an article
 * would read wrongly. "Project keys" asks for several, so "a project keys" is
 * not English; "an API key" and "an AWS region" need "an" rather than "a".
 * Kept free of imports so client components and server tools can share it.
 * @param noun - The noun as it should appear after the article.
 */
export function withArticle(noun: string): string {
  if (noun.endsWith('s') && !noun.endsWith('ss')) {
    return noun;
  }
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}
