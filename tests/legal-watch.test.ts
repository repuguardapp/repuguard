import fs from 'node:fs';
import path from 'node:path';
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

describe('htmlToText — what the extraction prompt actually reads', () => {
  it('drops script and style bodies rather than only their tags', async () => {
    const { htmlToText } = await import('../src/lib/feeds');
    const html =
      '<html><head><style>.a{color:red}</style></head>' +
      '<body><script>var x=1;alert(x)</script><p>Décision rendue.</p></body></html>';
    const text = htmlToText(html);

    // Stripping tags alone would leave minified JavaScript in the
    // middle of text we pay a model to read.
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).toContain('Décision rendue.');
  });

  it('keeps words either side of a block boundary apart', async () => {
    const { htmlToText } = await import('../src/lib/feeds');
    expect(htmlToText('<li>CNIL</li><li>ICO</li>')).toBe('CNIL\nICO');
  });

  it('caps the length it will hand to the model', async () => {
    const { htmlToText } = await import('../src/lib/feeds');
    const long = `<p>${'mot '.repeat(10_000)}</p>`;
    expect(htmlToText(long, 500).length).toBeLessThanOrEqual(500);
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

describe('a dead source stops shouting', () => {
  it('encodes the auto-disable rule and the streak reset', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(__dirname, '..', 'src/app/api/cron/watch-legal/route.ts'),
      'utf8'
    );

    // A feed that no longer exists would otherwise alert four times a
    // day for ever. That is how an alerting channel stops being read,
    // and it discredits the alerts that matter alongside it — the ICO
    // withdrew every one of its RSS feeds, so ours was never coming
    // back.
    expect(source).toContain('DISABLE_AFTER_CONSECUTIVE_FAILURES');
    expect(source).toContain('cron.watch_legal_source_disabled');

    // A success must clear the streak, or an intermittent feed creeps
    // up to the threshold over weeks of alternating runs.
    //
    // Matched on the three fields rather than on one line of formatting:
    // the previous version asserted the exact source line and failed the
    // day a fourth field was added beside it, which is a test reporting on
    // the shape of the code instead of on what it does.
    const success = source.slice(source.indexOf("last_status: 'ok'"));
    expect(success).toContain('last_error: null');
    expect(success.slice(0, 400)).toContain('consecutive_failures: 0');

    // And the count, because `items.length > 0` is all ok has ever meant.
    expect(success.slice(0, 400)).toContain('last_item_count: items.length');
  });
});

describe('the extraction pivot is one language', () => {
  it('tells the model to name statutes in English whatever the source', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(__dirname, '..', 'src/app/api/cron/extract-legal/route.ts'),
      'utf8'
    );

    // The first two real extractions came back with "RGPD Art. 12" from
    // a French source and "GDPR Art. 32" from another. On an English
    // page "RGPD" is simply wrong, and a corpus that names the same
    // statute two ways splits its own search traffic.
    expect(source).toContain('in ENGLISH');
    expect(source).toContain('English abbreviation even when the source is in');
  });

  it('forbids inferring an article the source never names', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(__dirname, '..', 'src/app/api/cron/extract-legal/route.ts'),
      'utf8'
    );

    // The EDPB anonymisation guidelines came back citing "GDPR Art. 4".
    // The page names Article 6 and Article 9(2) and nothing else — Art.
    // 4 is what anonymisation is ABOUT, not what the source cites. It is
    // a defensible reading and it is still an inference, and an
    // inference published in a "Provisions cited" badge is indistinguishable
    // from something we read in the text.
    expect(source).toContain('NEVER infer an article from the subject matter');
    expect(source).toContain('An empty list is the correct answer');
    // And sub-paragraphs survive: Art. 65(1)(a) and Art. 9(2) are not
    // Art. 65 and Art. 9.
    expect(source).toContain('"Art. 9(2)", not "Art. 9"');
  });
});

