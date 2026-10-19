import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A new customer's first report said "Page not found".
 *
 * The RLS policy on `audits` reads
 * `auth.jwt()->'app_metadata'->>'organization_id'`. That claim is minted
 * into the access token at SIGN-IN.
 *
 * A brand new account signs in first and receives its organisation
 * during onboarding. So the token sitting in the browser predates the
 * organisation and carries no claim — for an hour, until it refreshes.
 * The onboarding route's own comment claimed the opposite: "appears in
 * auth.jwt() on the next request". Writing app_metadata does not reissue
 * a token that has already been handed out.
 *
 * Consequence, measured on 19 October with a fresh alias account: sign
 * up, onboard, run the free audit, get redirected to the report, and the
 * database refuses the row to the person who created it two seconds ago.
 *
 * Invisible in every test anybody had ever run, because any session more
 * than an hour old has already refreshed.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const ONBOARDING = read('src/app/api/onboarding/route.ts');
const REPORT = read('src/app/[locale]/dashboard/[auditId]/page.tsx');

describe('the token carries the organisation before the user needs it', () => {
  it('refreshes the session once the organisation exists', () => {
    expect(ONBOARDING).toContain('refreshSession()');
    // After the stamp, or it mints a token from a user record that does
    // not carry the claim yet.
    expect(ONBOARDING.indexOf('updateUserById')).toBeLessThan(
      ONBOARDING.indexOf('refreshSession()')
    );
  });

  it('refreshes where cookies can actually be written', () => {
    // createSupabaseServerClient swallows cookie writes in a Server
    // Component. This is a Route Handler, which is the one place the
    // rotated token can be persisted.
    expect(ONBOARDING).toContain('createSupabaseServerClient().auth.refreshSession()');
  });

  it('does not fail onboarding when the refresh fails', () => {
    // The organisation exists and the stamp is written; the next natural
    // refresh repairs it. Losing the org over a token rotation would be
    // a worse outcome than the bug.
    const after = ONBOARDING.slice(ONBOARDING.indexOf('refreshSession()'));
    expect(after.slice(0, 400)).toContain('session_refresh_failed');
    expect(after.slice(0, 400)).not.toContain('status: 500');
  });

  it('no longer claims the stamp reaches the JWT by itself', () => {
    expect(ONBOARDING).not.toContain("appears in `auth.jwt()->'app_metadata'->>'organization_id'` on the next");
  });
});

describe('the owner is never told their own report does not exist', () => {
  it('falls back to an explicit ownership check when RLS returns nothing', () => {
    expect(REPORT).toContain('const { data: viaRls }');
    expect(REPORT).toContain('if (!audit) {');
    expect(REPORT).toContain("organizationIdFromUser(owner)");
  });

  it('applies the same rule, not a weaker one', () => {
    // Same organisation equality, from getUser() — which asks the auth
    // server instead of trusting the cookie, so it reads fresher truth
    // than the policy does.
    expect(REPORT).toContain(".eq('organization_id', ownerOrg)");
    expect(REPORT).toContain(".eq('id', params.auditId)");
  });

  it('still refuses when there is no owner or no match', () => {
    expect(REPORT).toContain('if (!audit) notFound();');
  });

  it('keeps RLS as the first read rather than replacing it', () => {
    expect(REPORT).toContain('createSupabaseServerClient');
    expect(REPORT.indexOf('viaRls')).toBeLessThan(REPORT.indexOf('viaService'));
  });
});
