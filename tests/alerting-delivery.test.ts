import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The alerting channel has to deliver, and it has to be impossible for
 * it to break the path it watches.
 *
 * Both properties are invisible in production by construction: every
 * alertOps call site is a branch that already degrades gracefully, so
 * a channel that silently drops events looks exactly like a healthy
 * system. These tests are the only place that difference is observable.
 */

vi.mock('server-only', () => ({}));

const mockCaptureMessage = vi.fn();
const mockFlush = vi.fn();
const mockGetClient = vi.fn();
const mockWaitUntil = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  flush: (...args: unknown[]) => mockFlush(...args),
  getClient: () => mockGetClient()
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: (...args: unknown[]) => mockWaitUntil(...args)
}));

async function loadAlertOps() {
  const mod = await import('../src/lib/alert');
  return mod.alertOps;
}

beforeEach(() => {
  mockCaptureMessage.mockReset();
  mockFlush.mockReset().mockResolvedValue(true);
  mockGetClient.mockReset().mockReturnValue({});
  mockWaitUntil.mockReset();
});

describe('alertOps — delivery', () => {
  it('captures the event as an error tagged with its own name', async () => {
    const alertOps = await loadAlertOps();
    alertOps('audit.findings_insert_failed', { auditId: 'a1' });

    expect(mockCaptureMessage).toHaveBeenCalledWith('audit.findings_insert_failed', {
      level: 'error',
      tags: { alert: 'audit.findings_insert_failed' },
      extra: { auditId: 'a1' }
    });
  });

  /**
   * The regression this guards: @sentry/nextjs normally flushes as part
   * of wrapping the request, but next.config.mjs disables that wrapping
   * (it raced with our body reads on Fluid Compute). Capturing only
   * queues the event, so without an explicit flush an alert raised on
   * the line before `return NextResponse.json(...)` races the platform
   * freezing the instance — and the alerts most worth having are
   * exactly the ones raised last.
   */
  it('holds the invocation open until the event is actually sent', async () => {
    const alertOps = await loadAlertOps();
    alertOps('stripe.handler_error');

    expect(mockFlush).toHaveBeenCalledWith(2000);
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    // What waitUntil receives must be the flush, not a value: handing
    // the platform anything else keeps the instance alive for nothing.
    await expect(mockWaitUntil.mock.calls[0]?.[0]).resolves.toBe(true);
  });

  it('swallows a rejected flush rather than raising an unhandled rejection', async () => {
    mockFlush.mockRejectedValue(new Error('ingest unreachable'));
    const alertOps = await loadAlertOps();
    alertOps('cron.reap_audits_failed');

    // An unhandled rejection inside waitUntil surfaces as a spurious
    // platform error log on a request that otherwise succeeded.
    await expect(mockWaitUntil.mock.calls[0]?.[0]).resolves.toBe(false);
  });
});

describe('alertOps — never breaks the path it watches', () => {
  afterEach(() => {
    expect(mockCaptureMessage).toHaveBeenCalled();
  });

  it('does not throw when capture itself throws', async () => {
    mockCaptureMessage.mockImplementation(() => {
      throw new Error('sentry exploded');
    });
    const alertOps = await loadAlertOps();

    expect(() => alertOps('stripe.handler_error')).not.toThrow();
    // A capture that never happened has nothing to flush.
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });

  it('does not throw when the platform rejects waitUntil', async () => {
    mockWaitUntil.mockImplementation(() => {
      throw new Error('no request context');
    });
    const alertOps = await loadAlertOps();

    expect(() => alertOps('auth.otp_threw')).not.toThrow();
  });
});

describe('GET /api/admin/selftest-alerting', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, ADMIN_SELFTEST_SECRET: 'topsecret' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  async function call(url: string) {
    const { GET } = await import('../src/app/api/admin/selftest-alerting/route');
    const res = await GET(new Request(url));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it('refuses a wrong secret without saying anything else', async () => {
    const { status, body } = await call(
      'https://lexyflow.com/api/admin/selftest-alerting?secret=wrong'
    );
    expect(status).toBe(403);
    expect(body).toEqual({ error: 'forbidden' });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  /**
   * An unconfigured endpoint and a mistyped secret are different
   * problems with different fixes. Collapsing both into 403 leaves the
   * operator guessing precisely when they are trying to establish
   * whether the environment is wired up — and there is no secret to
   * protect when none is configured.
   */
  it('says plainly when no secret is configured at all', async () => {
    delete process.env['ADMIN_SELFTEST_SECRET'];
    const { status, body } = await call(
      'https://lexyflow.com/api/admin/selftest-alerting?secret=anything'
    );
    expect(status).toBe(503);
    expect(body['error']).toBe('selftest_not_configured');
  });

  it('reports plainly that the SDK is inert instead of a green tick', async () => {
    mockGetClient.mockReturnValue(undefined);
    const { body } = await call(
      'https://lexyflow.com/api/admin/selftest-alerting?secret=topsecret'
    );

    expect(body['ok']).toBe(false);
    expect(body['reason']).toBe('sentry_not_initialised');
    // No synthetic alert is fired when there is nowhere to send it.
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('fires a real alert and waits for delivery before answering', async () => {
    process.env['SENTRY_DSN'] = 'https://key@o1.ingest.sentry.io/1';
    const { body } = await call(
      'https://lexyflow.com/api/admin/selftest-alerting?secret=topsecret'
    );

    expect(body['ok']).toBe(true);
    expect(body['delivered']).toBe(true);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'ops.alerting_selftest',
      expect.objectContaining({ tags: { alert: 'ops.alerting_selftest' } })
    );
    // The probe waits for the flush itself rather than deferring it.
    expect(mockFlush).toHaveBeenCalledWith(5000);
    // Never echo the DSN back, only whether one is present.
    expect(JSON.stringify(body)).not.toContain('ingest.sentry.io');
    expect((body['config'] as Record<string, unknown>)['serverDsnConfigured']).toBe(true);
  });
});
