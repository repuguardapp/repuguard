import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The daily ceiling on free anonymous audits.
 *
 * WHY THIS IS NOT THE RATE LIMITER
 *
 * src/lib/rate-limit.ts holds its counters in a Map inside one warm
 * function instance, and says so. On Vercel that means the ceiling is
 * multiplied by however many instances happen to be warm — fine for
 * discouraging a burst from one address, useless as a spend cap.
 *
 * It also had the wrong shape for this. ORG_LIMIT is 50/day per
 * organisation and every widget audit belongs to the same anonymous
 * organisation, so the allowance was shared by every embedder at once:
 * one popular site, or one bored visitor, closed the door for all of
 * them. A free tool any single user can switch off for everybody is
 * not a distribution channel.
 *
 * WHAT IT IS GUARDING
 *
 * Measured from model_usage: 11,621 input and 7,878 output tokens per
 * audit on claude-sonnet-4-6, at $3 and $15 per million — about $0.15
 * each, pass 1 only. The default of 25 is therefore roughly $4 a day
 * in the worst case, which is a budget decision for an account with no
 * revenue rather than a technical one. Raise it from the environment
 * the day that changes.
 */
const DEFAULT_DAILY_CAP = 25;

export function anonymousDailyCap(): number {
  const raw = Number(process.env.ANONYMOUS_DAILY_AUDITS);
  // A missing or malformed value falls back rather than throwing: a
  // typo in an environment variable should not take the widget down,
  // and it should not silently mean "unlimited" either.
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_DAILY_CAP;
}

export interface QuotaDecision {
  ok: boolean;
  used: number;
  cap: number;
  /** Midnight UTC, when the counter starts again. */
  resetAt: number;
}

/** Next UTC midnight, in epoch milliseconds. */
function nextResetAt(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

/**
 * Claim one audit against today's allowance.
 *
 * The increment and the read are one statement, so two requests
 * arriving together cannot both see the same remaining slot — the row
 * lock serialises them. Counting rows in `audits` instead would race,
 * and would quietly stop counting the first time somebody adds a
 * retention purge.
 *
 * ON FAILURE IT ALLOWS, AND THAT IS DELIBERATE
 *
 * If this read throws, we do not know what today's count is. Refusing
 * would take the public widget down for everyone over a database
 * blink, to protect a budget the IP limiter is still defending; the
 * failure is logged and the request proceeds. A spend cap that turns
 * into an outage is a worse instrument than the one it replaced.
 */
export async function claimAnonymousAudit(db: SupabaseClient): Promise<QuotaDecision> {
  const cap = anonymousDailyCap();
  const resetAt = nextResetAt();

  try {
    const { data, error } = await db.rpc('claim_anonymous_audit');
    if (error) throw new Error(error.message);

    const used = Number(data);
    if (!Number.isFinite(used)) throw new Error(`unexpected quota value: ${String(data)}`);

    return { ok: used <= cap, used, cap, resetAt };
  } catch (err) {
    console.error('[anonymous-quota] claim_failed', {
      error: err instanceof Error ? err.message : String(err)
    });
    // Allowed, and said out loud. See the note above.
    return { ok: true, used: -1, cap, resetAt };
  }
}
