import { describe, expect, it } from 'vitest';
import {
  DISABLE_AFTER_TERMINAL_FAILURES,
  DISABLE_AFTER_TRANSIENT_FAILURES,
  DISABLE_UNVERIFIED_AFTER,
  classifyFailure,
  disableThreshold
} from '@/lib/source-failure';

/**
 * The morning the CNIL was one poll from being switched off.
 *
 * 22 October: four consecutive `http_503` against France's regulator,
 * and the watcher disables at five. The operator opened the site and
 * found a maintenance page — the 503 was honest, nothing was aimed at
 * us, and there was nothing to repair. The next poll would have ended
 * our watch on our own jurisdiction, four published decisions and all.
 *
 * The rule that would have done it treated three different things as
 * one. `no_items` killed the Garante: a feed_url pointing at the wrong
 * document, our mistake, and more polling cannot fix it. A 403 killed
 * the EDPS: a refusal, deliberate, and more polling cannot change it.
 * A 503 is neither. It is the only one of the three where coming back
 * later is the correct response, and it was being punished identically.
 */

describe('an answer that says "later" is not an answer that says "no"', () => {
  it('treats the 5xx family as transient', () => {
    for (const code of [500, 502, 503, 504]) {
      expect(classifyFailure(`http_${code}`), `http_${code}`).toBe('transient');
    }
  });

  it('treats a refusal and a missing page as terminal', () => {
    // Decisions the other end has made. Waiting does not reverse them:
    // the EDPS has been answering 403 to our collector since September.
    for (const code of [401, 403, 404, 410, 451]) {
      expect(classifyFailure(`http_${code}`), `http_${code}`).toBe('terminal');
    }
  });

  it('counts being rate limited as transient', () => {
    // 429 is the politest possible way of saying come back later.
    // Switching off a regulator for being popular would be absurd.
    expect(classifyFailure('http_429')).toBe('transient');
    expect(classifyFailure('http_408')).toBe('transient');
  });

  it('reads the status through the diagnostic suffix the watcher appends', () => {
    // fail() emits `http_503 | candidates: …`. The noise after the code
    // must not change the verdict — this is the exact string the CNIL
    // produced.
    expect(classifyFailure('http_503 | candidates: /fr/actualites, /fr/decisions')).toBe(
      'transient'
    );
  });

  it('treats a transport failure as transient', () => {
    // No answer arrived at all, which tells us about the minute rather
    // than about the URL.
    for (const e of ['fetch failed', 'ETIMEDOUT', 'ECONNRESET', 'socket hang up']) {
      expect(classifyFailure(e), e).toBe('transient');
    }
  });
});

describe('an unclassified failure behaves like the strict case', () => {
  it('keeps no_items terminal — it is our error, not theirs', () => {
    /**
     * This is what took the Garante off: a sitemap index with 321
     * undated children and no honest way to pick among them. The repair
     * is a narrower feed_url. A week of patience would have changed
     * nothing and hidden it for six more days.
     */
    expect(classifyFailure('no_items (kind=sitemap, skipped 0, 57889 bytes)')).toBe('terminal');
  });

  it('defaults anything new to terminal', () => {
    // A failure mode nobody has classified yet should surface in two
    // days, not hide for a week. Being wrong in this direction is
    // noticed; being wrong the other way is silence.
    expect(classifyFailure('robots.txt disallows this path')).toBe('terminal');
    expect(classifyFailure('something nobody has seen before')).toBe('terminal');
    expect(classifyFailure('')).toBe('terminal');
  });
});

describe('the ceilings', () => {
  it('still kills a dead feed inside two days', () => {
    // The original rule's real purpose: a feed that no longer exists
    // would otherwise alert four times a day for ever, which is how an
    // alerting channel stops being read.
    expect(DISABLE_AFTER_TERMINAL_FAILURES).toBe(5);
    expect(disableThreshold('http_404', false)).toBe(5);
  });

  it('gives a server outage a week', () => {
    // Six-hour polls, so 28 is seven days. The cost of being patient is
    // one HTTP request every six hours; the cost of being hasty was
    // nearly France.
    expect(DISABLE_AFTER_TRANSIENT_FAILURES).toBe(28);
    expect(disableThreshold('http_503', false)).toBe(28);
  });

  it('still catches a host that is down for good', () => {
    // Patience is bounded. A month of 503 is not maintenance, and the
    // weekly ceiling reaches it without a human having to remember.
    expect(DISABLE_AFTER_TRANSIENT_FAILURES).toBeLessThan(60);
  });

  it('keeps the candidate rope for a candidate that genuinely failed', () => {
    // "Never worked" and "stopped working" are different questions, and
    // five polls is the wrong answer to the first — every Gulf source
    // would die before a probe report had been read.
    expect(disableThreshold('http_404', true)).toBe(DISABLE_UNVERIFIED_AFTER);
  });

  it('gives a candidate the transient ceiling when the server is down', () => {
    /**
     * A 503 tells us nothing about whether a candidate's URL is right,
     * so it cannot count toward the judgement that it is wrong. The
     * longer of the two ropes applies.
     */
    expect(disableThreshold('http_503', true)).toBe(DISABLE_AFTER_TRANSIENT_FAILURES);
    expect(disableThreshold('http_503', true)).toBeGreaterThan(DISABLE_UNVERIFIED_AFTER);
  });
});

describe('the CNIL case, as it actually stood', () => {
  it('does not disable at the fifth consecutive 503', () => {
    // consecutive_failures was 4 at 06:00 on 22 October. The next poll
    // was 12:00. Under the old rule that was the end of it.
    const streak = 5;
    expect(streak >= disableThreshold('http_503', false)).toBe(false);
  });

  it('would still have disabled it at the fifth consecutive 404', () => {
    // The protection is for outages, not a general amnesty.
    const streak = 5;
    expect(streak >= disableThreshold('http_404', false)).toBe(true);
  });
});
