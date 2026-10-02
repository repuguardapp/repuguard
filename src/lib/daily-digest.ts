/**
 * The daily state of the business, composed from facts.
 *
 * Deliberately NOT `server-only`: this module touches no database, no
 * secret and no request. It turns numbers into words, which is exactly
 * the part worth testing without a database — and the part where the
 * one rule that matters lives.
 *
 * Pillar three of Jarvis. Sentry already emails when something throws;
 * that covers the failures loud enough to raise their hand. It says
 * nothing about the failures this system is actually prone to — a feed
 * that quietly stopped returning items, a review queue nobody opened,
 * an audit that spent a credit and produced nothing, a month with no
 * revenue. Those look identical to a quiet week.
 *
 * So the digest leads with what needs a decision and puts the numbers
 * underneath. A report that opens with vanity metrics gets skimmed;
 * one that opens with "two feeds are dead" gets read.
 *
 * The composition is kept pure and separate from the route so the one
 * thing that matters — that it never reports health it has not
 * verified — can be tested without a database.
 */

export interface DigestInput {
  /** null means the query failed, and is reported as such. */
  auditsCompleted: number | null;
  auditsFailed: number | null;
  auditsStuck: number | null;
  creditsConsumed: number | null;
  newOrganizations: number | null;
  /**
   * Active subscriptions according to STRIPE, which is the system of
   * record. Our `subscriptions` table is an echo of it written by a
   * webhook, and an echo can be wrong in the direction that flatters us.
   *
   * It was. The line read "Active subscriptions 4" every morning, and the
   * four rows were one organisation named "Test" holding four Stripe
   * subscription ids from 14-15 May — starter, starter, pro and
   * enterprise, all "active" at once, all with a null period end. No
   * organisation can be on three plans simultaneously. Stripe had the
   * subscriptions deleted; nothing told our table, so it went on
   * reporting them for four months.
   *
   * This is the one number in the digest that answers "is there a
   * business". Taking it from a mirror that only ever receives good news
   * is how a founder reads four customers into zero.
   */
  activeSubscriptions: number | null;
  /**
   * Set only when Stripe and our mirror disagree.
   *
   * Worth its own action rather than a silent correction: the app grants
   * access from the mirror, so a gap is a customer with the wrong
   * entitlement in one direction or a missed webhook in the other. Null
   * when they agree, or when either could not be read — a disagreement we
   * could not measure is not a disagreement we may report.
   */
  billingMirrorDrift: { stripe: number; mirror: number } | null;
  /** Legal-watch corpus, by status. */
  corpus: Record<string, number> | null;
  /** Sources whose last poll did not succeed, with their error. */
  brokenSources: { id: string; error: string | null }[] | null;
  /**
   * Sources the watcher switched off, with the reason it gave.
   *
   * Reported because switching a source off is what makes it disappear.
   * The watcher disables a feed after enough consecutive failures and
   * alerts once, which is right — four alerts a day for a regulator that
   * withdrew its RSS is how an alerting channel stops being read. But the
   * digest then filtered on `enabled`, so from the next morning the source
   * was simply absent, and "7 feeds failing" read as though everything
   * else was fine. Italy's Garante went off that way on 21 September —
   * a verified source, a G7 regulator we sell GDPR audits against — and
   * nothing would have mentioned it again. The EDPS had been gone since
   * the 17th. Nine regulators were unwatched and the report said seven.
   *
   * A source that was switched off is not a source that is fine. It needs
   * a decision — repair it or drop the jurisdiction — and until somebody
   * takes that decision it stays on this list.
   */
  disabledSources: { id: string; reason: string | null }[] | null;
  /** Sources that have never been polled at all. */
  neverPolledSources: string[] | null;
  /**
   * Sources that poll cleanly and have never produced a usable item.
   *
   * The category the console could not see, because it was showing them
   * green. ADGM reports "ok, 60" every six hours; 45 of its items have
   * been classified and every one was rejected — Abu Dhabi Finance Week,
   * an office opening, a private-equity appointment, a funds framework.
   * The feed_url is the free zone's general press office, and no
   * item_pattern separates a data-protection decision from a conference
   * announcement, because at the URL level there is nothing to separate.
   *
   * `ok` has always meant "items were ingested". It has never meant the
   * items were worth ingesting, and the difference costs a model call per
   * item and buries the real ones. This is the same lesson as the `ok`
   * that meant "at least one element" and left the UK green for months on
   * an accessibility skip link, one stage further down the pipeline.
   *
   * Only reported past a sample worth believing: three rejections in a
   * row is a quiet fortnight, not a verdict.
   */
  barrenSources: { id: string; rejected: number }[] | null;
  /**
   * Items discovered long ago and never classified.
   *
   * The category the report was missing entirely. The Anthropic balance
   * ran out on 27 September; extraction stopped; sixty-seven items piled
   * up behind it — forty from the ICO — and for two mornings this digest
   * printed "discovered 32" as a standing figure and led with nothing.
   * Sentry said it seventy-two times, which is the channel that gets
   * ignored precisely because it repeats.
   *
   * A corpus count is a photograph. This is the derivative: things are
   * arriving and nothing is moving them on, which is the sentence a
   * broken pipeline actually produces.
   */
  stalledItems: { count: number; oldestHours: number } | null;
  /**
   * Items the extractor gave up on, with the reason it gave up.
   *
   * A parked item is the one failure that nothing else reports. The
   * corpus count does not show it — it leaves `discovered` and never
   * reaches `extracted`, so both numbers simply get smaller. The stalled
   * count does not show it either, because it is no longer waiting.
   *
   * It is in the report because it is usually ours. The two items that
   * created this category failed on `evidence.fine_eur: null`, a bug in
   * our own schema, and the reason is printed here so the next one is a
   * sentence in an email rather than an afternoon in Vercel's log
   * viewer.
   */
  parkedItems: { count: number; reasons: { error: string; count: number }[] } | null;
  awaitingReview: number | null;
  appUrl: string;
}

