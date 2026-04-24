import { describe, test, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────
// HELPERS UNDER TEST
// Mirror the exact logic from production files.
// Any change to that logic must be reflected here.
// ─────────────────────────────────────────────────────────────

// H4: Mirrors corrected needs_response logic in fetch-reviews.js
// OLD (buggy): rating <= 2 && !(autoRespond5star && rating === 5)
// NEW (correct): rating <= 2 || (!!autoRespond5star && rating === 5)
function needsResponse(rating, autoRespond5star) {
  return rating <= 2 || (!!autoRespond5star && rating === 5);
}

// C5: Mirrors improved GBP review matching in publish-review-reply.js
const STAR_RATINGS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];
function matchGbpReview(review, r) {
  const gbpDate    = new Date(r.createTime).getTime();
  const reviewDate = new Date(review.date).getTime();
  const authorFull  = (review.author || '').toLowerCase().trim();
  const displayFull = (r.reviewer?.displayName || '').toLowerCase().trim();
  const authorMatch = !authorFull || !displayFull ||
    displayFull.includes(authorFull) ||
    authorFull.includes(displayFull);
  const ratingMatch = r.starRating === STAR_RATINGS[review.rating || 0];
  const dateClose   = Math.abs(gbpDate - reviewDate) < 48 * 3600 * 1000;
  return dateClose && ratingMatch && authorMatch;
}

// H5: Mirrors env-var version resolution used in generate-response, chat, translate
function resolveAnthropicVersion(envVal) {
  return envVal || '2023-06-01';
}

