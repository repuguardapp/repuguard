/**
 * What changed between two published sub-processor lists.
 *
 * This is the whole product in one function, and it is deliberately not
 * clever. A DPO acts on what comes out of here: an added sub-processor in a
 * third country means reassessing a transfer, and a removed one means a
 * contract question. If this function is wrong, somebody does real work for
 * nothing — or, worse, does not do work they owed.
 *
 * SO NOTHING HERE IS GENERATED.
 *
 * A change exists when two fetches produced different documents and the
 * lists extracted from them differ. No model decides that something
 * changed; a model is only ever used upstream, to read a table out of a
 * page, and its output is compared, never trusted to describe itself.
 *
 * THE FAILURE THAT WOULD END THIS FEATURE
 *
 * A vendor redesigns its page. Extraction returns nothing. Naively, that is
 * forty removals — and we tell five hundred DPOs that their processor
 * dropped every sub-processor it had. Every one of them would act on it,
 * and every one would be acting on our bug.
 *
 * An empty extraction is therefore never a change. A large disappearance is
 * held for review rather than published. The asymmetry is deliberate:
 * missing a real removal for a day costs a notification; inventing forty
 * costs the product.
 */

export interface Entry {
  /** Exactly as printed in the source. Never normalised for display. */
  name: string;
  country?: string | null;
  purpose?: string | null;
}

export interface Change {
  change: 'added' | 'removed';
  entity: Entry;
  /** True when the change is too large to publish without a human looking. */
  reviewRequired: boolean;
}

export interface DiffResult {
  changes: Change[];
  /** Set when the whole comparison is untrustworthy; no change is published. */
  refused: string | null;
}

/**
 * Below this many entries, proportional rules mean nothing.
 *
 * A list of three that becomes a list of one is a 67% drop and may be
 * entirely genuine. The absolute floor stops the percentage rule from
 * flagging every small vendor.
 */
const SMALL_LIST = 8;

/** A disappearance of more than this share of a list is not published unreviewed. */
const SUSPICIOUS_REMOVAL_RATIO = 0.4;

/**
 * Compare on a normalised key, report the source's own spelling.
 *
 * Vendors write "Amazon Web Services, Inc.", then "Amazon Web Services Inc"
 * six months later, and nothing has changed. Treating that as a removal plus
 * an addition would send two false notifications and bury the real ones.
 *
 * The normalisation is only ever a comparison key. What a customer reads is
 * the string the vendor published, because that is the fact.
 */
export function comparisonKey(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      // Dots go BEFORE the suffix rule, not after.
      //
      // Written the other way round, "S.A." tokenised as "s" and "a" and
      // never matched \bsa\b, so "Société Générale S.A." and "Societe
      // Generale SA" produced different keys — a removal and an addition,
      // twice a year, for every vendor that writes its form with stops.
      // Found by its own test.
      .replace(/\./g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      // Corporate suffixes, which vendors add and drop without meaning it.
      .replace(
        /\b(inc|llc|ltd|limited|gmbh|sarl|sas|sa|bv|nv|ag|plc|co|corp|corporation|company|pty|pte|kk|srl|spa|oy|ab)\b/g,
        ''
      )
      .replace(/\s+/g, '')
      .trim()
  );
}

export function diffSubprocessors(
  before: readonly Entry[] | null,
  after: readonly Entry[]
): DiffResult {
  // The first observation of a list is not a change. There is nothing to
  // compare it to, and announcing forty additions on the day we started
  // watching would be announcing our own arrival as news.
  if (before === null) return { changes: [], refused: 'first observation' };

  // An empty extraction is a broken parse until proven otherwise. A vendor
  // that genuinely removed every sub-processor would be extraordinary; a
  // page redesign is ordinary. We assume the ordinary explanation and say
  // so, rather than publishing the extraordinary one.
  if (after.length === 0 && before.length > 0) {
    return { changes: [], refused: 'extraction returned nothing' };
  }

  const beforeByKey = new Map<string, Entry>();
  for (const entry of before) {
    const key = comparisonKey(entry.name);
    if (key) beforeByKey.set(key, entry);
  }

  const afterByKey = new Map<string, Entry>();
  for (const entry of after) {
    const key = comparisonKey(entry.name);
    if (key) afterByKey.set(key, entry);
  }

  const added: Entry[] = [];
  const removed: Entry[] = [];

  for (const [key, entry] of afterByKey) {
    if (!beforeByKey.has(key)) added.push(entry);
  }
  for (const [key, entry] of beforeByKey) {
    if (!afterByKey.has(key)) removed.push(entry);
  }

  // A large disappearance is the signature of a parse that broke, not of a
  // vendor housekeeping. Held for a human rather than sent.
  const ratio = beforeByKey.size > 0 ? removed.length / beforeByKey.size : 0;
  const massRemoval =
    beforeByKey.size >= SMALL_LIST && ratio > SUSPICIOUS_REMOVAL_RATIO;

  return {
    changes: [
      // Additions first: a new sub-processor is the one that creates work
      // under Article 28(2), and a reader should meet it before the
      // housekeeping.
      ...added.map((entity) => ({ change: 'added' as const, entity, reviewRequired: false })),
      ...removed.map((entity) => ({
        change: 'removed' as const,
        entity,
        reviewRequired: massRemoval
      }))
    ],
    refused: null
  };
}

/**
 * Is this snapshot worth comparing at all?
 *
 * Called before the diff, on the extraction itself. A list of two entries
 * from a page that had forty is not a list; it is a parse that found the
 * navigation menu.
 */
export function suspectExtraction(
  entries: readonly Entry[],
  previousCount: number | null
): string | null {
  if (entries.length === 0) return 'no entries extracted';

  // Names that are obviously not companies: a heading, a table caption, a
  // cookie banner button. Cheap and catches the common breakages.
  const junk = entries.filter((e) => e.name.trim().length < 2 || e.name.length > 200);
  if (junk.length > 0) return `${junk.length} entries with implausible names`;

  if (previousCount !== null && previousCount >= SMALL_LIST) {
    const ratio = entries.length / previousCount;
    if (ratio < 0.5) return `entry count fell from ${previousCount} to ${entries.length}`;
  }

  return null;
}
