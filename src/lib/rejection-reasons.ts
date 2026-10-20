/**
 * The reasons the code writes when it deletes something itself.
 *
 * Shared because they are read in two places that must not drift. The
 * extraction route writes them; the daily digest names a rule-written
 * rejection in the report and merely counts a model-written one, because
 * four off-topic press releases a day would bury the one line that
 * matters.
 *
 * The digest used to recognise them by two string literals copied into
 * its classifier. Adding a third rule there is a one-line edit nobody is
 * forced to make, and forgetting it does not break anything: the new
 * rule's deletions are simply filed as "off topic" and never named
 * again. A rule that removes decisions without a human and reports
 * itself as routine noise is the exact failure the digest exists to
 * catch — so the list lives here, both sides read it, and a test asserts
 * that every reason in it is recognised.
 */

/**
 * The dedup rule. Variable suffix — it names the twin — so only the
 * prefix is fixed.
 *
 * This is the rule that rejected a £190,000 ICO penalty against Elderly
 * Aids Limited as a duplicate of the enforcement notice beside it, by
 * matching two documents on two ABSENT amounts, and wrote a sentence
 * explaining itself. Nobody looked for a month.
 */
export const DUPLICATE_PREFIX = 'duplicate of ';

/**
 * More respondents than `entity` can hold.
 *
 * The operator's own wording, kept verbatim: he made this call three
 * times by hand on three ICO prosecutions that each concerned two people
 * and arrived carrying one name.
 */
export const MULTIPLE_PARTIES_REASON =
  'la décision vise plusieurs parties, une seule est nommée — publier ce nom seul lui attribuerait ce que le régulateur a attribué à plusieurs';

/**
 * The named party is a human being, not an organisation.
 *
 * Two reached the review queue on 20 October — `Bharat Singh Chand`,
 * whose own summary calls him "a self-employed lead generator", and
 * `Darian Bishop trading as ECO4U`, a sole trader — and three more had
 * already been rejected by hand.
 *
 * WHY THIS IS A CATEGORICAL EXCLUSION AND NOT A JUDGEMENT CALL
 *
 * We sell compliance audits to organisations and we publish what an
 * authority decided about an organisation. A page headed with a private
 * individual's name and the word "fine", in seven languages, indexed, is
 * a different product that nobody asked us to build: it is the
 * publication of an offence by a named natural person, which makes us
 * the controller of exactly the processing our own customers hire us to
 * get right.
 *
 * It is also outside the corpus by its own logic. A sole trader's PECR
 * penalty for cold calls teaches no reader anything about the privacy
 * policy they came here to have audited.
 *
 * The model reports the one fact; the code draws the conclusion. Asking
 * a model "should this be published?" is asking it to hold our policy.
 * Asking it "is the named party a person?" is asking it to read.
 */
export const NATURAL_PERSON_REASON =
  "la décision vise une personne physique — nous publions ce qu'une autorité a décidé contre une organisation, jamais le nom d'un particulier";

/**
 * Every prefix the machine writes. A full reason starts with itself, so
 * the two fixed sentences serve as their own prefixes.
 */
export const RULE_REASON_PREFIXES: readonly string[] = [
  DUPLICATE_PREFIX,
  MULTIPLE_PARTIES_REASON,
  NATURAL_PERSON_REASON
];

/** True when this rejection was written by a rule rather than a model or a person. */
export function isRuleWritten(reason: string): boolean {
  return RULE_REASON_PREFIXES.some((prefix) => reason.startsWith(prefix));
}
