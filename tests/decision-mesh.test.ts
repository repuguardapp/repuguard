import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The third strand.
 *
 * The /decisions hub gave each decision one inbound link. Reversing the
 * framework arrow gave it a second, from a prerendered page. Neither
 * made the corpus navigable: 44 decisions all hanging off one hub is a
 * fan, and a crawler that defers the hub defers all of them.
 *
 * Linking decisions to each other turns the fan into a mesh. Measured
 * against production: 42 of the 44 have at least one genuine neighbour,
 * and the rendered lists average 5.6 links — so a crawler entering
 * anywhere can walk most of the corpus without returning to a hub.
 *
 * The other two have no neighbour and render no section. That is the
 * part worth guarding.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = read('src/app/[locale]/decisions/[slug]/page.tsx');
const LIB = read('src/lib/legal-decisions.ts');

describe('decisions point at each other', () => {
  it('renders links to sibling decisions', () => {
    expect(PAGE).toContain('href={`/decisions/${r.slug}`}');
  });

  it('asks for them with the decision it is rendering', () => {
    expect(PAGE).toContain('listRelatedDecisions(decision, params.locale)');
  });
});

describe('relatedness is measured, never filled in', () => {
  it('derives it from cited provisions and the issuing authority', () => {
    /**
     * Both signals come from the decision's own record and both are
     * checkable. Two decisions citing Art. 6 GDPR are about the same
     * obligation whoever issued them; two ICO penalties share a
     * regulator and a procedure. Neither is a guess.
     */
    expect(LIB).toContain("overlaps('articles'");
    expect(LIB).toContain("eq('authority'");
  });

  it('ranks a shared provision above a shared regulator', () => {
    // Filling six rows with "same authority" when one of them actually
    // cites the same article buries the useful link under the padding.
    expect(LIB).toContain('shared(b) - shared(a)');
  });

  it('returns nothing rather than padding the list', () => {
    /**
     * Two of the 44 published decisions have no neighbour at all. A
     * section headed "Enforcement decisions" over an arbitrary pick
     * would be a claim about the law nobody checked, on a page whose
     * entire value is that its claims are checked.
     */
    expect(LIB).toContain('if (reads.length === 0) return [];');
    expect(PAGE).toContain('related && related.length > 0');
  });

  it('never lists the decision on its own page', () => {
    expect(LIB).toContain('shaped.slug !== decision.slug');
  });
});

describe('the authority is never interpolated into a filter', () => {
  it('uses two parameterised reads instead of a built or= expression', () => {
    /**
     * PostgREST's `or=` takes a filter expression as text. `authority`
     * is copied from a regulator's own page and has held commas and
     * parentheses — "Autorité de protection des données (APD)" is one
     * of ours. Interpolated into that expression it stops meaning what
     * it says, silently, and the page fills with the wrong decisions
     * rather than failing.
     *
     * This asserts the shape of the fix, not the absence of a word:
     * the module must not build an `.or(` filter from a template
     * literal anywhere.
     */
    expect(LIB).not.toMatch(/\.or\(\s*`/);
  });

  it('reports a failed read as null, not as an empty corpus', () => {
    // "No related decisions" and "we could not look" are different
    // sentences. The page renders nothing for both, but the log says
    // which happened.
    expect(LIB).toContain("console.error('[legal-decisions] related_failed'");
    expect(LIB).toContain("console.error('[legal-decisions] related_unavailable'");
  });
});