describe('finding the feed a source should have had', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src/app/api/cron/watch-legal/route.ts'),
    'utf8'
  );

  /**
   * The ICO and Brazil's ANPD both build their listings in the browser, so
   * the HTML a crawler receives genuinely does not contain the decisions:
   * no item_pattern can read them and the repair is a different URL.
   * Finding one meant guessing from a build sandbox that cannot reach a
   * single regulator domain — one guess per six-hour run, each verified
   * only by a red badge the next morning. The production function has the
   * network access the sandbox does not, so it looks instead.
   */

  it('probes only when a source has already failed', () => {
    // A healthy source must cost its host exactly one request. Probing on
    // every run would turn a subscriber into a crawler, which is how you
    // stop being answered at all.
    const successPath = source.slice(source.indexOf("last_status: 'ok'"));
    expect(successPath).not.toContain('probeCandidates');

    expect(source).toContain('const candidates = await probeCandidates');
  });

  it('keeps the probe small enough to be polite', () => {
    // Four paths at four seconds. Sixteen requests a day to a broken
    // source's host, at the very most, and none at all to a working one.
    expect(source).toContain('PROBE_TIMEOUT_MS = 4_000');
    const probe = source.slice(source.indexOf('const paths = ['));
    expect(probe.slice(0, 200).match(/`?\$?\{?stem\}?[^,]*`?/g)?.length).toBeLessThanOrEqual(5);
  });

  it('does not report a 200 as a feed without looking at it', () => {
    // A site answering every URL with its homepage would otherwise report
    // four feeds and have none.
    expect(source).toContain('describeFeed(head)');
  });

  it('never probes the URL that just failed', () => {
    expect(source).toContain('if (candidate === feedUrl) continue;');
  });
});

describe('a source that never worked is not a source that broke', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src/app/api/cron/watch-legal/route.ts'),
    'utf8'
  );

  /**
   * We sell audits against six Gulf regimes and watched none of them.
   * Adding those authorities means adding URLs nobody here can open — the
   * build sandbox reaches no regulator domain — so the first honest
   * description of each is "candidate", and each is expected to fail while
   * the prober narrows the path down.
   *
   * Under the ordinary rule that is five failures, about thirty hours:
   * every Gulf source would have switched itself off before anyone had
   * read a single probe report, and would have sent twenty alerts on the
   * way. The alerting channel would have been trained to be ignored by the
   * six sources it was reporting on.
   */

  it('gives a candidate a longer rope than a source that regressed', () => {
    expect(source).toContain('DISABLE_UNVERIFIED_AFTER = 20');
    expect(source).toContain('DISABLE_AFTER_CONSECUTIVE_FAILURES = 5');
    expect(source).toContain(
      'const limit = unverified ? DISABLE_UNVERIFIED_AFTER : DISABLE_AFTER_CONSECUTIVE_FAILURES;'
    );
  });

  it('does not alert on a candidate failing, which is the expected case', () => {
    expect(source).toContain('const brokenAlerts = failed.filter((f) => !f.unverified);');
    // The run-level alert takes the filtered list, not the raw one.
    const alertCall = source.slice(source.indexOf("alertOps('cron.watch_legal_source_failed'"));
    expect(alertCall.slice(0, 250)).toContain('brokenAlerts.map');
  });

  it('still says something the day it gives up on a jurisdiction we sell', () => {
    // Abandoning Saudi Arabia is worth one line even though each
    // individual failure on the way was not.
    const disabled = source.slice(source.indexOf("alertOps('cron.watch_legal_source_disabled'"));
    expect(disabled.slice(0, 200)).toContain('unverified');
  });

  it('stops being a candidate the first time it produces an item', () => {
    expect(source).toContain("verified_at: new Date().toISOString()");
    // Written once. Re-stamping it on every success would make the column
    // mean "last time it worked", which is last_polled_at's job.
    expect(source).toContain('...(source.verified_at ? {} : {');
  });

  it('searches wider for a source that has never worked', () => {
    // Probing for a feed beside a 404 answers a question we are not
    // asking: for these the failure is the listing path itself.
    expect(source).toContain('probeCandidates(source.feed_url, !source.verified_at)');
    expect(source).toContain("paths.push('/en/news'");
  });

  it('bounds the whole search, not each request', () => {
    // So the path list can grow without anyone recomputing whether the
    // function still fits inside its sixty seconds.
    expect(source).toContain('PROBE_BUDGET_MS');
    expect(source).toContain('if (Date.now() > deadline)');
  });
});

