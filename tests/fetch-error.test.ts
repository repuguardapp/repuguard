import { beforeAll, describe, expect, it, vi } from 'vitest';

// safe-fetch is server-only, which throws on import outside a server
// component. The same shim every other test of a server module uses.
vi.mock('server-only', () => ({}));

let describeFetchError: (err: unknown) => string;
beforeAll(async () => {
  ({ describeFetchError } = await import('@/lib/safe-fetch'));
});

/**
 * Node wraps every transport failure — DNS, TCP, TLS, a refused connection
 * — in one `TypeError: fetch failed` and puts the real reason in `cause`.
 *
 * A scan of uber.fr reported "we could not read the homepage: fetch
 * failed", which named the layer that failed and nothing else: the same
 * defect as the message it had just replaced, one level down.
 */

function wrapped(cause: Error): Error {
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = cause;
  return err;
}

describe('the cause, not the wrapper', () => {
  it('unwraps a DNS failure', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND uber.fr'), { code: 'ENOTFOUND' });
    expect(describeFetchError(wrapped(cause))).toContain('ENOTFOUND');
    expect(describeFetchError(wrapped(cause))).not.toBe('fetch failed');
  });

  it('keeps a code that the message does not already carry', () => {
    const cause = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    expect(describeFetchError(wrapped(cause))).toBe('certificate has expired (CERT_HAS_EXPIRED)');
  });

  it('does not repeat a code already inside the message', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), {
      code: 'ECONNREFUSED'
    });
    expect(describeFetchError(wrapped(cause))).toBe('connect ECONNREFUSED 1.2.3.4:443');
  });

  it('falls back to the wrapper when there is no cause', () => {
    // Our own refusals — "unfetchable: more than 5 redirects" — are thrown
    // directly and are already the real answer.
    expect(describeFetchError(new Error('unfetchable: more than 5 redirects'))).toBe(
      'unfetchable: more than 5 redirects'
    );
  });

  it('survives something that is not an Error at all', () => {
    expect(describeFetchError('boom')).toBe('boom');
    expect(describeFetchError(undefined)).toBe('undefined');
  });
});
