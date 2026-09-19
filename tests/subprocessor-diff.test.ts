import { describe, expect, it } from 'vitest';
import { comparisonKey, diffSubprocessors, suspectExtraction, type Entry } from '@/lib/subprocessor-diff';

/**
 * A DPO acts on what comes out of this function.
 *
 * An added sub-processor in a third country means reassessing a transfer
 * under Article 44; a removed one means a contract question. If the diff is
 * wrong, somebody does real work for nothing — or does not do work they
 * owed. Every test here is about not being wrong in the expensive direction.
 */

const e = (name: string, country?: string): Entry => ({ name, country: country ?? null });

describe('what counts as a change', () => {
  it('reports an addition with the name exactly as the vendor printed it', () => {
    const { changes } = diffSubprocessors([e('Amazon Web Services, Inc.')], [
      e('Amazon Web Services, Inc.'),
      e('Twilio Inc.', 'United States')
    ]);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.change).toBe('added');
    // Not a cleaned-up version of it. The fact is what they wrote.
    expect(changes[0]?.entity.name).toBe('Twilio Inc.');
    expect(changes[0]?.entity.country).toBe('United States');
  });

  it('puts additions before removals', () => {
    // A new sub-processor is what creates work under Article 28(2). A reader
    // should meet it before the housekeeping.
    const { changes } = diffSubprocessors(
      [e('Alpha'), e('Beta'), e('Gamma')],
      [e('Alpha'), e('Delta')]
    );
    expect(changes[0]?.change).toBe('added');
  });

  it('does not treat a re-spelled company name as a removal plus an addition', () => {
    // Vendors write "Amazon Web Services, Inc." and then "Amazon Web
    // Services Inc" six months later, and nothing has changed. Two false
    // notifications would bury the real ones.
    const { changes } = diffSubprocessors(
      [e('Amazon Web Services, Inc.'), e('Stripe Payments Europe, Ltd.')],
      [e('Amazon Web Services Inc'), e('Stripe Payments Europe Limited')]
    );
    expect(changes).toEqual([]);
  });

  it('normalises accents and punctuation but never reports the normalised form', () => {
    expect(comparisonKey('Société Générale S.A.')).toBe(comparisonKey('Societe Generale SA'));
  });
});

describe('what it refuses to report', () => {
  it('says nothing on the first observation', () => {
    // Announcing forty additions on the day we started watching would be
    // announcing our own arrival as news.
    const { changes, refused } = diffSubprocessors(null, [e('Alpha'), e('Beta')]);
    expect(changes).toEqual([]);
    expect(refused).toBe('first observation');
  });

  it('never turns an empty extraction into forty removals', () => {
    /**
     * The failure that would end this feature. A vendor redesigns its page,
     * extraction returns nothing, and we tell five hundred DPOs that their
     * processor dropped every sub-processor it had. Every one of them would
     * act on it, and every one would be acting on our bug.
     *
     * A vendor that genuinely removed all of them would be extraordinary; a
     * page redesign is ordinary. We assume the ordinary explanation.
     */
    const before = Array.from({ length: 40 }, (_, i) => e(`Processor ${i}`));
    const { changes, refused } = diffSubprocessors(before, []);

    expect(changes).toEqual([]);
    expect(refused).toBe('extraction returned nothing');
  });

  it('holds a mass disappearance for review instead of sending it', () => {
    // Missing a real removal for a day costs a notification. Inventing
    // twenty costs the product. The asymmetry is deliberate.
    const before = Array.from({ length: 20 }, (_, i) => e(`Processor ${i}`));
    const after = before.slice(0, 5);

    const { changes } = diffSubprocessors(before, after);
    expect(changes).toHaveLength(15);
    expect(changes.every((c) => c.reviewRequired)).toBe(true);
  });

  it('lets an ordinary removal through on a small list', () => {
    // A list of three that becomes two is not suspicious, and a proportional
    // rule alone would flag every small vendor for ever.
    const { changes } = diffSubprocessors([e('Alpha'), e('Beta'), e('Gamma')], [e('Alpha'), e('Beta')]);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.change).toBe('removed');
    expect(changes[0]?.reviewRequired).toBe(false);
  });

  it('lets a single removal through on a long list', () => {
    const before = Array.from({ length: 30 }, (_, i) => e(`Processor ${i}`));
    const { changes } = diffSubprocessors(before, before.slice(1));
    expect(changes).toHaveLength(1);
    expect(changes[0]?.reviewRequired).toBe(false);
  });
});

describe('an extraction that should not be compared at all', () => {
  it('rejects an empty result', () => {
    expect(suspectExtraction([], 12)).toBe('no entries extracted');
  });

  it('rejects names that cannot be companies', () => {
    // A heading, a table caption, a cookie banner button.
    expect(suspectExtraction([e('A'), e('Stripe Inc.')], 4)).toContain('implausible');
  });

  it('rejects a collapse in the number of entries', () => {
    // Two entries from a page that had forty is not a list; it is a parse
    // that found the navigation menu.
    expect(suspectExtraction([e('Alpha'), e('Beta')], 40)).toContain('fell from 40 to 2');
  });

  it('accepts a plausible list', () => {
    expect(suspectExtraction([e('Amazon Web Services, Inc.'), e('Twilio Inc.')], 2)).toBeNull();
  });

  it('does not apply the proportional rule to a short list', () => {
    // Three entries becoming two is a 33% fall and entirely ordinary.
    expect(suspectExtraction([e('Alpha'), e('Beta')], 3)).toBeNull();
  });
});
