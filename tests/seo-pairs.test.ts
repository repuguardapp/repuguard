import { describe, expect, it } from 'vitest';
import { FRAMEWORKS, type FrameworkId } from '@/lib/legal-frameworks';
import { CURATED_PAIRS, relatedFrameworks } from '@/lib/seo-routes';

/**
 * The comparison pairs decide how many pages this site has.
 *
 * Each one generates seven routes, one per locale, and the corpus of
 * comparison pages is the only part of this product Google has ever chosen
 * to index — not the GDPR pages everyone writes, but
 * /fr/compare/oman_pdpl-vs-uae_pdpl and /ar/compare/appi-vs-gdpr.
 *
 * The file's own comment claimed a total of 38 while the function built 30,
 * and had done through at least two edits to the list. A stale number in a
 * comment is not a small thing here, so the rules are asserted instead of
 * described.
 */

const GCC: readonly FrameworkId[] = [
  'qatar_pdppl',
  'saudi_pdpl',
  'uae_pdpl',
  'bahrain_pdpl',
  'kuwait_dppr',
  'oman_pdpl'
];

const has = (a: FrameworkId, b: FrameworkId) =>
  CURATED_PAIRS.includes([a, b].sort().join('-vs-'));

describe('which comparisons exist', () => {
  it('pairs GDPR with every other framework', () => {
    for (const f of FRAMEWORKS) {
      if (f.id === 'gdpr') continue;
      expect(has('gdpr', f.id), `gdpr vs ${f.id} missing`).toBe(true);
    }
  });

  it('pairs every Gulf regime with every other', () => {
    for (let i = 0; i < GCC.length; i += 1) {
      for (let j = i + 1; j < GCC.length; j += 1) {
        expect(has(GCC[i]!, GCC[j]!), `${GCC[i]} vs ${GCC[j]} missing`).toBe(true);
      }
    }
  });

  it('answers "there are three data protection laws in the UAE, which am I under?"', () => {
    // The question anyone setting up in Dubai or Abu Dhabi has to settle
    // first, and the one our audit form deliberately refuses to guess.
    expect(has('difc_dp', 'uae_pdpl')).toBe(true);
    expect(has('adgm_dp', 'uae_pdpl')).toBe(true);
    expect(has('difc_dp', 'adgm_dp')).toBe(true);
  });

  it('holds no pair naming a framework that does not exist', () => {
    // A curated pair referencing a removed id would generate seven pages
    // that render nothing, in seven languages, in the sitemap.
    const ids = new Set(FRAMEWORKS.map((f) => f.id as string));
    for (const pair of CURATED_PAIRS) {
      for (const id of pair.split('-vs-')) {
        expect(ids.has(id), `${pair} names unknown framework ${id}`).toBe(true);
      }
    }
  });

  it('never pairs a framework with itself, and lists each pair once', () => {
    expect(new Set(CURATED_PAIRS).size).toBe(CURATED_PAIRS.length);
    for (const pair of CURATED_PAIRS) {
      const [a, b] = pair.split('-vs-');
      expect(a).not.toBe(b);
    }
  });
});

describe('what a reader is offered next', () => {
  it('sends a DIFC reader to the other two Emirati regimes before Oman', () => {
    const related = relatedFrameworks('difc_dp', 4).map((f) => f.id);
    expect(related).toContain('uae_pdpl');
    expect(related).toContain('adgm_dp');
  });

  it('still sends a Gulf reader around the Gulf', () => {
    expect(relatedFrameworks('oman_pdpl', 4).map((f) => f.id)).toContain('saudi_pdpl');
  });
});
