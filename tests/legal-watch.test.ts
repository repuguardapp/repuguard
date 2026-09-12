import { describe, expect, it } from 'vitest';
import { parseFeed } from '../src/lib/feeds';

/**
 * Regulator feeds are not a contract we control. The parser's job is
 * to survive them: one malformed entry must cost us that entry, never
 * the run, and anything we cannot make sense of must be counted rather
 * than guessed at.
 */

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>CNIL</title>
  <item>
    <title><![CDATA[Sanction de 300 000 € à l'encontre de la société X]]></title>
    <link>https://www.cnil.fr/fr/sanction-300000-societe-x</link>
    <guid isPermaLink="false">cnil-2026-014</guid>
    <pubDate>Wed, 09 Sep 2026 08:30:00 +0200</pubDate>
    <description>&lt;p&gt;La formation restreinte a prononc&#233;e une sanction.&lt;/p&gt;</description>
  </item>
  <item>
    <title>Item with no link at all</title>
    <guid>orphan-1</guid>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:uuid:9f1c</id>
    <title type="text">EDPB adopts guidelines on Article 13</title>
    <link rel="edit" href="https://example.org/edit/9f1c"/>
    <link rel="alternate" href="https://www.edpb.europa.eu/news/9f1c_en"/>
    <updated>2026-09-10T14:00:00Z</updated>
    <summary>Guidelines adopted at the plenary.</summary>
  </entry>
</feed>`;

describe('parseFeed — RSS', () => {
  const { items, skipped } = parseFeed(RSS);

  it('keeps the usable item and counts the unusable one', () => {
    expect(items).toHaveLength(1);
    // No link means nowhere to send a reader and no primary source to
    // cite. Not an error — just not an item.
    expect(skipped).toBe(1);
  });

  it('unwraps CDATA and decodes entities', () => {
    expect(items[0]?.title).toBe("Sanction de 300 000 € à l'encontre de la société X");
    expect(items[0]?.excerpt).toBe('La formation restreinte a prononcée une sanction.');
  });

  it('prefers the feed guid, which is what makes polling idempotent', () => {
    expect(items[0]?.externalId).toBe('cnil-2026-014');
  });

  it('normalises RFC-822 dates to ISO', () => {
    expect(items[0]?.publishedAt).toBe('2026-09-09T06:30:00.000Z');
  });
});

describe('parseFeed — Atom', () => {
  const { items } = parseFeed(ATOM);

  it('reads the link from the alternate rel, not the first href', () => {
    // Taking the first <link> would send every reader to an edit URL.
    expect(items[0]?.link).toBe('https://www.edpb.europa.eu/news/9f1c_en');
  });

  it('uses id and updated', () => {
    expect(items[0]?.externalId).toBe('urn:uuid:9f1c');
    expect(items[0]?.publishedAt).toBe('2026-09-10T14:00:00.000Z');
  });
});

describe('parseFeed — hostile input', () => {
  it('returns nothing rather than throwing on an HTML error page', () => {
    // What a moved feed actually serves. The caller treats zero items
    // as a source failure precisely because of this.
    const { items } = parseFeed('<html><body><h1>404 Not Found</h1></body></html>');
    expect(items).toHaveLength(0);
  });

  it('does not invent a date it cannot parse', () => {
    const { items } = parseFeed(
      '<rss><item><title>T</title><link>https://x.test/a</link><pubDate>soon</pubDate></item></rss>'
    );
    // Defaulting to now() would date a decision to the day we noticed
    // it, and every page would carry a false date.
    expect(items[0]?.publishedAt).toBeNull();
  });

  it('strips markup out of excerpts so nothing renders as HTML', () => {
    const { items } = parseFeed(
      '<rss><item><title>T</title><link>https://x.test/a</link>' +
        '<description>&lt;script&gt;alert(1)&lt;/script&gt;Real text</description></item></rss>'
    );
    expect(items[0]?.excerpt).toBe('alert(1) Real text');
    expect(items[0]?.excerpt).not.toContain('<');
  });
});

describe('the legal-watch corpus is licence-aware by construction', () => {
  it('never seeds a source we may not use commercially', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(__dirname, '..', 'supabase', 'migrations', '0017_legal_watch.sql'),
      'utf8'
    );

    // GDPRhub is the obvious source and is CC BY-NC-SA 4.0. The NC
    // makes it unusable for a commercial SaaS, and being caught in
    // breach of a content licence is not survivable for a compliance
    // company. It may appear in the file only as the explanation of
    // why it is absent.
    const insertBlock = sql.slice(sql.indexOf('insert into public.legal_sources'));
    expect(insertBlock.toLowerCase()).not.toContain('gdprhub');

    // Every seeded source states its licence.
    expect(sql).toContain('licence');
    expect(sql).toContain('2011/833');
  });
});
