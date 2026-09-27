import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 345 accounts existed and 46 had ever confirmed an address or signed in.
 * The oldest of the rest dated from May: four months of e-mail addresses
 * belonging to people who never completed a signup, most of them injected
 * by bots across sixteen throwaway domains.
 *
 * There is no basis to keep them, and "we might need it" is not one —
 * Article 5(1)(c) and (e), which we audit other companies against.
 *
 * This is the only irreversible operation in the codebase that acts on
 * people rather than on rows we generated ourselves, so the guards are
 * asserted against the source: they are the whole safety of it.
 */

const PURGE = readFileSync(
  join(__dirname, '..', 'src', 'app', 'api', 'cron', 'purge', 'route.ts'),
  'utf8'
);

describe('the predicate that decides whether an account is deleted', () => {
  it('requires all four conditions, and re-checks them in code', () => {
    // Not trusted from a query. The listing gives every account; the
    // predicate is applied here.
    expect(PURGE).toContain('!user.email_confirmed_at');
    expect(PURGE).toContain('!user.last_sign_in_at');
    expect(PURGE).toContain('user.created_at < cutoff');
    expect(PURGE).toContain('!organizationId');
  });

  it('spares any account that belongs to an organisation', () => {
    // The belt to the others' braces. An account with an organisation has
    // a workspace and may own audits, documents and a billing
    // relationship. No combination of the other three should ever be true
    // of one — and if it is, the right behaviour is to leave it and let
    // somebody look.
    expect(PURGE).toContain("app_metadata as { organization_id?: string }");
  });

  it('keeps a thirty-day window rather than deleting on sight', () => {
    expect(PURGE).toMatch(/UNCONFIRMED_RETENTION_DAYS = 30/);
  });
});

describe('what stops a bug from emptying the table', () => {
  it('caps how many accounts one run may delete', () => {
    expect(PURGE).toMatch(/MAX_ACCOUNT_DELETIONS_PER_RUN = \d+/);
    expect(PURGE).toContain('deleted < MAX_ACCOUNT_DELETIONS_PER_RUN');
    expect(PURGE).toContain('deleted >= MAX_ACCOUNT_DELETIONS_PER_RUN) break');
  });

  it('bounds the pagination instead of looping until the table ends', () => {
    expect(PURGE).toMatch(/page <= 25/);
  });
});

describe('how the deletion is performed', () => {
  it('goes through the Auth admin API, not a delete statement', () => {
    // auth.users has ten child tables. deleteUser revokes sessions rather
    // than orphaning them: the difference between removing a person's
    // data and removing our pointer to it.
    expect(PURGE).toContain('admin.auth.admin.deleteUser');
    expect(PURGE).not.toMatch(/from\(['"]auth\.users['"]\)/);
  });

  it('logs the count and never the addresses', () => {
    // A purge log listing who was deleted recreates, somewhere with a
    // longer retention, the thing it just deleted.
    expect(PURGE).toContain("unconfirmed_accounts_deleted', { deleted }");
    expect(PURGE).not.toMatch(/console\.log\([^)]*user\.email/);
  });

  it('reports the count and the cutoff in the run summary', () => {
    expect(PURGE).toContain('unconfirmed_accounts: accounts.deleted');
    expect(PURGE).toContain('unconfirmed_accounts: accountCutoff()');
  });
});