describe('the Gulf sources claim no permission they do not have', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '0029_gulf_sources.sql'),
    'utf8'
  );

  it('covers every Gulf regime the product sells', async () => {
    const { FRAMEWORKS } = await import('../src/lib/legal-frameworks');
    const gulf = FRAMEWORKS.filter((f) =>
      ['SA', 'AE', 'QA', 'BH', 'KW', 'OM'].includes(f.jurisdiction)
    );

    // Six frameworks on the pricing page, six in the audit engine, and
    // until today none in the corpus behind them.
    expect(gulf).toHaveLength(6);
    for (const framework of gulf) {
      expect(sql).toContain(`'${framework.id}'`);
    }
  });

  it('never invents an open licence for an authority that publishes none', () => {
    // The European rows cite Etalab, the OGL, Decision 2011/833/EU —
    // real permissions. No Gulf authority publishes one, and a plausible
    // licence string written to make the column look uniform would be a
    // compliance company citing a permission that does not exist. That is
    // the single most dangerous thing this table could contain.
    const inserts = sql.slice(sql.indexOf('insert into public.legal_sources'));
    for (const claim of ['Open Government Licence', 'Etalab', '2011/833', 'CC BY', 'public domain']) {
      expect(inserts).not.toContain(claim);
    }
    expect(inserts).toContain('No published reuse licence');
    // And it states what the pipeline actually does instead.
    expect(inserts).toContain('never rendered or indexed');
  });

  it('adds them as candidates rather than asserting they work', () => {
    // verified_at is left null on purpose: the sandbox that wrote these
    // URLs cannot open a single one of them. Checked against the insert
    // rather than the file, which explains the choice at length.
    const inserts = sql.slice(sql.indexOf('insert into public.legal_sources'));
    expect(inserts).not.toContain('verified_at');
    expect(inserts).toContain('on conflict (id) do nothing');
  });
});

describe('a site that answers 200 to anything tells the prober nothing', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src/app/api/cron/watch-legal/route.ts'),
    'utf8'
  );

  /**
   * SDAIA and the Garante both answered 200 to every path the prober tried
   * — /RSS, /feed and /rss.xml each returning the same page — and the
   * report duly listed three feeds that were one web page. A single-page
   * application serving its shell for any URL makes every finding
   * meaningless, and a report that cannot tell a discovery from a catch-all
   * is worse than no report: it is four confident wrong answers a morning,
   * which is this codebase's recurring failure rather than a new one.
   */

  it('asks for something that cannot exist before believing anything else', () => {
    expect(source).toContain('const canary = `/${crypto.randomUUID()}`');
    // Random, so it is neither guessable nor cacheable.
    expect(source).toContain('answersAnything');
  });

  it('reports the catch-all instead of the findings it would have made', () => {
    const probe = source.slice(source.indexOf('const canary'), source.indexOf('const findings'));
    expect(probe).toContain('catch-all, no path here can be trusted');
    // Returns rather than continuing: listing paths underneath would put
    // the wrong answer and its refutation in the same sentence.
    expect(probe).toMatch(/return `site answers 200/);
    // It still reports what robots.txt advertises, which is the one finding
    // that survives a catch-all: a sitemap the site names itself.
    expect(probe).toContain('robots.txt:');
  });

  it('treats an error on the canary as the good outcome', () => {
    // Inverted from every other fetch here: a 404, a timeout or a throw
    // all mean the server distinguishes between paths, which is what makes
    // the probe worth running.
    const fn = source.slice(source.indexOf('async function answersAnything'));
    expect(fn.slice(0, 500)).toContain('return false;');
    expect(fn.slice(0, 500)).toContain('return res.ok;');
  });

  it('carries the byte count, which separates three pages from one page thrice', () => {
    expect(source).toContain('${head.length}B');
  });
});