export interface Digest {
  subject: string;
  text: string;
  /** True when nothing needs a human. Used to keep the subject honest. */
  quiet: boolean;
}

/** An unavailable number is never printed as zero. */
function num(value: number | null): string {
  return value === null ? 'unavailable' : String(value);
}

/**
 * The attempt cap, as the email says it.
 *
 * Duplicated from the extraction route rather than imported: that module
 * is a route with `server-only` and a database client behind it, and this
 * one is a pure string builder the tests render without a database. A
 * number in a sentence is not worth that coupling — and if the two ever
 * disagree, the sentence is wrong by one, not wrong about what happened.
 */
const MAX_EXTRACT_ATTEMPTS_LABEL = 3;

/**
 * One line of an error, because a Zod message is twelve.
 *
 * The digest is read on a phone. A stack of JSON across fifteen lines is
 * not more information, it is the same information in a form that gets
 * skipped — and this report's whole purpose is being read.
 */
function firstLine(error: string): string {
  const line = error.split('\n')[0]!.trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

/**
 * Build the digest.
 *
 * Action items first, in the order a person should act on them, and
 * each one says what to do rather than only what happened. Then the
 * numbers. Then, always, what could not be read — a digest that hides
 * its own blind spots is worse than no digest, because it is trusted.
 */
export function composeDigest(input: DigestInput): Digest {
  const actions: string[] = [];

  // First, because it is the only category nobody learns about any other
  // way. A failing source is at least noisy; a disabled one is silent by
  // design, and silence is what this whole report exists to break.
  if (input.disabledSources && input.disabledSources.length > 0) {
    actions.push(
      `${input.disabledSources.length} source(s) switched off — they are no longer polled, and nothing else will mention them again:\n` +
        input.disabledSources
          .map((s) => `    ${s.id}: ${s.reason ?? 'no reason recorded'}`)
          .join('\n') +
        `\n    Repair the URL or drop the jurisdiction — ${input.appUrl}/en/admin/ops`
    );
  }

  if (input.brokenSources && input.brokenSources.length > 0) {
    actions.push(
      `${input.brokenSources.length} regulator feed(s) failing — the acquisition pipeline is producing nothing from them:\n` +
        input.brokenSources.map((s) => `    ${s.id}: ${s.error ?? 'unknown error'}`).join('\n') +
        `\n    Fix or replace at ${input.appUrl}/en/admin/ops`
    );
  }

  if (input.neverPolledSources && input.neverPolledSources.length > 0) {
    // Different from a failure and worth saying separately: a source
    // that has never run has never been proven to work at all.
    actions.push(
      `${input.neverPolledSources.length} source(s) have never been polled: ${input.neverPolledSources.join(', ')}\n` +
        `    Run the watcher once at ${input.appUrl}/en/admin/ops`
    );
  }

  if (input.billingMirrorDrift) {
    const { stripe, mirror } = input.billingMirrorDrift;
    actions.push(
      `Billing mirror disagrees with Stripe: our table says ${mirror} organisation(s) subscribed, Stripe says ${stripe}.\n` +
        `    Access is granted from our table, so the gap is either a customer with the wrong entitlement or a webhook we never received.`
    );
  }

  if (input.barrenSources && input.barrenSources.length > 0) {
    actions.push(
      `${input.barrenSources.length} source(s) poll cleanly and have never produced a usable item — they read as healthy and cost a model call each:\n` +
        input.barrenSources
          .map((s) => `    ${s.id}: ${s.rejected} classified, 0 kept`)
          .join('\n') +
        `\n    Narrow the URL or switch it off — ${input.appUrl}/en/admin/ops`
    );
  }

  if (input.stalledItems && input.stalledItems.count > 0) {
    actions.push(
      `${input.stalledItems.count} item(s) discovered and never classified, the oldest ${input.stalledItems.oldestHours}h ago — the extraction pass is not moving them.\n` +
        `    Nothing publishes from a corpus that stops halfway. Check the model account and the last run.`
    );
  }

  if (input.parkedItems && input.parkedItems.count > 0) {
    actions.push(
      `${input.parkedItems.count} item(s) abandoned by the extractor after ${MAX_EXTRACT_ATTEMPTS_LABEL} attempts — they are out of the queue and nothing retries them:\n` +
        input.parkedItems.reasons
          .map((r) => `    ${r.count}× ${firstLine(r.error)}`)
          .join('\n') +
        `\n    Read the reason before blaming the source: the first two of these were our own schema.`
    );
  }

  if (input.awaitingReview !== null && input.awaitingReview > 0) {    actions.push(
      `${input.awaitingReview} decision(s) waiting for review — nothing publishes until you approve them.\n` +
        `    ${input.appUrl}/en/admin/legal-queue`
    );
  }

  if (input.auditsStuck !== null && input.auditsStuck > 0) {
    actions.push(
      `${input.auditsStuck} audit(s) still unfinished beyond the sweep window. The reaper refunds them, but a pattern means the pipeline is failing.`
    );
  }

  if (input.auditsFailed !== null && input.auditsFailed > 0) {
    actions.push(`${input.auditsFailed} audit(s) failed in the last 24h. Credits were refunded.`);
  }

  const unreadable = Object.entries({
    'audits completed': input.auditsCompleted,
    'audits failed': input.auditsFailed,
    'stuck audits': input.auditsStuck,
    'credits consumed': input.creditsConsumed,
    'new organizations': input.newOrganizations,
    'active subscriptions': input.activeSubscriptions,
    corpus: input.corpus,
    'feed health': input.brokenSources,
    'switched-off sources': input.disabledSources,
    'source yield': input.barrenSources,
    'stalled items': input.stalledItems,
    'abandoned items': input.parkedItems,
    'review queue': input.awaitingReview
  })
    .filter(([, value]) => value === null)
    .map(([label]) => label);

  const quiet = actions.length === 0 && unreadable.length === 0;

  const lines: string[] = [];

  if (actions.length > 0) {
    lines.push('NEEDS YOU', '');
    actions.forEach((action, i) => lines.push(`  ${i + 1}. ${action}`, ''));
  } else if (unreadable.length === 0) {
    lines.push('Nothing needs you today.', '');
  }

  lines.push(
    'LAST 24 HOURS',
    '',
    `  Audits completed      ${num(input.auditsCompleted)}`,
    `  Audits failed         ${num(input.auditsFailed)}`,
    `  Credits consumed      ${num(input.creditsConsumed)}`,
    `  New organizations     ${num(input.newOrganizations)}`,
    '',
    'STANDING',
    '',
    `  Active subscriptions  ${num(input.activeSubscriptions)}`
  );

  if (input.corpus) {
    lines.push(
      `  Legal corpus          ` +
        ['discovered', 'extracted', 'approved', 'published', 'rejected', 'extract_failed']
          .map((status) => `${status} ${input.corpus?.[status] ?? 0}`)
          .join(' · ')
    );
  } else {
    lines.push('  Legal corpus          unavailable');
  }

  if (unreadable.length > 0) {
    // Never silently print zero for a query that failed. A digest that
    // hides its own blind spots is worse than none, because it is
    // trusted.
    lines.push(
      '',
      'COULD NOT BE READ',
      '',
      ...unreadable.map((label) => `  ${label}`),
      '',
      '  These are not zeros. Something is wrong with the reporting itself.'
    );
  }

  const subject = quiet
    ? 'LexyFlow — quiet day'
    : actions.length > 0
      ? `LexyFlow — ${actions.length} item(s) need you`
      : 'LexyFlow — daily digest (reporting degraded)';

  return { subject, text: lines.join('\n'), quiet };
}
