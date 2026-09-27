import { describe, expect, it } from 'vitest';
import { fairShare } from '@/lib/fair-share';

/**
 * Oman arrived and took the whole extraction queue.
 *
 * Its sitemap holds 169 URLs under the ministry's newsroom prefix, the
 * poller takes 40 a run, and at eight extractions every six hours that is
 * five days during which every ICO reprimand and CNIL sanction waits
 * behind a logistics day and a programming contest. Nothing was broken —
 * newest-first is a reasonable policy and those items really were the
 * newest — but a source with a large backlog and no yield could starve
 * the sources that produce everything we publish.
 */

const rows = (...spec: [string, number][]) =>
  spec.flatMap(([source_id, n]) =>
    Array.from({ length: n }, (_, i) => ({ source_id, id: `${source_id}-${i}` }))
  );

describe('one noisy source cannot take the whole budget', () => {
  it('leaves room for every source that has something waiting', () => {
    const picked = fairShare(rows(['mtcit_om', 24], ['ico', 2], ['cnil', 1]), 8);

    const sources = new Set(picked.map((r) => r.source_id));
    expect(sources).toEqual(new Set(['mtcit_om', 'ico', 'cnil']));
    expect(picked).toHaveLength(8);
    // Oman still gets the largest share, because it has the most waiting
    // — it simply cannot have all of it.
    expect(picked.filter((r) => r.source_id === 'mtcit_om')).toHaveLength(5);
  });

  it('keeps newest-first within a source', () => {
    // The order the query returned is the order each source is drained
    // in; the round-robin decides whether a source goes, not which of its
    // items goes next.
    const picked = fairShare(rows(['ico', 3]), 3);
    expect(picked.map((r) => r.id)).toEqual(['ico-0', 'ico-1', 'ico-2']);
  });

  it('gives the freshest source the first slot', () => {
    // Map insertion order follows the newest-first list, so the source
    // holding the most recent item is served first in each pass.
    const picked = fairShare(rows(['cnil', 1], ['mtcit_om', 5]), 2);
    expect(picked[0]!.source_id).toBe('cnil');
  });

  it('spends the whole budget when one source has everything', () => {
    // Fairness must not become idleness: with a single source waiting it
    // still takes the full eight.
    expect(fairShare(rows(['mtcit_om', 24]), 8)).toHaveLength(8);
  });

  it('takes everything when there is less than the budget', () => {
    expect(fairShare(rows(['ico', 2], ['cnil', 1]), 8)).toHaveLength(3);
  });

  it('returns nothing from an empty queue without looping for ever', () => {
    expect(fairShare([], 8)).toEqual([]);
  });
});
