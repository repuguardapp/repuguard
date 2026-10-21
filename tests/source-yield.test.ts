import { describe, expect, it } from 'vitest';
import { BARREN_MIN_CLASSIFIED, barrenSources, type ClassifiedRow } from '@/lib/source-yield';

/**
 * One source, two lists, two different asks.
 *
 * The 21 October digest reported `adgm_dp_office` twice: among the nine
 * sources switched off, and among the four polling cleanly for nothing.
 * The comment beside the health buckets promises the opposite —
 *
 *   "Each source appears in exactly one bucket: a disabled source is not
 *    also reported as failing, or the list doubles and stops being read."
 *
 * — and it held for those three buckets, which filter on `enabled`. The
 * yield list did not: it was tallied from legal_developments, which
 * carries no such flag.
 *
 * The overlap is a defect rather than a duplicate because the two lists
 * ask for different things. A disabled source needs a decision: repair
 * the URL or drop the jurisdiction. A barren one is money — a model call
 * per item, for nothing. A source already switched off costs nothing, so
 * it has no business in the second list.
 */

const rejected = (source_id: string, n: number): ClassifiedRow[] =>
  Array.from({ length: n }, () => ({ source_id, status: 'rejected' }));

const kept = (source_id: string, n: number): ClassifiedRow[] =>
  Array.from({ length: n }, () => ({ source_id, status: 'published' }));

describe('a switched-off source is not also billed as a live cost', () => {
  it('leaves it out even with a damning record', () => {
    // adgm_dp_office: 45 classified, 0 kept, and switched off on yield
    // the same morning. Reporting it again under "costs a model call
    // each" is reporting a cost that stopped.
    const rows = [...rejected('adgm_dp_office', 45), ...rejected('aepd_es', 14)];
    const enabled = new Set(['aepd_es']);

    expect(barrenSources(rows, enabled)).toEqual([{ id: 'aepd_es', rejected: 14 }]);
  });

  it('still reports the ones that are on', () => {
    // The fix must not empty the list. Spain's AEPD is the live case
    // this was protecting: a major EU regulator, 14 classified, 0 kept.
    const rows = rejected('aepd_es', 14);
    expect(barrenSources(rows, new Set(['aepd_es']))).toHaveLength(1);
  });
});

describe('it refuses rather than guesses', () => {
  it('returns null when the source table could not be read', () => {
    /**
     * Not an empty filter and not an unfiltered list. "We could not
     * read which sources are on" is not "none are on", and it is not
     * "all are on" either — the second guess is precisely what produced
     * the double count. The digest already knows how to print
     * "unavailable", and that is the honest word here.
     */
    expect(barrenSources(rejected('aepd_es', 14), null)).toBeNull();
  });

  it('returns null when the corpus could not be read', () => {
    expect(barrenSources(null, new Set(['aepd_es']))).toBeNull();
  });

  it('is not the same as reporting nothing', () => {
    // An empty array means "every live source produced something".
    // null means "we cannot tell". The digest prints them differently.
    expect(barrenSources([], new Set(['aepd_es']))).toEqual([]);
  });
});

describe('the sample has to be worth believing', () => {
  it('ignores a source with too few classified items', () => {
    // Three rejections in a row is a quiet fortnight at a regulator,
    // not a verdict on the feed.
    const rows = rejected('ppc_jp', BARREN_MIN_CLASSIFIED - 1);
    expect(barrenSources(rows, new Set(['ppc_jp']))).toEqual([]);
  });

  it('spares a source that kept even one item', () => {
    // Barren means nothing survived extraction, not that most of it
    // was rejected. A feed that yields one real decision in forty is
    // noisy; it is not worthless, and switching it off loses the one.
    const rows = [...rejected('mtcit_om', 40), ...kept('mtcit_om', 1)];
    expect(barrenSources(rows, new Set(['mtcit_om']))).toEqual([]);
  });

  it('counts anything not rejected as kept, including items still moving', () => {
    // `approved` and `published` are both evidence the source works.
    const rows = [...rejected('ico_uk', 30), { source_id: 'ico_uk', status: 'approved' }];
    expect(barrenSources(rows, new Set(['ico_uk']))).toEqual([]);
  });

  it('puts the worst offender first, so a long list is still readable', () => {
    const rows = [...rejected('a', 10), ...rejected('b', 45), ...rejected('c', 20)];
    const out = barrenSources(rows, new Set(['a', 'b', 'c']));
    expect(out?.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });
});
