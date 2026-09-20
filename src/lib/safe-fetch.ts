import 'server-only';
import { lookup } from 'node:dns/promises';

/**
 * Fetch a URL that came from outside, without letting it point inward.
 *
 * The legal-watch extractor calls `fetch(item.primary_url)` on a value
 * that originated in an RSS feed. The feeds are regulators' and the
 * list of them is ours, but the ITEMS inside a feed are written by
 * whoever operates it, and an `<link>` is just a string. A feed that is
 * compromised, or a source an operator adds in a hurry, can name
 * `http://127.0.0.1:3000/api/cron/purge?secret=…`, a cloud metadata
 * endpoint, or a service reachable only from inside our network — and
 * the reply is then fed to a model and can end up on a published page.
 *
 * So three checks, in the order they can be evaded:
 *
 *   1. Scheme. https only. `file:`, `gopher:` and friends are not
 *      fetches we ever intend to make.
 *   2. Address. The host is resolved and every answer checked against
 *      the loopback, link-local and private ranges. Resolving rather
 *      than pattern-matching the hostname is the point: `localtest.me`
 *      and a thousand other public names answer 127.0.0.1.
 *   3. Redirects. Followed one at a time, re-checking each hop, because
 *      a permitted host that answers 302 to `http://169.254.169.254`
 *      defeats a check performed only on the URL we started with.
 *
 * A TOCTOU gap remains between our DNS answer and the one the fetch
 * uses. Closing it properly means dialling the address ourselves, which
 * Node's fetch does not expose. It is a narrow window against an
 * attacker who already controls a regulator's feed, and it is named
 * here rather than left as something nobody thought about.
 */

const MAX_REDIRECTS = 3;

/** Ranges that must never be reachable from a URL someone else wrote. */
function isForbiddenAddress(address: string, family: number): boolean {
  if (family === 6) {
    const v6 = address.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:127.0.0.1) re-enters through the v4 rules.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    return mapped ? isForbiddenAddress(mapped[1]!, 4) : false;
  }

  const [a, b] = address.split('.').map(Number) as [number, number, number, number];
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

async function assertPublicHttps(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('unfetchable: not a URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error(`unfetchable: scheme ${url.protocol}`);
  }

  const answers = await lookup(url.hostname, { all: true });
  if (answers.length === 0) throw new Error('unfetchable: host does not resolve');
  for (const { address, family } of answers) {
    if (isForbiddenAddress(address, family)) {
      throw new Error(`unfetchable: ${url.hostname} resolves to ${address}`);
    }
  }
  return url;
}

/**
 * Like fetch(), for a URL we did not write.
 *
 * Redirects are followed manually so each hop is checked; the caller
 * gets the final Response and never learns it moved.
 */
export async function fetchExternal(raw: string, init: RequestInit = {}): Promise<Response> {
  let target = (await assertPublicHttps(raw)).toString();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(target, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    // Relative Location resolves against the hop we are on.
    target = (await assertPublicHttps(new URL(location, target).toString())).toString();
  }

  throw new Error(`unfetchable: more than ${MAX_REDIRECTS} redirects`);
}

/**
 * Say what actually went wrong, not that something did.
 *
 * Node wraps every transport failure — DNS, TCP, TLS, a refused connection
 * — in a single `TypeError: fetch failed`, and puts the real reason in
 * `cause`. A scan of uber.fr reported "we could not read the homepage:
 * fetch failed", which named the layer that failed and nothing else: the
 * same defect as the message it had just replaced, one level down.
 *
 * `getaddrinfo ENOTFOUND uber.fr` and `certificate has expired` are
 * different answers, and the visitor is entitled to the one that applies.
 * They are also facts about our connection attempt rather than claims
 * about the site, which is what makes them publishable at all.
 */
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    // Some causes carry a code and a bare message; both are useful and
    // neither is reliably present.
    const code = (cause as { code?: string }).code;
    const detail = cause.message || code || '';
    if (detail) return code && !detail.includes(code) ? `${detail} (${code})` : detail;
  }

  if (typeof cause === 'string' && cause) return cause;
  return err.message;
}
