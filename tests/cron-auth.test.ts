import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who may run a scheduled job.
 *
 * The operator path exists because the machine path became unusable by
 * a human: CRON_SECRET is stored Sensitive in Vercel, so the person who
 * set it cannot read it back, and four feed URLs reached production
 * unverified because nobody could trigger the poller on demand.
 *
 * It is also the better path. A secret in a query string travels into
 * logs, browser history and the Referer header — we already had to
 * patch Sentry after the admin secret reached them that way — and it
 * authenticates a string rather than a person.
 */

vi.mock('server-only', () => ({}));

let currentUser: { id: string; email: string | null } | null;

function install() {
  vi.doMock('@/lib/supabase-server', () => ({
    getCurrentAdminUser: async () => currentUser
  }));
}

async function authorize(init?: { header?: string; query?: string }): Promise<boolean> {
  const { isCronAuthorized } = await import('../src/lib/cron-auth');
  const url = init?.query
    ? `https://lexyflow.com/api/cron/watch-legal?secret=${init.query}`
    : 'https://lexyflow.com/api/cron/watch-legal';
  return isCronAuthorized(
    new Request(url, init?.header ? { headers: { authorization: init.header } } : undefined)
  );
}

beforeEach(() => {
  vi.resetModules();
  currentUser = null;
  process.env['CRON_SECRET'] = 'the-secret';
  process.env['ADMIN_EMAILS'] = 'owner@lexyflow.com';
  install();
});

describe('the machine path is unchanged', () => {
  it('accepts the bearer header Vercel Cron sends', async () => {
    expect(await authorize({ header: 'Bearer the-secret' })).toBe(true);
  });

  it('accepts the query-string form', async () => {
    expect(await authorize({ query: 'the-secret' })).toBe(true);
  });

  it('refuses a wrong secret from an anonymous caller', async () => {
    expect(await authorize({ header: 'Bearer wrong' })).toBe(false);
    expect(await authorize({ query: 'wrong' })).toBe(false);
  });
});

describe('the operator path', () => {
  it('accepts an allowlisted admin with no secret at all', async () => {
    currentUser = { id: 'u1', email: 'owner@lexyflow.com' };
    expect(await authorize()).toBe(true);
  });

  it('refuses a signed-in user who is not an admin', async () => {
    currentUser = { id: 'u2', email: 'stranger@example.com' };
    expect(await authorize()).toBe(false);
  });

  it('refuses everyone when no allowlist is configured', async () => {
    // An unset ADMIN_EMAILS means nobody is an admin, by design. A
    // forgotten variable must not open a job to any signed-in visitor.
    delete process.env['ADMIN_EMAILS'];
    currentUser = { id: 'u1', email: 'owner@lexyflow.com' };
    expect(await authorize()).toBe(false);
  });

  it('is the only way in when CRON_SECRET is unreadable but set', async () => {
    // The situation that prompted this: the secret exists, the platform
    // can use it, and the operator cannot.
    currentUser = { id: 'u1', email: 'owner@lexyflow.com' };
    expect(await authorize({ query: 'a-guess' })).toBe(true);
    currentUser = null;
    expect(await authorize({ query: 'a-guess' })).toBe(false);
  });
});

describe('an unset secret does not open the door in production', () => {
  it('still refuses an anonymous caller', async () => {
    delete process.env['CRON_SECRET'];
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    install();

    expect(await authorize()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('leaves the route open outside production so tests can reach it', async () => {
    delete process.env['CRON_SECRET'];
    expect(await authorize()).toBe(true);
  });
});
