import { describe, expect, it } from 'vitest';
import { canonicalExternalId, canonicalItemUrl } from '@/lib/canonical-url';

/**
 * Japan's PPC entered the corpus three times over:
 *
 *   /news/privacy_awareness_week
 *   /news/privacy_awareness_week?ref=gnavi
 *   /news/privacy_awareness_week/
 *
 * Three distinct external_ids, three rows, three extraction calls to a
 * language model, three rejections of one page. The idempotency key was
 * doing its job — those really are three different strings — and the
 * strings were the problem.
 */

const PPC = 'https://www.ppc.go.jp/news/privacy_awareness_week';

describe('one page, one row', () => {
  it('collapses the three shapes Japan actually sent us', () => {
    const variants = [PPC, `${PPC}?ref=gnavi`, `${PPC}/`];
    const canonical = new Set(variants.map((v) => canonicalItemUrl(v)));

    expect(canonical.size).toBe(1);
    expect([...canonical][0]).toBe(PPC);
  });

  it('drops a fragment, which is a position and not a page', () => {
    // The ICO's accessibility skip link became a watched "item" this way:
    // href="#main-content" resolved to the listing itself.
    expect(canonicalItemUrl(`${PPC}#content`)).toBe(PPC);
  });

  it('orders the query so one page is not two rows', () => {
    expect(canonicalItemUrl('https://x.test/a?b=2&a=1')).toBe(
      canonicalItemUrl('https://x.test/a?a=1&b=2')
    );
  });
});

describe('what it refuses to throw away', () => {
  it('keeps a query string that identifies the document', () => {
    // Dropping every query string would collapse a whole archive onto one
    // row. Plenty of public bodies serve an article as ?id= or ?docweb=,
    // and the Garante's own sitemap children are ?p_l_id=…&layoutUuid=…
    const withId = 'https://www.garanteprivacy.it/web/guest/home/docweb?docweb=9876';
    expect(canonicalItemUrl(withId)).toContain('docweb=9876');

    const liferay = 'https://www.garanteprivacy.it/sitemap.xml?p_l_id=145219&layoutUuid=abc';
    expect(canonicalItemUrl(liferay)).toContain('p_l_id=145219');
    expect(canonicalItemUrl(liferay)).toContain('layoutUuid=abc');
  });

  it('keeps the slash on a root path', () => {
    expect(canonicalItemUrl('https://x.test/')).toBe('https://x.test/');
  });

  it('leaves a feed guid alone', () => {
    // A guid is the publisher's own statement about which entry this is,
    // and it is more authoritative than anything we could compute. Only an
    // identifier that IS a URL gets touched, because only then did we
    // choose it.
    expect(canonicalExternalId('urn:uuid:4f2a-not-a-url/')).toBe('urn:uuid:4f2a-not-a-url/');
    expect(canonicalExternalId('cnil-2026-0142')).toBe('cnil-2026-0142');
  });

  it('canonicalises an external id that is a URL', () => {
    expect(canonicalExternalId(`${PPC}?ref=gnavi`)).toBe(PPC);
  });
});

describe('what is not a source at all', () => {
  it('refuses a string that is not a URL', () => {
    // A primary_url is what a published page cites as its source. Citing
    // a string we could not parse is not a citation.
    expect(canonicalItemUrl('not a url')).toBeNull();
    expect(canonicalItemUrl('')).toBeNull();
  });

  it('refuses a scheme that is not http', () => {
    expect(canonicalItemUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalItemUrl('data:text/html,<p>x</p>')).toBeNull();
    expect(canonicalItemUrl('file:///etc/passwd')).toBeNull();
  });

  it('strips the advertising family without being asked twice', () => {
    const tracked = `${PPC}?utm_source=x&utm_medium=y&gclid=z`;
    expect(canonicalItemUrl(tracked)).toBe(PPC);
  });
});
