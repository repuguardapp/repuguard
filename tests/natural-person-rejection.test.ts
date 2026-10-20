import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_PREFIX,
  MULTIPLE_PARTIES_REASON,
  NATURAL_PERSON_REASON,
  RULE_REASON_PREFIXES,
  isRuleWritten
} from '@/lib/rejection-reasons';

/**
 * Two human beings reached the review queue.
 *
 * `Bharat Singh Chand`, whose own extracted summary calls him "a
 * self-employed lead generator", carrying a £200,000 ICO fine. And
 * `Darian Bishop trading as ECO4U`, a sole trader, with no evidence at
 * all. Three more had already been removed by hand — Munro, Okparavero,
 * Manjra — so the operator had been the filter five times, item by item,
 * with nothing in the pipeline able to tell a company from a person.
 *
 * Publishing either would have produced a page headed with a private
 * individual's name and the word "fine", in seven languages, indexed.
 * That is not our corpus and it is not our product; the full reasoning
 * is on NATURAL_PERSON_REASON.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const EXTRACT = read('src/app/api/cron/extract-legal/route.ts');
const DIGEST = read('src/app/api/cron/daily-digest/route.ts');

describe('the pipeline asks whether the party is a person', () => {
  it('asks for the fact, and requires it in the tool schema', () => {
    expect(EXTRACT).toContain('entity_is_a_person: absent(z.boolean())');
    expect(EXTRACT).toContain('entity_is_a_person: {');
  });

  it('tells the model what a person is, including the trading-name case', () => {
    // `Darian Bishop trading as ECO4U` reads like a company and is a
    // man. Without the example the question is answerable either way.
    expect(EXTRACT).toContain('trading as');
    expect(EXTRACT).toContain('sole trader');
  });

  it('asks the model to read, and decides in code', () => {
    /**
     * The model reports one fact off the page; the rule is ours. Asking
     * a model "should this be published?" is asking it to hold our
     * policy, which is how a policy becomes whatever the model felt
     * that morning.
     */
    expect(EXTRACT).toContain('if (out.entity_is_a_person === true)');
    expect(EXTRACT).toContain('rejected_reason: NATURAL_PERSON_REASON');
  });

  it('rejects before deriving a label or hunting for a twin', () => {
    // A record we will never publish does not need its outcome
    // corrected, and leaving it in the pipeline spends a review slot.
    const personCheck = EXTRACT.indexOf('out.entity_is_a_person === true');
    const twinLookup = EXTRACT.indexOf('await findTwin(');
    expect(personCheck).toBeGreaterThan(0);
    expect(twinLookup).toBeGreaterThan(personCheck);
  });
});

describe('a new rule cannot escape the digest', () => {
  it('classifies every reason the code writes as rule-written', () => {
    /**
     * This is the assertion the file exists for.
     *
     * The digest named a rule-written rejection and merely counted a
     * model-written one, recognising the rules by two string literals
     * copied into its classifier. Adding a third rule there is a
     * one-line edit nobody is forced to make, and forgetting it breaks
     * nothing visible: the new rule's deletions are filed as "off
     * topic", counted among four routine press releases a day, and
     * never named again.
     *
     * That is how a £190,000 penalty against Elderly Aids Limited left
     * the corpus for a month. The rule that did it wrote a sentence
     * explaining itself and the sentence went nowhere.
     */
    for (const reason of RULE_REASON_PREFIXES) {
      expect(isRuleWritten(reason), reason).toBe(true);
    }
    expect(isRuleWritten(`${DUPLICATE_PREFIX}some-other-slug (same authority)`)).toBe(true);
  });

  it('reads the list instead of copying it', () => {
    expect(DIGEST).toContain('isRuleWritten(reason)');
    // The literals must be gone, or the list is decoration.
    expect(DIGEST).not.toContain("reason.startsWith('duplicate of ')");
    expect(DIGEST).not.toContain('la décision vise plusieurs parties');
  });

  it('holds all three rules the code can write', () => {
    // A rule whose reason is not in this list is invisible to the
    // report. If a fourth is added, it belongs here.
    expect(RULE_REASON_PREFIXES).toHaveLength(3);
    expect(RULE_REASON_PREFIXES).toContain(MULTIPLE_PARTIES_REASON);
    expect(RULE_REASON_PREFIXES).toContain(NATURAL_PERSON_REASON);
  });

  it('does not claim a model rejection was ours', () => {
    // The other direction matters too: counting the model's off-topic
    // rejections as rule-written would print four press releases by
    // name every morning and bury the one line that matters.
    expect(isRuleWritten('not a data protection matter')).toBe(false);
    expect(isRuleWritten('')).toBe(false);
  });
});

describe('the reason says what happened, not what we think of the person', () => {
  it('states the category, not a verdict', () => {
    /**
     * "We publish what an authority decided against an organisation,
     * never the name of a private individual" is a statement about our
     * corpus. Anything describing the person would be a judgement on a
     * named third party, which is the one thing this project does not
     * do — and it would be written into a database row about a man who
     * never asked to be in it.
     */
    expect(NATURAL_PERSON_REASON).toContain('personne physique');
    expect(NATURAL_PERSON_REASON).toContain('organisation');
    expect(NATURAL_PERSON_REASON).not.toMatch(/coupable|non conforme|fraude/i);
  });
});
