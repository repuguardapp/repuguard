import type { DigestDelta } from '@/lib/digest-delta';

/**
 * A delta where nothing moved, for suites about something else.
 *
 * `blind: false` on purpose: these suites assert on a report that CAN
 * compare itself with yesterday and found no change. A blind delta is
 * a different report — it prints the full standing lists — and using
 * it here would silently change what the other suites measure.
 */
export function quietDelta(since = '2026-10-22'): DigestDelta {
  return {
    since,
    blind: false,
    sourcesOff: [],
    sourcesBack: [],
    sourcesBroken: [],
    sourcesRecovered: [],
    barrenNew: [],
    barrenGone: [],
    neverPolledNew: [],
    publishedDelta: 0,
    approvedDelta: 0
  };
}

/**
 * A delta with nothing to compare against.
 *
 * The state of the first ever report, and of any morning the snapshot
 * could not be read. The composer then prints the full standing lists
 * rather than a diff — so this is the fixture for suites that assert
 * "a switched-off source is named with its reason", which is still the
 * rule and is still what a reader sees the first time it happens.
 */
export function blindDelta(): DigestDelta {
  return { ...quietDelta(), since: null, blind: true };
}
