import { describe, expect, it } from 'vitest';
import {
  CANONICAL_URL,
  dataGouvPayload,
  editionTitle,
  findEdition,
  hasMorePages,
  resolveConfig
} from '@/lib/datagouv-payload';
import type { ObservatoryReport } from '@/lib/observatory';

/**
 * The deposit that places our only followable external link.
 *
 * Zenodo holds the DOI and the anchor to lexyflow.com has no `rel` — but
 * the record page carries `<meta name="robots" content="noindex,
 * nofollow">`, measured on 23 October, so that link currently transmits
 * nothing. The differential showed the same directive on another 2026
 * record and none on records from 2020 and 2022, so it correlates with
 * recency rather than with us. Either way we have, today, zero active
 * external links.
 *
 * data.gouv.fr was measured the same afternoon: 274,850 bytes of
 * server-rendered HTML, no `meta robots`, and description links rendered
 * as `<a href="…">` with no `rel`. The twenty `rel="ugc nofollow
 * noopener"` on that page are in the discussion thread.
 *
 * What is tested here is not the HTTP plumbing. It is the four ways this
 * particular job could do damage.
 */

const report = (over: Partial<ObservatoryReport> = {}): ObservatoryReport => ({
  sampleSize: 297,
  sourceId: 'majestic-2026-10-01',
  sourceLabel: null,
  sourceDate: '2026-10-01',
  lookedAt: 280,
  documentsRead: 106,
  excluded: 0,
  pending: 0,
  refusals: [],
  observations: [],
  lastReadAt: '2026-10-05T00:00:00Z',
  deposit: null,
  ...over
});

const CSV = 'https://lexyflow.com/api/observatory/data.csv';

describe('it cannot publish by accident', () => {
  it('marks the dataset private on creation', () => {
    /**
     * The documentation is explicit: a dataset created through this API
     * is PUBLIC by default. This is the single field standing between a
     * cron firing and our name appearing on a government platform
     * attached to numbers nobody has read.
     */
    expect(dataGouvPayload(report(), CSV)['private']).toBe(true);
  });
});

describe('the link goes where it is followed', () => {
  it('puts the canonical URL in the description', () => {
    // Measured: description links carry no `rel`; discussion links carry
    // `ugc nofollow noopener`. The description is the only place on that
    // page where a link is worth placing.
    expect(String(dataGouvPayload(report(), CSV)['description'])).toContain(CANONICAL_URL);
  });

  it('does not smuggle it into a field that is not prose', () => {
    // The resource URL is our CSV endpoint, not the observatory page.
    // Pointing a "resource" at an HTML page to gain a second link would
    // be a dataset entry that does not contain the dataset.
    const resources = dataGouvPayload(report(), CSV)['resources'] as { url: string }[];
    expect(resources).toHaveLength(1);
    expect(resources[0]!.url).toBe(CSV);
    expect(resources[0]!.url).not.toBe(CANONICAL_URL);
  });
});

describe('what the page claims about the study', () => {
  const text = () => String(dataGouvPayload(report(), CSV)['description']);

  it('carries the three figures with their denominator', () => {
    expect(text()).toContain('106 privacy policies were read, from 280 domains attempted, out of a sample of 297');
  });

  it('names the ranking and its date rather than describing it', () => {
    /**
     * The Zenodo record was corrected once for calling the sample
     * "most-visited" when the ranking measures referring subnets. A
     * description that tells the reader what a ranking measures is a
     * description that can be wrong about it.
     */
    const t = text();
    expect(t).toContain('majestic-2026-10-01');
    expect(t).toContain('2026-10-01');
    expect(t).not.toMatch(/most[- ]visited|most popular|top traffic/i);
  });

  it('keeps refusals in the denominator', () => {
    expect(text()).toContain('Refusals are part of the result');
    expect(text()).toContain('rather than dropped from the denominator');
  });

  it('names no organisation and judges none', () => {
    // The rule that outranks every growth consideration here: we publish
    // what an authority decided, never what we think of a named party.
    expect(text()).toContain('No organisation is named or assessed');
    expect(text()).toContain('may still be lawful');
  });

  it('states the limit of the population', () => {
    expect(text()).toContain('French organisations on other suffixes are absent');
    expect(text()).toContain('not a measure of traffic');
  });

  it('survives a sample whose ranking was never recorded', () => {
    // Null sourceId is a real state — it is how the page behaves before
    // a sample is seeded. The description must not print "undefined" on
    // a public government platform.
    const t = String(dataGouvPayload(report({ sourceId: null }), CSV)['description']);
    expect(t).not.toContain('undefined');
    expect(t).not.toContain('null');
    expect(t).not.toContain('**Population:**');
  });
});

