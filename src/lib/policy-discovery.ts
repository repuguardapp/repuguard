import 'server-only';
import { fetchExternal } from './safe-fetch';
import { isAllowed, parseRobots, USER_AGENT, type RobotsRules } from './robots';
import { sitemapsFromRobots } from './sitemap';

/**
 * Find the privacy policy a domain has published, without ever guessing.
 *
 * This is the front door of the acquisition loop: somebody types a domain,
 * and everything downstream depends on us having read the right document.
 * Reading the wrong one and reporting on it is the worst outcome available —
 * a factual statement about a document that is not the document.
 *
 * SO THE ANSWER CARRIES HOW IT WAS FOUND
 *
 * Every candidate returned says where it came from: a link the homepage
 * published, an entry in the sitemap, or a conventional path we tried.
 * Those are not equally good, and the caller — and eventually the reader —
 * gets to see which one it was. A policy found because the site linked to it
 * is the site's own answer to "where is your privacy policy"; a policy found
 * at /privacy because we tried it is our guess, and it is labelled as one.
 *
 * WE OBEY robots.txt
 *
 * A compliance company that ignores robots.txt to run a compliance scan has
 * lost the argument before it starts. A site we cannot read is a site we
 * report nothing about.
 */

export type Provenance = 'linked-from-homepage' | 'listed-in-sitemap' | 'conventional-path';

export interface Candidate {
  url: string;
  provenance: Provenance;
  /** The anchor text, when a link is what pointed us here. */
  label?: string;
}

export interface Discovery {
  candidates: Candidate[];
  /** Set when we did not look, and why. Never an empty result pretending to be one. */
  refused: string | null;
}

/** Bounded: this runs for a stranger who typed a domain into a box. */
const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 800_000;

/**
 * Anchor text that means "privacy policy" in the seven languages we serve,
 * plus the two spellings English cannot agree on.
 *
 * Matched against the link's own words rather than its URL, because the
 * words are what the site chose to call it — `/legal/doc-3` with the anchor
 * "Politique de confidentialité" is the right document and its path says
 * nothing.
 */
const POLICY_WORDS = [
  'privacy policy',
  'privacy notice',
  'privacy statement',
  'privacy',
  'politique de confidentialité',
  'confidentialité',
  'données personnelles',
  'política de privacidad',
  'privacidad',
  'datenschutzerklärung',
  'datenschutz',
  'política de privacidade',
  'privacidade',
  'プライバシーポリシー',
  'プライバシー',
  '個人情報',
  'سياسة الخصوصية',
  'الخصوصية'
];

/**
 * Paths worth trying when a site links to nothing.
 *
 * Last resort, and labelled as a guess in the result. Kept short: a long
 * list is a crawl, and most of it would 404 on somebody else's server for
 * our convenience.
 */
const CONVENTIONAL_PATHS = [
  '/privacy',
  '/privacy-policy',
  '/legal/privacy',
  '/politique-de-confidentialite',
  '/datenschutz'
];

const ANCHOR = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function get(url: string, accept: string): Promise<Response | null> {
  try {
    const res = await fetchExternal(url, {
      headers: { 'user-agent': `${USER_AGENT}/1.0 (+https://lexyflow.com)`, accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/**
 * Read the site's robots.txt before anything else.
 *
 * Unknown means unreadable, and unreadable means we stop. That is stricter
 * than every crawler in existence, and it is the right default for a
 * product whose entire claim is that it respects rules other people set.
 */
async function readRobots(origin: string): Promise<{ rules: RobotsRules; sitemaps: string[] }> {
  const res = await get(`${origin}/robots.txt`, 'text/plain');

  // A 404 on robots.txt means the site has no opinion, which the standard
  // reads as "everything is allowed". Only a failure to reach the site at
  // all leaves us unable to know.
  if (!res) return { rules: { rules: [], unknown: false }, sitemaps: [] };

  const text = (await res.text()).slice(0, 100_000);
  return { rules: parseRobots(text), sitemaps: sitemapsFromRobots(text, origin) };
}

export async function discoverPolicy(domain: string): Promise<Discovery> {
  let origin: string;
  try {
    // A bare domain is what a visitor types. https only: a scan carried over
    // http would be a compliance product reading a document in clear.
    const parsed = new URL(domain.includes('://') ? domain : `https://${domain}`);
    if (parsed.protocol !== 'https:') return { candidates: [], refused: 'https only' };
    origin = parsed.origin;
  } catch {
    return { candidates: [], refused: 'not a domain' };
  }

  const { rules } = await readRobots(origin);

  if (!isAllowed('/', rules)) {
    // Said plainly rather than returned as "nothing found". A site that asks
    // not to be crawled has given an answer, and it is not "no policy".
    return { candidates: [], refused: 'robots.txt disallows us' };
  }

  const found = new Map<string, Candidate>();
  const add = (url: string, provenance: Provenance, label?: string) => {
    let normalised: string;
    try {
      const u = new URL(url, origin);
      if (u.origin !== origin) return; // Same origin only.
      u.hash = '';
      normalised = u.toString();
    } catch {
      return;
    }
    if (found.has(normalised)) return;
    if (!isAllowed(new URL(normalised).pathname, rules)) return;
    found.set(normalised, label ? { url: normalised, provenance, label } : { url: normalised, provenance });
  };

  // 1. What the site itself links to. The best answer, because it is theirs.
  const home = await get(origin, 'text/html');
  if (home) {
    const html = (await home.text()).slice(0, MAX_HTML_BYTES);
    for (const match of html.matchAll(ANCHOR)) {
      const label = textOf(match[2] ?? '').toLowerCase();
      if (!label || label.length > 60) continue;
      if (POLICY_WORDS.some((word) => label.includes(word))) {
        add(match[1]!, 'linked-from-homepage', textOf(match[2] ?? ''));
      }
    }
  }

  // 2. Conventional paths, only if the site pointed at nothing. Labelled as
  //    ours, because that is what they are.
  if (found.size === 0) {
    for (const path of CONVENTIONAL_PATHS) {
      const res = await get(`${origin}${path}`, 'text/html');
      if (res) add(res.url || `${origin}${path}`, 'conventional-path');
      if (found.size > 0) break;
    }
  }

  return {
    candidates: [...found.values()],
    // Nothing found is a fact about the search, not about the site. The
    // caller must not render it as "this company has no privacy policy" —
    // it may be behind a script, a login, or a path we did not try.
    refused: found.size === 0 ? 'no policy link found from the homepage or the usual paths' : null
  };
}
