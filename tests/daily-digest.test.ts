import { describe, expect, it } from 'vitest';
import { composeDigest, type DigestInput } from '../src/lib/daily-digest';

/**
 * The operational brain.
 *
 * Sentry already covers failures loud enough to throw. This covers the
 * ones this system is actually prone to, and every one of them is
 * silent: a feed that stopped returning items, a review queue nobody
 * opened, a month with no revenue. All three look exactly like a quiet
 * week.
 *
 * So the two properties under test are about trust rather than
 * formatting. It must lead with what needs a decision, and it must
 * never report a number it did not manage to read.
 */

const HEALTHY: DigestInput = {
  auditsCompleted: 4,
  auditsFailed: 0,
  auditsStuck: 0,
  creditsConsumed: 3,
  newOrganizations: 1,
  activeSubscriptions: 2,
  billingMirrorDrift: null,
  corpus: { discovered: 12, extracted: 0, approved: 0, published: 30, rejected: 40 },
  brokenSources: [],
  neverPolledSources: [],
  disabledSources: [],
  barrenSources: [],
  stalledItems: { count: 0, oldestHours: 0 },
  awaitingReview: 0,
  appUrl: 'https://lexyflow.com'
};

describe('a failed query is never printed as a zero', () => {
  it('says unavailable, not 0', () => {
    const digest = composeDigest({ ...HEALTHY, auditsCompleted: null });

    // "0 audits completed" when the query failed teaches the reader to
    // distrust the whole report — and a digest nobody trusts is worse
    // than none, because it still consumes the attention it was built
    // to save.
    expect(digest.text).toContain('Audits completed      unavailable');
    expect(digest.text).not.toContain('Audits completed      0');
  });

  it('names every figure it could not read, in its own section', () => {
    const digest = composeDigest({ ...HEALTHY, creditsConsumed: null, corpus: null });

    expect(digest.text).toContain('COULD NOT BE READ');
    expect(digest.text).toContain('credits consumed');
    expect(digest.text).toContain('corpus');
    expect(digest.text).toContain('These are not zeros');
  });

  it('never calls a degraded report a quiet day', () => {
    const digest = composeDigest({ ...HEALTHY, activeSubscriptions: null });

    expect(digest.quiet).toBe(false);
    expect(digest.subject).toContain('reporting degraded');
    expect(digest.subject).not.toContain('quiet');
  });
});

describe('it leads with what needs a decision', () => {
  it('puts failing feeds first, with the error and where to fix them', () => {
    const digest = composeDigest({
      ...HEALTHY,
      brokenSources: [{ id: 'cnil', error: 'http_404' }]
    });

    expect(digest.text.indexOf('NEEDS YOU')).toBeLessThan(digest.text.indexOf('LAST 24 HOURS'));
    expect(digest.text).toContain('cnil: http_404');
    expect(digest.text).toContain('/en/admin/ops');
    expect(digest.subject).toContain('1 item(s) need you');
  });

  it('separates a source that has never run from one that failed', () => {
    // Different problems. A source that has never been polled has never
    // been proven to work at all — the state four of ours were in for a
    // full day after being seeded, which is why this exists.
    const digest = composeDigest({
      ...HEALTHY,
      neverPolledSources: ['edpb', 'ico']
    });

    expect(digest.text).toContain('never been polled: edpb, ico');
  });

  it('says the queue blocks publication rather than only counting it', () => {
    const digest = composeDigest({ ...HEALTHY, awaitingReview: 3 });

    expect(digest.text).toContain('3 decision(s) waiting for review');
    expect(digest.text).toContain('nothing publishes until you approve them');
    expect(digest.text).toContain('/en/admin/legal-queue');
  });

  it('reports stuck audits as a pattern worth investigating, not just a count', () => {
    const digest = composeDigest({ ...HEALTHY, auditsStuck: 2 });
    expect(digest.text).toContain('the pipeline is failing');
  });

  it('counts every action in the subject so the inbox line is the summary', () => {
    const digest = composeDigest({
      ...HEALTHY,
      brokenSources: [{ id: 'cnil', error: 'http_404' }],
      awaitingReview: 5,
      auditsFailed: 1
    });
    expect(digest.subject).toBe('LexyFlow — 3 item(s) need you');
  });
});

describe('a genuinely quiet day stays short', () => {
  const digest = composeDigest(HEALTHY);

  it('says so plainly instead of manufacturing an action', () => {
    expect(digest.quiet).toBe(true);
    expect(digest.subject).toBe('LexyFlow — quiet day');
    expect(digest.text).toContain('Nothing needs you today.');
    expect(digest.text).not.toContain('NEEDS YOU');
  });

  it('still carries the numbers, because their absence is the signal', () => {
    // A week of "4 audits" followed by a week of "0" is the only way a
    // solo operator sees demand fall off.
    expect(digest.text).toContain('Audits completed      4');
    expect(digest.text).toContain('Active subscriptions  2');
    expect(digest.text).toContain('published 30');
  });
});

