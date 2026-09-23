import { gunzipSync } from 'node:zlib';

/**
 * Turn a fetched body into text, including when the file itself is gzip.
 *
 * NOT the same thing as Content-Encoding, which fetch already undoes for
 * us. This is about a file whose CONTENT is compressed: a sitemap
 * published as `sitemap.xml.gz` and served as `application/gzip`. The
 * transport delivers it intact and correct, `res.text()` decodes the
 * compressed bytes as UTF-8, and what comes out is mojibake that every
 * parser downstream reports as "no items" — a true statement about our
 * reading and a false one about the file.
 *
 * It matters because it is where Brazil's repair leads. The ANPD's listing
 * is built in the browser, and the only machine-readable index the site
 * advertises in robots.txt is `https://www.gov.br/sitemap.xml.gz`. Without
 * this, pointing a source at it would have produced a fourth confident
 * wrong answer rather than a fix.
 *
 * THE CAP IS NOT OPTIONAL
 *
 * Decompression is where a small download becomes a large allocation, and
 * the file belongs to somebody else. gunzip stops at the ceiling and the
 * refusal is reported rather than swallowed: a truncated sitemap read as
 * a complete one is exactly the "at least one item" mistake, one layer
 * down.
 */

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/**
 * Twelve megabytes of XML is about a hundred thousand sitemap entries —
 * far past anything we would read, and still small enough to be a
 * comfortable allocation in a serverless function.
 */
export const MAX_DECOMPRESSED_BYTES = 12 * 1024 * 1024;

export interface DecodedBody {
  text: string;
  /** Populated when there is no usable text. Always a fact about our read. */
  refused: string | null;
}

export function decodeBody(bytes: Uint8Array): DecodedBody {
  // Sniffed from the bytes rather than trusted from the URL or the content
  // type. Sites serve .gz with every header imaginable, and the two magic
  // bytes are the thing that is actually true.
  const gzipped = bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;

  if (!gzipped) {
    return { text: new TextDecoder('utf-8').decode(bytes), refused: null };
  }

  try {
    const out = gunzipSync(bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
    return { text: new TextDecoder('utf-8').decode(out), refused: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: '',
      // Named as ours, and specific enough to act on: a file too large to
      // decompress needs a narrower sitemap, a corrupt one needs a
      // different URL.
      refused: `the body is gzip and could not be read: ${message}`
    };
  }
}
