import 'server-only';
import { createHash } from 'node:crypto';
import { htmlToText } from './feeds';
import { describeFetchError, fetchExternal } from './safe-fetch';
import { USER_AGENT } from './robots';

/**
 * Take the document, and record it in a way anybody can check.
 *
 * Everything published downstream is a statement about a specific document
 * fetched at a specific moment. That is only defensible if the document can
 * be identified again, so this returns a hash — and the hash is over the RAW
 * BYTES as received, not over the text we extracted from them.
 *
 * The distinction matters. If we hashed the extracted text, improving the
 * extractor would change the hash of documents that never changed, and every
 * stored observation would start pointing at a document that no longer
 * exists by that identifier. Hashing the bytes means anyone can fetch the
 * URL, hash the response, and land on the same snapshot we did.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS NAMED
 *
 * A refusal is returned as a reason, never as an empty result. "We read
 * nothing" and "there is nothing to read" are opposite statements, and only
 * one of them is about the site. Rendering the first as the second is how a
 * factual observatory starts publishing things that are not true.
 */

export interface Capture {
  url: string;
  contentHash: string;
  contentType: string;
  byteLength: number;
  text: string;
  fetchedAt: string;
}

export interface CaptureResult {
  capture: Capture | null;
  /** Populated when there is no capture. Always a fact about our fetch. */
  refused: string | null;
}

const FETCH_TIMEOUT_MS = 10_000;

/** A privacy policy is prose. Anything past this is not the document. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Below this many characters of extracted text, a page is a shell.
 *
 * The lesson the sub-processor diff already paid for: a single-page
 * application returns 200 with a skeleton, and reading that as "this policy
 * says nothing about retention" would be a factual claim about a document we
 * never actually read. The shortest genuine privacy policy runs to
 * thousands of characters.
 */
const MIN_TEXT_CHARS = 1_500;

/**
 * And a second test, because the first let airbnb.com through.
 *
 * 247KB of HTML produced 1,960 characters of text — 0.8% — and the scan
 * published seven blank observations about a named company that plainly
 * does have a detailed privacy policy. The two documents we read correctly
 * that day, Uber's and our own, both sat at 5.4%.
 *
 * A large file that yields almost no prose is a page assembled in the
 * browser: the bytes are script, not text. The absolute floor alone cannot
 * see that, because a shell of a big site clears it comfortably.
 */
const BULKY_HTML_BYTES = 100_000;
const BULKY_MIN_TEXT_CHARS = 3_000;

/**
 * Chrome is not the document.
 *
 * Our own scan quoted "日本語 العربية Se connecter Lancer un audit" as
 * evidence for a finding, because the site header is inside the page we
 * fetched. It was not a false claim — that text is on the page — but it is
 * not the privacy policy either, and on another site a footer link reading
 * "Politique de confidentialité" or a cookie banner listing rights could
 * turn navigation into a finding.
 *
 * Removed here rather than in htmlToText, which the legal-watch extractor
 * also depends on. A shared helper is the wrong place to change behaviour
 * for one caller.
 */
const CHROME = /<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;

export async function capturePolicy(url: string): Promise<CaptureResult> {
  let response: Response;
  try {
    response = await fetchExternal(url, {
      headers: {
        'user-agent': `${USER_AGENT}/1.0 (+https://lexyflow.com)`,
        accept: 'text/html,application/xhtml+xml;q=0.9'
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
  } catch (err) {
    return { capture: null, refused: `could not fetch: ${describeFetchError(err)}` };
  }

  if (!response.ok) return { capture: null, refused: `the page answered HTTP ${response.status}` };

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();

  // PDF policies exist and we do not read them yet. Said plainly rather
  // than half-supported: a PDF run through an HTML extractor produces
  // plausible-looking nonsense, and plausible-looking nonsense is exactly
  // what this product cannot ship.
  if (contentType.includes('application/pdf')) {
    return { capture: null, refused: 'the policy is a PDF, which this scan does not read yet' };
  }

  if (contentType && !contentType.includes('html') && !contentType.includes('text/plain')) {
    return { capture: null, refused: `unexpected content type: ${contentType.split(';')[0]}` };
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    return { capture: null, refused: 'the document is larger than a privacy policy should be' };
  }

  const bytes = new Uint8Array(buffer);
  // Over the bytes. See the note at the top: this is what makes every
  // downstream statement reproducible by a stranger.
  const contentHash = createHash('sha256').update(bytes).digest('hex');

  const html = new TextDecoder('utf-8').decode(bytes).replace(CHROME, ' ');
  const text = htmlToText(html, 400_000);

  if (buffer.byteLength > BULKY_HTML_BYTES && text.length < BULKY_MIN_TEXT_CHARS) {
    return {
      capture: null,
      refused: `${Math.round(buffer.byteLength / 1024)}KB of HTML yielded only ${text.length} characters — the page is built in the browser`
    };
  }

  if (text.length < MIN_TEXT_CHARS) {
    return {
      capture: null,
      // Named as ours. A page built in the browser is not a page that says
      // nothing, and we are not entitled to report it as one.
      refused: `only ${text.length} characters of text — the page is probably built in the browser`
    };
  }

  return {
    capture: {
      // The URL AFTER redirects. A policy that lives at /legal/privacy and
      // is reached from /privacy should be cited where it actually is.
      url: response.url || url,
      contentHash,
      contentType: contentType.split(';')[0] || 'text/html',
      byteLength: buffer.byteLength,
      text,
      fetchedAt: new Date().toISOString()
    },
    refused: null
  };
}