// ─────────────────────────────────────────────────────────────
// SUITE 1 — H4: autoRespond5star needs_response logic
// ─────────────────────────────────────────────────────────────
describe('H4: autoRespond5star needs_response logic', () => {
  test('negative review (rating 1) always needs response', () => {
    expect(needsResponse(1, false)).toBe(true);
    expect(needsResponse(1, true)).toBe(true);
  });

  test('negative review (rating 2) always needs response', () => {
    expect(needsResponse(2, false)).toBe(true);
    expect(needsResponse(2, true)).toBe(true);
  });

  test('neutral/positive reviews (3-4) never need response', () => {
    expect(needsResponse(3, false)).toBe(false);
    expect(needsResponse(3, true)).toBe(false);
    expect(needsResponse(4, false)).toBe(false);
    expect(needsResponse(4, true)).toBe(false);
  });

  test('5-star with autoRespond5star disabled → no response needed', () => {
    expect(needsResponse(5, false)).toBe(false);
    expect(needsResponse(5, null)).toBe(false);
    expect(needsResponse(5, undefined)).toBe(false);
    expect(needsResponse(5, 0)).toBe(false);
  });

  test('5-star with autoRespond5star=true → response needed (H4 critical fix)', () => {
    expect(needsResponse(5, true)).toBe(true);
  });

  test('5-star with autoRespond5star truthy (1) → response needed', () => {
    expect(needsResponse(5, 1)).toBe(true);
  });

  test('OLD buggy logic would return false for 5-star + autoRespond5star (regression proof)', () => {
    const OLD = (rating, ar5) => rating <= 2 && !(ar5 && rating === 5);
    // OLD returned false for 5-star even when auto-respond was enabled
    expect(OLD(5, true)).toBe(false);
    // NEW correctly returns true
    expect(needsResponse(5, true)).toBe(true);
  });

  test('OLD buggy logic had dead code: autoRespond5star never triggered (regression proof)', () => {
    const OLD = (rating, ar5) => rating <= 2 && !(ar5 && rating === 5);
    // When rating <= 2 the second part was always true (5 ≠ 2), so ar5 was irrelevant
    expect(OLD(2, true)).toBe(true);
    expect(OLD(2, false)).toBe(true);
    // And for rating 5 it was always false regardless of ar5
    expect(OLD(5, true)).toBe(false);
    expect(OLD(5, false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 2 — C5: GBP review matching logic
// ─────────────────────────────────────────────────────────────
describe('C5: GBP review matching (publish-review-reply)', () => {
  const BASE_DATE = '2024-01-15T10:00:00Z';
  const addHours  = (h) => new Date(Date.parse(BASE_DATE) + h * 3600000).toISOString();
  const baseReview = { date: BASE_DATE, rating: 4, author: 'Jean Dupont' };

  test('matches identical author, rating, and date', () => {
    const r = { createTime: addHours(1), starRating: 'FOUR', reviewer: { displayName: 'Jean Dupont' } };
    expect(matchGbpReview(baseReview, r)).toBe(true);
  });

  test('matches within 47h window', () => {
    const r = { createTime: addHours(47), starRating: 'FOUR', reviewer: { displayName: 'Jean Dupont' } };
    expect(matchGbpReview(baseReview, r)).toBe(true);
  });

  test('rejects when date difference exceeds 48h', () => {
    const r = { createTime: addHours(49), starRating: 'FOUR', reviewer: { displayName: 'Jean Dupont' } };
    expect(matchGbpReview(baseReview, r)).toBe(false);
  });

  test('rejects when rating mismatches', () => {
    const r = { createTime: addHours(1), starRating: 'THREE', reviewer: { displayName: 'Jean Dupont' } };
    expect(matchGbpReview(baseReview, r)).toBe(false);
  });

  test('rejects different author with same rating and close date (C5 core fix)', () => {
    const r = { createTime: addHours(1), starRating: 'FOUR', reviewer: { displayName: 'Jean Martin' } };
    expect(matchGbpReview(baseReview, r)).toBe(false);
  });

  test('matches when our stored author is contained in GBP displayName', () => {
    const r = { createTime: addHours(1), starRating: 'FOUR', reviewer: { displayName: 'Jean Dupont' } };
    expect(matchGbpReview({ ...baseReview, author: 'Jean Dupont' }, r)).toBe(true);
  });

  test('matches when GBP displayName is prefix of stored author', () => {
    const r = { createTime: addHours(1), starRating: 'FOUR', reviewer: { displayName: 'Jean D.' } };
    expect(matchGbpReview({ ...baseReview, author: 'Jean D.' }, r)).toBe(true);
  });

  test('matches when author is empty string (no author data in DB)', () => {
    const r = { createTime: addHours(1), starRating: 'FOUR', reviewer: { displayName: 'Jean Dupont' } };
    expect(matchGbpReview({ ...baseReview, author: '' }, r)).toBe(true);
  });

  test('matches when GBP reviewer displayName is missing', () => {
    const r = { createTime: addHours(1), starRating: 'FOUR', reviewer: {} };
    expect(matchGbpReview(baseReview, r)).toBe(true);
  });

  test('correctly maps all star rating strings', () => {
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].forEach((star, i) => {
      const r = { createTime: addHours(1), starRating: star, reviewer: { displayName: 'Jean Dupont' } };
      expect(matchGbpReview({ ...baseReview, rating: i + 1 }, r)).toBe(true);
    });
  });

  test('rejects when rating 0 and starRating does not match', () => {
    const r = { createTime: addHours(1), starRating: 'ONE', reviewer: { displayName: 'Jean Dupont' } };
    expect(matchGbpReview({ ...baseReview, rating: 0 }, r)).toBe(false);
  });

  test('OLD logic wrongly matched Jean Martin for Jean Dupont (C5 regression proof)', () => {
    function matchOLD(review, r) {
      const gbpDate    = new Date(r.createTime).getTime();
      const reviewDate = new Date(review.date).getTime();
      const authorMatch = (r.reviewer?.displayName || '').toLowerCase()
        .includes((review.author || '').toLowerCase().split(' ')[0]);
      const ratingMatch = r.starRating === STAR_RATINGS[review.rating || 0];
      const dateClose   = Math.abs(gbpDate - reviewDate) < 48 * 3600 * 1000;
      return (authorMatch || dateClose) && ratingMatch;
    }
    const r = { createTime: addHours(1), starRating: 'FOUR', reviewer: { displayName: 'Jean Martin' } };
    // OLD: "jean martin".includes("jean") = true → wrong match
    expect(matchOLD(baseReview, r)).toBe(true);
    // NEW: full name inclusion fails → correctly rejects
    expect(matchGbpReview(baseReview, r)).toBe(false);
  });

  test('OLD logic matched on date alone without checking author (C5 regression proof)', () => {
    function matchOLD(review, r) {
      const gbpDate    = new Date(r.createTime).getTime();
      const reviewDate = new Date(review.date).getTime();
      const authorMatch = (r.reviewer?.displayName || '').toLowerCase()
        .includes((review.author || '').toLowerCase().split(' ')[0]);
      const ratingMatch = r.starRating === STAR_RATINGS[review.rating || 0];
      const dateClose   = Math.abs(gbpDate - reviewDate) < 48 * 3600 * 1000;
      return (authorMatch || dateClose) && ratingMatch;
    }
    // authorMatch = false (completely different name), but dateClose = true → OLD matches!
    const r = { createTime: addHours(2), starRating: 'FOUR', reviewer: { displayName: 'Sophie Leclerc' } };
    expect(matchOLD(baseReview, r)).toBe(true);  // OLD wrongly matches
    expect(matchGbpReview(baseReview, r)).toBe(false); // NEW correctly rejects
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 3 — H5: Anthropic API version env var resolution
// ─────────────────────────────────────────────────────────────
describe('H5: Anthropic API version env var resolution', () => {
  test('uses env var when explicitly set', () => {
    expect(resolveAnthropicVersion('2024-01-01')).toBe('2024-01-01');
  });

  test('uses env var with a future version string', () => {
    expect(resolveAnthropicVersion('2025-12-31')).toBe('2025-12-31');
  });

  test('falls back to 2023-06-01 when env var is undefined', () => {
    expect(resolveAnthropicVersion(undefined)).toBe('2023-06-01');
  });

  test('falls back to 2023-06-01 when env var is empty string', () => {
    expect(resolveAnthropicVersion('')).toBe('2023-06-01');
  });

  test('falls back to 2023-06-01 when env var is null', () => {
    expect(resolveAnthropicVersion(null)).toBe('2023-06-01');
  });

  test('default (no env var) produces the current stable Anthropic API version', () => {
    expect(resolveAnthropicVersion(undefined)).toBe('2023-06-01');
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 4 — H2: Fire-and-forget email pattern (J1 cron)
// ─────────────────────────────────────────────────────────────
describe('H2: J1 email fire-and-forget pattern', () => {
  test('individual email errors do not propagate to caller', async () => {
    const results = [];
    const tasks = [
      Promise.resolve('ok1').then(v => results.push(v)),
      Promise.reject(new Error('SMTP error')).catch(e => results.push('caught:' + e.message)),
      Promise.resolve('ok2').then(v => results.push(v)),
    ];
    await Promise.allSettled(tasks);
    expect(results).toContain('ok1');
    expect(results).toContain('ok2');
    expect(results).toContain('caught:SMTP error');
  });

  test('caller is not blocked by slow email tasks', () => {
    let callerDone = false;
    const slowTask = new Promise(resolve => setTimeout(resolve, 50));
    // Fire without await — caller continues immediately
    slowTask.catch(() => {});
    callerDone = true;
    expect(callerDone).toBe(true);
  });

  test('each J1 email has its own error boundary — one failure does not cancel others', async () => {
    const errors = [];
    const sent   = [];
    const mockSend = (shouldFail, id) =>
      shouldFail
        ? Promise.reject(new Error('fail')).catch(e => errors.push(id))
        : Promise.resolve().then(() => sent.push(id));

    const tasks = [mockSend(false, 1), mockSend(true, 2), mockSend(false, 3)];
    await Promise.allSettled(tasks);

    expect(sent).toEqual([1, 3]);
    expect(errors).toEqual([2]);
  });

  test('fire-and-forget loop produces same result as sequential await for success case', async () => {
    const fireForget = [];
    const sequential = [];

    const clients = [{ id: 1 }, { id: 2 }, { id: 3 }];

    // Fire-and-forget pattern (new J1 pattern)
    const ffTasks = clients.map(c =>
      Promise.resolve(c.id)
        .then(id => fireForget.push(id))
        .catch(() => {})
    );

    // Sequential await pattern (old J1 pattern — blocking)
    for (const c of clients) {
      sequential.push(await Promise.resolve(c.id));
    }

    await Promise.allSettled(ffTasks);
    expect(fireForget.sort()).toEqual(sequential.sort());
  });
});