describe('the edition is the idempotency key', () => {
  it('names the quarter, matching the DOI series', () => {
    // Same title as the Zenodo record, so the two platforms describe one
    // artefact rather than looking like two unrelated studies.
    expect(editionTitle(new Date('2026-10-23T00:00:00Z'))).toBe(
      'Privacy policy disclosures across .fr domains (2026-Q4)'
    );
    expect(editionTitle(new Date('2027-01-04T00:00:00Z'))).toBe(
      'Privacy policy disclosures across .fr domains (2027-Q1)'
    );
  });

  it('finds an edition we already deposited', () => {
    const title = editionTitle(new Date('2026-10-23T00:00:00Z'));
    const found = findEdition(
      { data: [{ title: 'something else', id: 'a' }, { title, id: 'abc123', page: 'https://x.invalid/d' }] },
      title
    );
    expect(found).toEqual({ id: 'abc123', page: 'https://x.invalid/d' });
  });

  it('does not match last quarter for this quarter', () => {
    // A looser match would either create a duplicate every quarter or
    // never create a new edition at all.
    const q4 = editionTitle(new Date('2026-10-23T00:00:00Z'));
    const q1 = editionTitle(new Date('2027-01-04T00:00:00Z'));
    expect(findEdition({ data: [{ title: q4, id: 'abc' }] }, q1)).toBeNull();
  });

  it('returns null on a payload it cannot read, rather than "nothing is there"', () => {
    /**
     * The dangerous direction. "I could not read the list" must never
     * become "the list is empty", because the caller's next move is to
     * create a public dataset. `depositToDataGouv` refuses outright when
     * the listing call fails; this covers the case where it succeeds and
     * returns a shape we do not recognise.
     */
    expect(findEdition(null, 'x')).toBeNull();
    expect(findEdition({ unexpected: true }, 'x')).toBeNull();
    expect(findEdition({ data: 'not an array' }, 'x')).toBeNull();
    expect(findEdition({ data: [{ title: 'x' }] }, 'x')).toBeNull(); // no id
    expect(findEdition({ data: [null, 42, 'x'] }, 'x')).toBeNull();
  });
});

describe('the environment is named, never guessed', () => {
  it('refuses when the base is absent, and invents no default', () => {
    /**
     * A fallback to production is one typo away from publishing a
     * sandbox run on a government platform. A fallback to the sandbox is
     * a job that never reaches production while reporting success every
     * quarter. Neither failure announces itself.
     *
     * Behavioural, not a grep for `??` in the source: what matters is
     * that no configuration comes back, whatever the code looks like.
     */
    const r = resolveConfig({ DATAGOUV_API_KEY: 'k' });
    expect(r.config).toBeNull();
    expect(r.refused).toContain('DATAGOUV_BASE is not set');
    expect(r.refused).toContain('no default');
  });

  it('refuses when the key is absent, and says which one', () => {
    // A deposit that silently did not happen is indistinguishable from
    // one nobody looked at.
    const r = resolveConfig({ DATAGOUV_BASE: 'https://demo.data.gouv.fr' });
    expect(r.config).toBeNull();
    expect(r.refused).toContain('DATAGOUV_API_KEY is not set');
  });

  it('refuses an empty environment on the base first', () => {
    expect(resolveConfig({}).refused).toContain('DATAGOUV_BASE');
  });

  it('accepts both and keeps the base it was given', () => {
    // Never rewritten towards production, and never silently swapped.
    const r = resolveConfig({ DATAGOUV_BASE: 'https://demo.data.gouv.fr', DATAGOUV_API_KEY: 'k' });
    expect(r.refused).toBeNull();
    expect(r.config?.base).toBe('https://demo.data.gouv.fr');
  });

  it('tolerates a trailing slash without producing a double slash', () => {
    const r = resolveConfig({ DATAGOUV_BASE: 'https://demo.data.gouv.fr/', DATAGOUV_API_KEY: 'k' });
    expect(r.config?.base).toBe('https://demo.data.gouv.fr');
  });
});

