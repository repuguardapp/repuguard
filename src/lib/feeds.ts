/**
 * Minimal RSS / Atom item extraction.
 *
 * Written here rather than pulled from npm on purpose. The job is
 * narrow — pull id, title, link, date and excerpt out of well-formed
 * regulator feeds — and a dependency in the data path is a dependency
 * we would have to audit, pin and keep patched for the life of the
 * product. This is fifty lines we can test.
 *
 * Deliberately tolerant: a regulator's feed is not a contract we
 * control, and a single malformed item must cost us that item, never
 * the run. Anything we cannot make sense of is skipped and counted.
 */

export interface FeedItem {
  /** Stable identifier from the feed. Falls back to the link. */
  externalId: string;
  title: string;
  link: string;
  publishedAt: string | null;
  excerpt: string | null;
}

export interface ParsedFeed {
  items: FeedItem[];
  /** Entries present in the XML that we could not use. */
  skipped: number;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

/** Unwrap CDATA, decode the handful of entities feeds actually use. */
function decode(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .trim();
}

/** Strip markup, then collapse whitespace — feeds embed HTML freely. */
function text(raw: string | null): string | null {
  if (raw === null) return null;
  const stripped = decode(raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length > 0 ? stripped : null;
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return match?.[1] ?? null;
}

/** Atom links carry the URL in an attribute, not in the body. */
function atomLink(block: string): string | null {
  const rel = /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i.exec(block);
  if (rel?.[1]) return decode(rel[1]);
  const any = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(block);
  return any?.[1] ? decode(any[1]) : null;
}

/** ISO-8601 or RFC-822; anything unparseable becomes null, not now(). */
function date(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = new Date(decode(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Reduce a regulator's HTML page to readable text.
 *
 * Not a general-purpose converter — the only consumer is the
 * extraction prompt, which needs prose and is unharmed by lost
 * structure. Script and style bodies are dropped first: their contents
 * are not markup, so stripping tags alone would leave minified
 * JavaScript in the middle of the text we pay a model to read.
 */
export function htmlToText(html: string, maxChars = 12_000): string {
  const text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    // Block boundaries become spaces so words either side do not fuse.
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  return decode(text.replace(/<[^>]*>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    // An opening tag also collapses to a space, which would otherwise
    // leave every line indented by the markup it came from.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

export function parseFeed(xml: string): ParsedFeed {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const items: FeedItem[] = [];
  let skipped = 0;

  for (const block of blocks) {
    const title = text(tag(block, 'title'));
    const link = text(tag(block, 'link')) ?? atomLink(block);

    // Without a title and a destination there is nothing to review and
    // nowhere to send a reader. Not an error, just not an item.
    if (!title || !link) {
      skipped += 1;
      continue;
    }

    // guid/id is the feed's own identity for the entry and is what
    // makes polling idempotent. The link is a sound fallback: for these
    // sources it is a permalink to one decision.
    const externalId = text(tag(block, 'guid')) ?? text(tag(block, 'id')) ?? link;

    items.push({
      externalId,
      title,
      link,
      publishedAt:
        date(tag(block, 'pubDate')) ?? date(tag(block, 'updated')) ?? date(tag(block, 'published')),
      excerpt: text(tag(block, 'description')) ?? text(tag(block, 'summary'))
    });
  }

  return { items, skipped };
}
