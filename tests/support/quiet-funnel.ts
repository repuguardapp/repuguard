import type { Funnel, FunnelWindow } from '@/lib/funnel';

/**
 * A funnel where nothing happened, for tests about something else.
 *
 * Shared rather than copied into each fixture: three suites broke the
 * day `funnel` was added to DigestInput, which is the type system doing
 * exactly what it should — a new category of blind spot cannot be
 * silently left out of a report whose purpose is naming them. One place
 * to update keeps that signal useful instead of tedious.
 *
 * All zeros rather than nulls: zeros are a readable quiet day, and these
 * suites assert on quiet days. A null would put "funnel" in the COULD
 * NOT BE READ block and change what they are measuring.
 */
const EMPTY: FunnelWindow = {
  scanAsked: 0,
  scanRead: 0,
  account: 0,
  audit: 0,
  paid: 0
};

export function quietFunnel(): Funnel {
  return {
    day: { ...EMPTY },
    sinceOutreach: { ...EMPTY },
    allTime: { ...EMPTY },
    outreachFrom: '2026-10-16'
  };
}
