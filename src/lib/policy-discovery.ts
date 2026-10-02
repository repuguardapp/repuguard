import 'server-only';
import { describeFetchError, fetchExternal } from './safe-fetch';
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

export type Provenance =
  | 'linked-from-homepage'
  /**
   * The site linked it, but it lives on another hostname.
   *
   * Its own provenance rather than folded into the one above, because a
   * reader is entitled to see that the document we read is not served by
   * the domain that was typed. Google's policy is at
   * policies.google.com, not google.fr; a French subsidiary routinely
   * points at the group's notice. That is the site's answer to "where is
   * your privacy policy" and it is still an answer about somebody else's
   * hostname.
   */
  | 'linked-offsite'
  | 'listed-in-sitemap'
  | 'conventional-path';

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
  '/confidentialite',
  '/datenschutz'
];

/**
 * Words that identify a privacy policy in a URL path.
 *
 * Used only against a site's own sitemap, never to invent a URL. The
 * difference matters: a path in the sitemap is a page the site says it
 * has, so matching it is reading their answer, while assembling the same
 * path ourselves is a guess and is labelled as one.
 */
const POLICY_PATHS =
  /(privacy|confidentialite|confidentialité|donnees-personnelles|données-personnelles|vie-privee|vie-privée|privacidad|privacidade|datenschutz|プライバシー|個人情報|الخصوصية)/i;

const ANCHOR = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Named and numeric HTML entities, because the anchor text is the match.
 *
 * Only `&nbsp;` and `&amp;` were decoded, and the words we look for are
 * accented in five of the seven languages we serve. A footer that writes
 * `Politique de confidentialit&eacute;` — which is ordinary, and what a
 * CMS emits by default — produced the literal string
 * "confidentialit&eacute;", matched nothing, and the scan reported that
 * the site links to no privacy policy. That sentence is about our
 * decoder and was published as a sentence about their footer.
 *
 * The named list is short on purpose: these are the accents that appear
 * in the words in POLICY_WORDS. Numeric references are handled in
 * general, since that is a rule rather than a list.
 */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  szlig: 'ß',
  atilde: 'ã',
  ccedilla: 'ç'
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A fetch that says why it failed.
 *
 * It used to return null for every kind of failure, and the first real
 * scan showed what that costs. uber.fr failed in 148 milliseconds — far
 * too fast for the seven requests discovery makes — with the message "no
 * policy link found from the homepage or the usual paths". That sentence
 * is true and describes the wrong thing: nothing had been read at all, and
 * the report said we had looked at a page.
 *
 * uber.com, scanned a minute later, completed in 1.5 seconds. So the
 * pipeline works and something specific to that hostname does not, and the
 * only way to know which is to carry the reason back.
 */
interface Fetched {
  res: Response | null;
  /** Why there is no response. Null when there is one. */
  error: string | null;
}

