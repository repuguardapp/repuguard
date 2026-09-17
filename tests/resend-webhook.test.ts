import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The webhook that fills the suppression list.
 *
 * Without it, a hard bounce and a spam complaint both change nothing
 * and the next send goes to the same address — which is how a sending
 * domain stops reaching the mailboxes that never complained.
 */

vi.mock('server-only', () => ({}));

const SECRET = `whsec_${Buffer.from('a-test-signing-secret').toString('base64')}`;
let suppressed: { email: string; reason: string }[];

function install() {
  vi.doMock('@/lib/email-suppression', () => ({
    suppress: async (email: string, reason: string) => {
      suppressed.push({ email, reason });
    }
  }));
}

function sign(body: string, id = 'msg_1', timestamp = String(Math.floor(Date.now() / 1000))) {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${sig}` };
}

async function post(payload: unknown, headers?: Record<string, string>) {
  install();
  const { POST } = await import('@/app/api/resend-webhook/route');
  const body = JSON.stringify(payload);
  return POST(
    new Request('https://lexyflow.com/api/resend-webhook', {
      method: 'POST',
      body,
      headers: headers ?? sign(body)
    })
  );
}

beforeEach(() => {
  vi.resetModules();
  suppressed = [];
  process.env['RESEND_WEBHOOK_SECRET'] = SECRET;
});

describe('nothing unsigned gets in', () => {
  it('refuses a missing signature', async () => {
    const res = await post({ type: 'email.complained', data: { to: 'x@example.com' } }, {});
    expect(res.status).toBe(401);
    expect(suppressed).toEqual([]);
  });

  it('refuses a forged signature', async () => {
    const res = await post(
      { type: 'email.complained', data: { to: 'x@example.com' } },
      { 'webhook-id': 'm', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,AAAA' }
    );
    expect(res.status).toBe(401);
  });

  it('refuses a replay from an hour ago', async () => {
    // A captured delivery must not be usable for ever.
    const body = JSON.stringify({ type: 'email.complained', data: { to: 'x@example.com' } });
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const res = await post(JSON.parse(body), sign(body, 'msg_1', old));
    expect(res.status).toBe(401);
  });

  it('says so plainly when no secret is configured', async () => {
    // Unconfigured is not forbidden, and saying which one is what stops
    // an afternoon going to the wrong hypothesis.
    delete process.env['RESEND_WEBHOOK_SECRET'];
    const res = await post({ type: 'email.complained', data: { to: 'x@example.com' } });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('not_configured');
  });
});

describe('what it acts on', () => {
  it('suppresses a spam complaint', async () => {
    const res = await post({ type: 'email.complained', data: { to: 'angry@example.com' } });
    expect(res.status).toBe(200);
    expect(suppressed).toEqual([{ email: 'angry@example.com', reason: 'complained' }]);
  });

  it('suppresses a hard bounce', async () => {
    await post({
      type: 'email.bounced',
      data: { to: ['gone@example.com'], bounce: { type: 'Permanent_HardBounce' } }
    });
    expect(suppressed).toEqual([{ email: 'gone@example.com', reason: 'bounced' }]);
  });

  it('ignores a soft bounce', async () => {
    // A full mailbox or a server having a bad afternoon. Suppressing on
    // one would lose a customer to their own holiday auto-reply.
    const res = await post({
      type: 'email.bounced',
      data: { to: 'busy@example.com', bounce: { type: 'Transient_MailboxFull' } }
    });
    expect((await res.json()).ignored).toBe('soft_bounce');
    expect(suppressed).toEqual([]);
  });

  it('handles a delivery to several recipients', async () => {
    await post({
      type: 'email.bounced',
      data: { to: ['a@example.com', 'b@example.com'], bounce: { type: 'Permanent_HardBounce' } }
    });
    expect(suppressed.map((s) => s.email)).toEqual(['a@example.com', 'b@example.com']);
  });
});

describe('what it deliberately does not store', () => {
  it('ignores opens and clicks', async () => {
    // We sell data minimisation. Knowing that a named person opened an
    // email at 7:14pm is not something we need, and a table of it is a
    // table we would have to defend.
    for (const type of ['email.delivered', 'email.opened', 'email.clicked', 'email.sent']) {
      const res = await post({ type, data: { to: 'someone@example.com' } });
      expect(res.status).toBe(200);
      expect((await res.json()).ignored).toBe(type);
    }
    expect(suppressed).toEqual([]);
  });

  it('answers 200 to a shape it does not recognise', async () => {
    // 400 would make Resend retry an unparseable body for ever.
    const res = await post({ unexpected: true });
    expect(res.status).toBe(200);
  });
});
