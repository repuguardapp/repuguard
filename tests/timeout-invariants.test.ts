import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The audit pipeline's timeouts are spread across four files that
 * cannot see each other: a route segment export, a vercel.json entry,
 * a polling threshold and a cron threshold. Nothing type-checks them
 * against one another, and every disagreement between them is silent
 * and expensive.
 *
 * Two have already bitten us:
 *   • the route declared 300s while vercel.json asked for 800s, and
 *     Vercel does not document which wins — under the pessimistic
 *     reading the function was killed mid-audit, after the credit was
 *     spent and before the audit row existed;
 *   • the polling endpoint declared an audit dead after 6 minutes,
 *     which is less than the function's own ceiling, so it would
 *     refund a customer for an audit that was still running and would
 *     later succeed.
 *
 * These are read as text on purpose. Importing the route modules pulls
 * in Supabase, the AI clients and the document extractor; the values
 * under test are declarations, and declarations are what we check.
 */

const root = join(__dirname, '..');

function read(relPath: string): string {
  return readFileSync(join(root, relPath), 'utf8');
}

function numberFrom(source: string, pattern: RegExp, label: string): number {
  const match = source.match(pattern);
  if (!match?.[1]) throw new Error(`could not find ${label}`);
  return Number(match[1]);
}

const AUDIT_ROUTE = 'src/app/api/audit/route.ts';

const auditMaxDuration = numberFrom(
  read(AUDIT_ROUTE),
  /export const maxDuration = (\d+)/,
  'maxDuration in the audit route'
);

const vercelJson = JSON.parse(read('vercel.json')) as {
  functions: Record<string, { maxDuration: number }>;
};

const pollHealMinutes = numberFrom(
  read('src/app/api/audit/[id]/route.ts'),
  /const RUNAWAY_THRESHOLD_MS = (\d+) \* 60/,
  'RUNAWAY_THRESHOLD_MS'
);

const cronReapMinutes = numberFrom(
  read('src/app/api/cron/reap-audits/route.ts'),
  /const STUCK_AFTER_MINUTES = (\d+)/,
  'STUCK_AFTER_MINUTES'
);

describe('audit timeout invariants', () => {
  it('declares the same function ceiling in the route and in vercel.json', () => {
    const declared = vercelJson.functions[AUDIT_ROUTE]?.maxDuration;
    expect(declared).toBeDefined();
    // Vercel does not document which of the two wins for an App Router
    // handler. Keeping them equal means we never have to know.
    expect(auditMaxDuration).toBe(declared);
  });

  it('never declares an audit dead while the function could still be running', () => {
    // The margin is the point: at exactly the ceiling the platform may
    // not have finished killing the instance.
    expect(pollHealMinutes * 60).toBeGreaterThan(auditMaxDuration);
  });

  it('lets the poll heal before the cron sweep, so a waiting user is not left on a spinner', () => {
    expect(pollHealMinutes).toBeLessThan(cronReapMinutes);
  });

  it('keeps every route that declares a ceiling agreeing with vercel.json', () => {
    // Generalised from the audit route, where a 300/800 disagreement
    // meant the real ceiling could not be known by reading the code.
    // The same trap is open on every function listed here.
    for (const [path, config] of Object.entries(vercelJson.functions)) {
      let source: string;
      try {
        source = read(path);
      } catch {
        // vercel.json may list a path that no longer exists; that is a
        // separate problem and the assertion below catches it.
        expect.fail(`vercel.json lists ${path}, which is not in the repo`);
      }
      const match = source.match(/export const maxDuration = (\d+)/);
      if (!match?.[1]) continue; // No route-level export: vercel.json alone decides.
      expect(Number(match[1]), `${path} disagrees with vercel.json`).toBe(config.maxDuration);
    }
  });

  it('keeps every audit function within the platform ceiling', () => {
    // 800s is the Fluid Compute maximum. A larger value is rejected at
    // deploy time, which is a bad place to find out.
    for (const [path, config] of Object.entries(vercelJson.functions)) {
      expect(config.maxDuration, `${path} exceeds the platform ceiling`).toBeLessThanOrEqual(800);
    }
  });
});