async function get(url: string, accept: string, retry = true): Promise<Fetched> {
  try {
    const res = await fetchExternal(url, {
      headers: { 'user-agent': `${USER_AGENT}/1.0 (+https://lexyflow.com)`, accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
    return res.ok ? { res, error: null } : { res: null, error: `HTTP ${res.status}` };
  } catch (err) {
    const reason = describeFetchError(err);

    // One retry on a reset connection, and one only.
    //
    // A reset can be a transient blip, and asking twice is ordinary. What
    // we do NOT do is change what we look like: a site that keeps dropping
    // us is running bot mitigation and has refused. We could very probably
    // get past it with browser-shaped headers, and that is the one thing
    // this product cannot do — we obey robots.txt and identify ourselves,
    // so when a site says no we publish the refusal rather than defeat it.
    // EBUSY is on this list and is not the site's fault at all. Three of
    // the observatory's first twenty-four domains failed with
    // `getaddrinfo EBUSY` — including ec-lyon.fr, which plainly resolves.
    // That is our resolver in a serverless container, not a name that
    // does not exist, and counting it as a refusal would put our own
    // infrastructure into a published denominator.
    if (retry && /ECONNRESET|ECONNABORTED|EPIPE|socket hang up|EBUSY/i.test(reason)) {
      return get(url, accept, false);
    }

    // fetchExternal throws on an unreachable host, on a redirect chain that
    // leaves https, and on a hop resolving to a private address. Each is a
    // different answer and they were all being flattened into "not found".
    return { res: null, error: reason };
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
  const { res } = await get(`${origin}/robots.txt`, 'text/plain');

  // A 404 on robots.txt means the site has no opinion, which the standard
  // reads as "everything is allowed". Only a failure to reach the site at
  // all leaves us unable to know.
  if (!res) return { rules: { rules: [], unknown: false }, sitemaps: [] };

  const text = (await res.text()).slice(0, 100_000);
  return { rules: parseRobots(text), sitemaps: sitemapsFromRobots(text, origin) };
}

export async function discoverPolicy(domain: string): Promise<Discovery> {
  // Reassigned when the domain redirects elsewhere; see below.
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

  let robots = await readRobots(origin);
  let rules = robots.rules;

  if (!isAllowed('/', rules)) {
    // Said plainly rather than returned as "nothing found". A site that asks
    // not to be crawled has given an answer, and it is not "no policy".
    return { candidates: [], refused: 'robots.txt disallows us' };
  }

  // Follow the domain to where it actually lives.
  //
  // uber.fr redirects to uber.com, and the first real scan failed on it in
  // 135 milliseconds: every link on the page we landed on was rejected as
  // cross-origin against the domain that had been typed. A country domain
  // pointing at a group's main site is ordinary, and refusing to read it is
  // refusing to answer the question that was asked.
  //
  // The new origin gets its own robots.txt check before any of its links
  // are used. We were sent there by the site itself, so one request is
  // fair; reading it without asking would not be.
  const homepage = await get(origin, 'text/html');
  const home = homepage.res;

  if (home) {
    try {
      const landed = new URL(home.url || origin).origin;
      if (landed !== origin) {
        origin = landed;
        robots = await readRobots(origin);
        rules = robots.rules;
        if (!isAllowed('/', rules)) {
          return { candidates: [], refused: `redirected to ${origin}, whose robots.txt disallows us` };
        }
      }
    } catch {
      // An unparseable final URL leaves us on the origin we started from.
    }
  }

  const found = new Map<string, Candidate>();

  /**
   * What the search actually saw, so a refusal is diagnosable.
   *
   * The observatory's largest refusal bucket is "the homepage was read
   * and links to no privacy policy", and it landed on lefigaro.fr,
   * leparisien.fr, francetvinfo.fr, radiofrance.fr, paris.fr and rfi.fr
   * — sites whose footers visibly carry the link. So the sentence was
   * almost certainly about us, and it contained nothing that could say
   * which part of us: an undecoded entity, a link to another hostname, a
   * footer injected by a consent manager, all produce the same words.
   *
   * The sandbox cannot reach any of those hosts, so a second guess would
   * be worth what the first was. This census lets the next run answer
   * instead — the same move as the ranking candidate list and the legal
   * watcher's probes.
   */
  const census = { anchors: 0, offsite: 0, blockedByRobots: 0, pathsTried: 0 };

  /** Off-origin links awaiting their own site's permission. url → label. */
  const offsiteQueue = new Map<string, string | undefined>();

  const add = (url: string, provenance: Provenance, label?: string) => {
    let normalised: string;
    let offsite = false;
    try {
      const u = new URL(url, origin);
      if (u.protocol !== 'https:') return;
      offsite = u.origin !== origin;
      u.hash = '';
      normalised = u.toString();
    } catch {
      return;
    }
    if (found.has(normalised)) return;

    // Off-origin links are the site's own answer about somebody else's
    // server, so they are accepted — but only after that server's own
    // robots.txt has been read, exactly as a redirect is. The rules we
    // hold answer for this origin alone; applying them to another
    // hostname would be asking the wrong site for permission. Queued
    // rather than added, because asking takes a request and this
    // function cannot wait.
    if (offsite) {
      census.offsite += 1;
      offsiteQueue.set(normalised, label);
      return;
    }

    if (!isAllowed(new URL(normalised).pathname, rules)) {
      census.blockedByRobots += 1;
      return;
    }
    found.set(normalised, {
      url: normalised,
      provenance,
      ...(label ? { label } : {})
    });
  };

  // 1. What the site itself links to. The best answer, because it is theirs.
  if (home) {
    const html = (await home.text()).slice(0, MAX_HTML_BYTES);
    for (const match of html.matchAll(ANCHOR)) {
      census.anchors += 1;
      const text = textOf(match[2] ?? '');
      const label = text.toLowerCase();
      if (!label || label.length > 60) continue;
      if (POLICY_WORDS.some((word) => label.includes(word))) {
        add(match[1]!, 'linked-from-homepage', text);
      }
    }
  }

  // 1b. Ask the other hostnames before using their pages.
  //
  //     At most two, and robots.txt is read once per origin. A footer
  //     that points at three group domains is unusual; a page that
  //     points at thirty is a link farm and not worth the requests.
  if (found.size === 0 && offsiteQueue.size > 0) {
    const asked = new Map<string, RobotsRules>();
    for (const [url, label] of [...offsiteQueue].slice(0, 2)) {
      const target = new URL(url);
      let theirRules = asked.get(target.origin);
      if (!theirRules) {
        theirRules = (await readRobots(target.origin)).rules;
        asked.set(target.origin, theirRules);
      }
      if (!isAllowed(target.pathname, theirRules)) {
        census.blockedByRobots += 1;
        continue;
      }
      found.set(url, {
        url,
        provenance: 'linked-offsite',
        ...(label ? { label } : {})
      });
    }
  }

  // 2. The site's own sitemap, which has been promised by this module's
  //    Provenance type since it was written and never once produced.
  //
  //    One request to a file that exists to be read by clients like
  //    ours, and it finds the document whatever the site decided to call
  //    it — which is strictly better than us trying six more paths on
  //    their server. A loc in their sitemap is a page they say they
  //    have, so matching it is reading their answer, not guessing.
  if (found.size === 0) {
    for (const sitemap of robots.sitemaps.slice(0, 1)) {
      const { res } = await get(sitemap, 'application/xml');
      if (!res) break;
      const xml = (await res.text()).slice(0, MAX_HTML_BYTES);
      for (const loc of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const url = loc[1]!;
        try {
          if (!POLICY_PATHS.test(new URL(url).pathname)) continue;
        } catch {
          continue;
        }
        add(url, 'listed-in-sitemap');
        if (found.size > 0) break;
      }
    }
  }

  // 3. Conventional paths, only if the site pointed at nothing and its
  //    sitemap listed nothing. Labelled as ours, because that is what
  //    they are.
  if (found.size === 0) {
    for (const path of CONVENTIONAL_PATHS) {
      census.pathsTried += 1;
      const { res } = await get(`${origin}${path}`, 'text/html');
      if (res) add(res.url || `${origin}${path}`, 'conventional-path');
      if (found.size > 0) break;
    }
  }

  return {
    candidates: [...found.values()],
    // Nothing found is a fact about the search, not about the site. The
    // caller must not render it as "this company has no privacy policy" —
    // it may be behind a script, a login, or a path we did not try.
    refused:
      found.size > 0
        ? null
        : // Two different answers that used to read as one. "We could not
          // read the homepage" is about our fetch; "we read it and found no
          // link" is about the page. Reporting the second when the first
          // happened describes a page nobody ever opened.
          homepage.error
          ? `we could not read the homepage: ${homepage.error}`
          : // Carrying what we saw. The sentence stays the same so the
            // refusal classifier keeps grouping it; the numbers after it
            // are what turn the next occurrence into a diagnosis.
            'the homepage was read and links to no privacy policy; the usual paths answered nothing' +
            ` (${census.anchors} link(s) on the page, ${census.blockedByRobots} blocked by robots.txt,` +
            ` ${robots.sitemaps.length} sitemap(s) in robots.txt, ${census.pathsTried} path(s) tried)`
  };
}
