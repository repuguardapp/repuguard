import type { ReactNode } from 'react';

/**
 * Serialise a JSON-LD graph for a <script> tag.
 *
 * `JSON.stringify` escapes nothing that matters inside HTML. A value
 * containing `</script>` closes the tag early and everything after it
 * is parsed as markup — the oldest injection in the book, and the one
 * that `dangerouslySetInnerHTML` is named after.
 *
 * Nothing user-controlled reaches our four JSON-LD blocks today: they
 * are built from FRAMEWORKS, from the message catalogue and from
 * locale codes. But the decisions corpus is model-written prose about
 * named companies, it is one obvious edit away from wanting a
 * NewsArticle graph, and the person making that edit will not think
 * about this. Escaping at the serialiser means they do not have to.
 *
 * `<` is enough: it cannot appear in the JSON output except inside a
 * string, and < is the same character to any JSON parser.
 */
export function jsonLdScript(graph: unknown): { __html: string } {
  return { __html: JSON.stringify(graph).replace(/</g, '\\u003c') };
}

/** Kept so the module's only export shape is obvious to a reader. */
export type JsonLdProps = { children?: ReactNode };