describe('a source switched off is not a source that is fine', () => {
  it('names the disabled sources and why', () => {
    // The watcher disables a feed after enough consecutive failures and
    // alerts once. The digest then filtered on `enabled`, so from the next
    // morning the source was simply gone — Italy's Garante went off on 21
    // September and the report kept saying "7 feeds failing" while the
    // real number of regulators we were not watching was nine.
    const digest = composeDigest({
      ...HEALTHY,
      disabledSources: [{ id: 'garante_it', reason: 'Auto-disabled after 5 consecutive failures.' }]
    });

    expect(digest.text).toContain('garante_it');
    expect(digest.text).toContain('Auto-disabled after 5 consecutive failures.');
    expect(digest.quiet).toBe(false);
  });

  it('puts them before the feeds that are merely failing', () => {
    // A failing source is noisy; a disabled one is silent by design, and
    // silence is what this report exists to break.
    const digest = composeDigest({
      ...HEALTHY,
      brokenSources: [{ id: 'anpd_br', error: 'no_items' }],
      disabledSources: [{ id: 'garante_it', reason: 'gone' }]
    });

    expect(digest.text.indexOf('garante_it')).toBeLessThan(digest.text.indexOf('anpd_br'));
  });

  it('says so when it could not read them at all', () => {
    const digest = composeDigest({ ...HEALTHY, disabledSources: null });

    // An unreadable query is never the same as an empty one: reporting no
    // disabled sources because the query failed is the exact mistake this
    // whole section was added to fix.
    expect(digest.text).toContain('switched-off sources');
    expect(digest.quiet).toBe(false);
  });
});

describe('the number that says whether there is a business', () => {
  it('reports a disagreement between Stripe and our own table', () => {
    // The mirror said four. The four rows were one organisation named
    // "Test" holding four Stripe subscription ids — starter, starter, pro
    // and enterprise, all active at once. No organisation can be on three
    // plans, and Stripe had deleted every one of them.
    const digest = composeDigest({
      ...HEALTHY,
      activeSubscriptions: 0,
      billingMirrorDrift: { stripe: 0, mirror: 1 }
    });

    expect(digest.text).toContain('our table says 1 organisation(s) subscribed, Stripe says 0');
    // Access is granted from the mirror, so the gap needs a person: it is
    // either a wrong entitlement or a webhook we never received.
    expect(digest.text).toContain('webhook');
    expect(digest.quiet).toBe(false);
  });

  it('says nothing when the two agree', () => {
    const digest = composeDigest({ ...HEALTHY, billingMirrorDrift: null });

    expect(digest.text).not.toContain('Billing mirror');
  });

  it('prints an unreadable subscription count as unavailable, never as zero', () => {
    // Stripe being unreachable means we do not know how many customers we
    // have. Printing 0 would read as "everyone left".
    const digest = composeDigest({ ...HEALTHY, activeSubscriptions: null });

    expect(digest.text).toContain('Active subscriptions  unavailable');
    expect(digest.text).not.toContain('Active subscriptions  0');
  });
});

describe('a source can be the greenest row on the console and worth nothing', () => {
  it('names sources that poll cleanly and never produce a usable item', () => {
    // ADGM reports "ok, 60" every six hours. All 45 of its classified
    // items were rejected: Abu Dhabi Finance Week, an office opening, a
    // private-equity appointment, a funds framework. `ok` has always meant
    // "items were ingested" and never "the items were worth ingesting" —
    // the same lesson as the `ok` that meant "at least one element" and
    // left the UK green for months on an accessibility skip link.
    const digest = composeDigest({
      ...HEALTHY,
      barrenSources: [{ id: 'adgm_dp_office', rejected: 45 }]
    });

    expect(digest.text).toContain('adgm_dp_office: 45 classified, 0 kept');
    expect(digest.text).toContain('cost a model call each');
    expect(digest.quiet).toBe(false);
  });

  it('says so when the yield could not be read, rather than reporting none', () => {
    const digest = composeDigest({ ...HEALTHY, barrenSources: null });

    expect(digest.text).toContain('source yield');
    expect(digest.quiet).toBe(false);
  });

  it('stays silent when every source has produced something', () => {
    expect(composeDigest({ ...HEALTHY, barrenSources: [] }).text).not.toContain('0 kept');
  });
});

describe('a corpus count is a photograph, not a pulse', () => {
  it('says the extraction has stopped, rather than printing a bigger number', () => {
    // The Anthropic balance ran out on 27 September, extraction stopped,
    // and sixty-seven items piled up behind it — forty from the ICO. For
    // two mornings this digest printed "discovered 32" as a standing
    // figure and led with nothing, while Sentry said it seventy-two
    // times, which is the channel that gets ignored because it repeats.
    const digest = composeDigest({
      ...HEALTHY,
      stalledItems: { count: 67, oldestHours: 52 }
    });

    expect(digest.text).toContain('67 item(s) discovered and never classified');
    expect(digest.text).toContain('52h');
    expect(digest.text).toContain('the extraction pass is not moving them');
    expect(digest.quiet).toBe(false);
  });

  it('stays silent when the queue is draining normally', () => {
    // The extractor takes eight items every six hours, so a burst from a
    // regulator legitimately waits its turn. A warning on a working queue
    // is how a report teaches its reader to skim.
    const digest = composeDigest({ ...HEALTHY, stalledItems: { count: 0, oldestHours: 0 } });
    expect(digest.text).not.toContain('never classified');
  });

  it('says so when it could not measure it', () => {
    const digest = composeDigest({ ...HEALTHY, stalledItems: null });
    expect(digest.text).toContain('stalled items');
    expect(digest.quiet).toBe(false);
  });
});