describe('an incomplete listing is not an absent edition', () => {
  it('sees the next page the real platform returns', () => {
    /**
     * Measured against demo.data.gouv.fr on 23 October: the listing
     * answers `{data, next_page, page, page_size, previous_page, total}`.
     * My first version of this client read page one and stopped — which
     * would, on the day the account holds more datasets than fit on a
     * page, create a SECOND public dataset for an edition that already
     * exists. The caller refuses on this rather than paging through:
     * a loud refusal gets fixed, a duplicate on a government platform
     * does not get noticed.
     */
    expect(hasMorePages({ data: [], next_page: 'https://demo.data.gouv.fr/api/1/me/datasets/?page=2' })).toBe(true);
  });

  it('treats a finished listing as finished', () => {
    expect(hasMorePages({ data: [], next_page: null })).toBe(false);
    expect(hasMorePages({ data: [], next_page: '' })).toBe(false);
    expect(hasMorePages({ data: [] })).toBe(false);
  });

  it('does not claim more pages from a shape it cannot read', () => {
    // This one errs towards proceeding, and that is safe only because
    // findEdition and the caller already refuse on an unreadable listing.
    expect(hasMorePages(null)).toBe(false);
    expect(hasMorePages('nonsense')).toBe(false);
  });
});

describe('the licence the platform will actually store', () => {
  /**
   * The twelve ids data.gouv.fr publishes at /api/1/datasets/licenses/,
   * read from demo.data.gouv.fr on 24 October. Recorded rather than
   * guessed, because the first run of this client sent `cc-by-4.0` and
   * the platform stored `notspecified` — silently, with a 200.
   */
  const PLATFORM_LICENCE_IDS = [
    'cc-by', 'cc-by-sa', 'cc-zero', 'fr-lo', 'lov2', 'notspecified',
    'odc-by', 'odc-odbl', 'odc-pddl', 'other-at', 'other-open', 'other-pd'
  ];

  it('sends an id the platform recognises', () => {
    const id = dataGouvPayload(report(), CSV)['license'];
    expect(PLATFORM_LICENCE_IDS).toContain(id);
  });

  it('does not silently publish with no licence at all', () => {
    /**
     * `notspecified` is in the list above and is a valid id, which is
     * exactly why it is dangerous: an unrecognised value lands there
     * with a 200 and nothing says so. The Zenodo record of the same
     * artefact states CC-BY-4.0, so publishing this one unlicensed
     * would be one study with two contradictory statements — and would
     * drop the attribution obligation that is the mechanism by which a
     * reuse points back here.
     */
    expect(dataGouvPayload(report(), CSV)['license']).not.toBe('notspecified');
  });

  it('obliges attribution rather than waiving it', () => {
    // cc-zero and the public-domain ids would let a reuser take the
    // data without naming the source. That is the opposite of why this
    // is published.
    const id = dataGouvPayload(report(), CSV)['license'];
    expect(['cc-zero', 'odc-pddl', 'other-pd', 'other-open']).not.toContain(id);
  });

  it('states the exact version in prose, since the field cannot', () => {
    // The platform's taxonomy is unversioned. The description carries
    // the full URL so the precise licence is still stated somewhere a
    // reader can act on.
    expect(String(dataGouvPayload(report(), CSV)['description'])).toContain(
      'https://creativecommons.org/licenses/by/4.0/'
    );
  });
});

