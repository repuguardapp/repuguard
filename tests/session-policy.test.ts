import { describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_MAX_AGE_MS,
  SESSION_MAX_AGE_MS,
  SESSION_MAX_IDLE_MS,
  evaluateSession,
  sessionIdFromAccessToken
} from '../src/lib/session-policy';

/**
 * Supabase sessions never expire on the free plan: the access token
 * rotates hourly against a refresh token with no end date, so a browser
 * renews itself for ever. Come back two months later on the same device
 * and you are still signed in.
 *
 * For a product holding compliance reports on documents containing
 * names, home addresses and national tax identifiers, that is the exact
 * class of gap our own audits flag under GDPR Article 32. Supabase
 * enforces a time-box natively on Pro; we enforce it here for nothing.
 */

const NOW = new Date('2026-09-12T20:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const DEFAULT = { maxAgeMs: SESSION_MAX_AGE_MS, maxIdleMs: SESSION_MAX_IDLE_MS };

describe('the time-box', () => {
  it('accepts a session inside both limits', () => {
    expect(
      evaluateSession({ createdAt: ago(2 * DAY), refreshedAt: ago(HOUR) }, DEFAULT, NOW)
    ).toEqual({ valid: true });
  });

  it('expires a session past its maximum lifetime however active it is', () => {
    // The case that motivated all of this: a browser that has kept
    // itself alive by refreshing, for ever.
    expect(
      evaluateSession({ createdAt: ago(31 * DAY), refreshedAt: ago(60_000) }, DEFAULT, NOW)
    ).toEqual({ valid: false, reason: 'expired_max_age' });
  });

  it('expires a session left untouched past the inactivity window', () => {
    expect(
      evaluateSession({ createdAt: ago(10 * DAY), refreshedAt: ago(8 * DAY) }, DEFAULT, NOW)
    ).toEqual({ valid: false, reason: 'expired_idle' });
  });

  it('dates a never-refreshed session from its creation, not from epoch', () => {
    // refreshed_at is null until the first token rotation. Treating
    // null as zero would expire every brand-new session instantly.
    expect(evaluateSession({ createdAt: ago(HOUR), refreshedAt: null }, DEFAULT, NOW)).toEqual({
      valid: true
    });
  });
});

describe('an unknown session is refused, not waved through', () => {
  it('refuses when the row cannot be found', () => {
    // The row is missing because the user signed out or the session was
    // revoked — the two moments where continuing would be worst.
    // Failing open here would quietly undo the whole control.
    expect(evaluateSession({ createdAt: null, refreshedAt: null }, DEFAULT, NOW)).toEqual({
      valid: false,
      reason: 'unknown_session'
    });
  });
});

describe('admin surfaces are held to a much shorter leash', () => {
  const ADMIN = { maxAgeMs: ADMIN_SESSION_MAX_AGE_MS };

  it('accepts a session opened this morning', () => {
    expect(evaluateSession({ createdAt: ago(3 * HOUR), refreshedAt: ago(60_000) }, ADMIN, NOW))
      .toEqual({ valid: true });
  });

  it('refuses a day-old session that the ordinary surface still accepts', () => {
    const lifetime = { createdAt: ago(26 * HOUR), refreshedAt: ago(60_000) };

    // Approving an item in the legal queue turns a model's output into
    // a public statement by LexyFlow. That is not a decision an
    // overnight session on an unattended tablet should be able to take.
    expect(evaluateSession(lifetime, ADMIN, NOW).valid).toBe(false);
    expect(evaluateSession(lifetime, DEFAULT, NOW).valid).toBe(true);
  });

  it('is meaningfully shorter than the ordinary policy', () => {
    expect(ADMIN_SESSION_MAX_AGE_MS).toBeLessThan(SESSION_MAX_AGE_MS / 10);
  });
});

describe('reading the session id out of the access token', () => {
  function token(payload: Record<string, unknown>): string {
    const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature-not-checked-here`;
  }

  it('reads the claim', () => {
    expect(sessionIdFromAccessToken(token({ session_id: 'abc-123', sub: 'u1' }))).toBe('abc-123');
  });

  it('returns null for a token without the claim', () => {
    // Tokens minted before the claim existed are the oldest sessions in
    // circulation — exactly the ones we most want to stop honouring —
    // so the caller treats null as a refusal.
    expect(sessionIdFromAccessToken(token({ sub: 'u1' }))).toBeNull();
  });

  it('returns null rather than throwing on rubbish', () => {
    expect(sessionIdFromAccessToken('not-a-jwt')).toBeNull();
    expect(sessionIdFromAccessToken('a.!!!not-base64!!!.c')).toBeNull();
    expect(sessionIdFromAccessToken(null)).toBeNull();
    expect(sessionIdFromAccessToken(undefined)).toBeNull();
  });
});

describe('the durations are defensible to a security questionnaire', () => {
  it('keeps the absolute lifetime within a month', () => {
    // Enterprise security reviews routinely ask for a maximum session
    // lifetime and 30 days is the usual ceiling they accept.
    expect(SESSION_MAX_AGE_MS).toBeLessThanOrEqual(30 * DAY);
  });

  it('keeps the inactivity window well inside the lifetime', () => {
    // An idle timeout at or above the time-box would never fire.
    expect(SESSION_MAX_IDLE_MS).toBeLessThan(SESSION_MAX_AGE_MS);
  });
});
