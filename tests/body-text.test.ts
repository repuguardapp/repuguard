import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAX_DECOMPRESSED_BYTES, decodeBody } from '@/lib/body-text';

/**
 * A sitemap published as .xml.gz.
 *
 * Not Content-Encoding, which fetch already undoes. This is a file whose
 * content is compressed, served as application/gzip, which res.text()
 * decodes as UTF-8 into mojibake — and every parser downstream then
 * truthfully reports that it found no items. The document was fine. We
 * could not read it, and said the opposite.
 *
 * It matters because Brazil's repair leads straight here: the only
 * machine-readable index the ANPD's host advertises in robots.txt is
 * https://www.gov.br/sitemap.xml.gz.
 */

const SITEMAP =
  '<?xml version="1.0"?><urlset><url><loc>https://www.gov.br/anpd/pt-br/assuntos/noticias/a</loc></url></urlset>';

describe('decodeBody', () => {
  it('reads a gzip body as the document it is', () => {
    const decoded = decodeBody(new Uint8Array(gzipSync(Buffer.from(SITEMAP, 'utf8'))));

    expect(decoded.refused).toBeNull();
    expect(decoded.text).toBe(SITEMAP);
  });

  it('leaves an uncompressed body alone', () => {
    const decoded = decodeBody(new TextEncoder().encode(SITEMAP));

    expect(decoded.refused).toBeNull();
    expect(decoded.text).toBe(SITEMAP);
  });

  it('detects gzip from the bytes, not from a header or a file extension', () => {
    // Sites serve .gz with every content type imaginable. The two magic
    // bytes are the thing that is actually true.
    const decoded = decodeBody(new Uint8Array(gzipSync(Buffer.from('<urlset/>', 'utf8'))));
    expect(decoded.text).toBe('<urlset/>');
  });

  it('refuses a body that decompresses past the ceiling, and says so', () => {
    // Decompression is where a small download becomes a large allocation,
    // and the file belongs to somebody else. A truncated sitemap read as a
    // complete one would be the "at least one item" mistake one layer down,
    // so the refusal travels instead of a partial read.
    const huge = gzipSync(Buffer.alloc(MAX_DECOMPRESSED_BYTES + 1024, 0x61));
    const decoded = decodeBody(new Uint8Array(huge));

    expect(decoded.text).toBe('');
    expect(decoded.refused).toContain('gzip');
  });

  it('refuses a corrupt gzip body rather than returning rubbish', () => {
    const corrupt = new Uint8Array(gzipSync(Buffer.from(SITEMAP, 'utf8')));
    corrupt[10] = corrupt[10]! ^ 0xff;
    corrupt[11] = corrupt[11]! ^ 0xff;

    const decoded = decodeBody(corrupt);

    expect(decoded.refused).not.toBeNull();
    expect(decoded.text).toBe('');
  });

  it('handles an empty body without claiming it is gzip', () => {
    const decoded = decodeBody(new Uint8Array(0));

    expect(decoded.refused).toBeNull();
    expect(decoded.text).toBe('');
  });
});