describe('a deleted dataset is not an existing edition', () => {
  const title = editionTitle(new Date('2026-10-23T00:00:00Z'));

  it('skips a row carrying a deletion timestamp', () => {
    /**
     * data.gouv.fr deletes softly. Measured on 24 October: after a
     * DELETE returning 204, the row stayed in /me/datasets/ with
     * `deleted: "2026-10-24T10:16:08.325000+00:00"`, and the next run
     * of this client reported `created: false` against it.
     *
     * Left unhandled, throwing away a bad draft would be irreversible
     * in the direction that matters — the edition could never be
     * deposited again, and the report would say it already had been.
     */
    expect(
      findEdition(
        [{ id: 'gone', title, deleted: '2026-10-24T10:16:08.325000+00:00' }],
        title
      )
    ).toBeNull();
  });

  it('still finds the live one when a deleted one shares its title', () => {
    // The real shape after a delete-and-redeposit: two rows, one dead.
    expect(
      findEdition(
        [
          { id: 'gone', title, deleted: '2026-10-24T10:16:08.325000+00:00' },
          { id: 'live', title, deleted: null, page: 'https://x.invalid/d' }
        ],
        title
      )
    ).toEqual({ id: 'live', page: 'https://x.invalid/d' });
  });

  it('treats an absent or null deleted field as alive', () => {
    expect(findEdition([{ id: 'a', title }], title)?.id).toBe('a');
    expect(findEdition([{ id: 'b', title, deleted: null }], title)?.id).toBe('b');
    expect(findEdition([{ id: 'c', title, deleted: false }], title)?.id).toBe('c');
  });
});

describe('the metadata the platform asks for, and only what we hold', () => {
  it('states the window the readings were taken in', () => {
    /**
     * data.gouv.fr scores metadata completeness and flagged three gaps
     * on the first real deposit: undocumented file, no temporal
     * coverage, no spatial coverage. All three are things we actually
     * hold, so leaving them empty was an omission rather than a
     * limitation.
     */
    expect(dataGouvPayload(report(), CSV)['temporal_coverage']).toEqual({
      start: '2026-10-01',
      end: '2026-10-05'
    });
  });

  it('omits the window rather than inventing an end date', () => {
    // A study still collecting has no end. Printing today's date would
    // assert the reading finished when it has not.
    expect(dataGouvPayload(report({ lastReadAt: null }), CSV)).not.toHaveProperty(
      'temporal_coverage'
    );
  });

  it('omits the window when the sample has no retrieval date either', () => {
    expect(dataGouvPayload(report({ sourceDate: null }), CSV)).not.toHaveProperty(
      'temporal_coverage'
    );
  });

  it('declares France, while the description keeps the distinction', () => {
    /**
     * The coarse field says France; the precise sentence stays in the
     * prose. The population is `.fr` REGISTRATIONS, and a `.fr` domain
     * can be held from outside France — which is why the description
     * states that French organisations on other suffixes are absent.
     */
    expect(dataGouvPayload(report(), CSV)['spatial']).toEqual({
      zones: ['country:fr'],
      granularity: 'country'
    });
    expect(String(dataGouvPayload(report(), CSV)['description'])).toContain(
      'French organisations on other suffixes are absent'
    );
  });

  it('documents the column that stops a reader dividing by the wrong total', () => {
    // `denominator` differs by row: observations are out of documents
    // read, refusals out of domains attempted. 87 of 106 and 87 of 280
    // are different claims about the same number.
    const doc = String(
      (dataGouvPayload(report(), CSV)['resources'] as { description: string }[])[0]!.description
    );
    expect(doc).toContain('denominator');
    expect(doc).toContain('observations are out of the documents actually read');
    expect(doc).toContain('refusals are out of the domains attempted');
  });
});
