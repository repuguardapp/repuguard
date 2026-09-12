import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The J+14 email is the only automated message we send to someone who
 * has used the product and not paid. It is the conversion moment, and
 * it used to waste it twice over.
 *
 * It pitched features to a reader whose document we had just finished
 * analysing, ignoring the risk score and findings sitting in our own
 * database. And it made two false claims in writing — "unlimited
 * audits" for a plan that grants 100 a month, "1 per month on the free
 * tier" for a tier that grants one audit ever — from a company that
 * sells compliance.
 */

vi.mock('server-only', () => ({}));

const sent: { to: string; subject: string; text: string; html: string }[] = [];

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (args: { to: string; subject: string; text: string; html: string }) => {
        sent.push(args);
        return { data: { id: 'msg_1' }, error: null };
      }
    };
  }
}));

vi.mock('../src/lib/supabase', () => ({ supabaseService: () => ({}) }));

async function send(ctx: Parameters<typeof import('../src/lib/email').sendLifecycleUpgrade>[1]) {
  const { sendLifecycleUpgrade } = await import('../src/lib/email');
  await sendLifecycleUpgrade('prospect@example.com', ctx);
  return sent.at(-1)!;
}

beforeEach(() => {
  sent.length = 0;
  vi.resetModules();
  process.env['RESEND_API_KEY'] = 'test-key';
  process.env['NEXT_PUBLIC_APP_URL'] = 'https://lexyflow.com';
});

const PAYWALLED = {
  auditId: '6f70353f-f4ca-4b6b-97de-8fe7511ba289',
  riskScore: 52,
  findingsCount: 5,
  wasPaywalled: true,
  frameworkNames: ['GDPR', 'EU AI Act']
};

describe('J+14 — the reader hears about their own audit', () => {
  it('leads with the findings they have not read', async () => {
    const mail = await send(PAYWALLED);

    // Four of five withheld by the paywall. That number, not a feature
    // list, is the reason to open the email.
    expect(mail.subject).toBe("4 compliance gaps you haven't read yet");
    expect(mail.text).toContain('5 compliance gaps');
    expect(mail.text).toContain('52/100');
    expect(mail.text).toContain('GDPR and EU AI Act');
    // And a direct way back into the report, not a pricing page.
    expect(mail.text).toContain('/dashboard/6f70353f-f4ca-4b6b-97de-8fe7511ba289');
  });

  it('never claims unread findings to someone who paid and read them all', async () => {
    // Sending "you have 4 unread findings" to a customer looking at a
    // fully unlocked report is a lie they can check in one click, and
    // it discredits every other message in the sequence.
    const mail = await send({ ...PAYWALLED, wasPaywalled: false });

    expect(mail.subject).not.toContain('read');
    expect(mail.text).not.toContain('waiting');
    expect(mail.text).toContain('52/100');
  });

  it('does not promise unread findings when the audit found none', async () => {
    const mail = await send({ ...PAYWALLED, findingsCount: 0 });
    expect(mail.subject).not.toContain('0');
    expect(mail.text).not.toContain('The other');
  });

  it('says nothing about a score it does not have', async () => {
    const mail = await send({ ...PAYWALLED, riskScore: null });
    expect(mail.text).not.toContain('/100');
    // The rest of the email still stands on the findings count.
    expect(mail.text).toContain('5 compliance gaps');
  });
});

describe('J+14 — the offer described is the offer sold', () => {
  it('quotes the credit allowance the webhook actually grants', async () => {
    const { PLAN_CREDITS } = await import('../src/lib/stripe');
    const mail = await send(PAYWALLED);

    expect(mail.text).toContain(`${PLAN_CREDITS.pro} audits per month`);
    expect(mail.text).toContain(`${PLAN_CREDITS.starter} audits a month`);
  });

  it('makes neither of the two false claims it used to make', async () => {
    const mail = await send(PAYWALLED);

    // Pro grants 100 audits a month, not unlimited.
    expect(mail.text.toLowerCase()).not.toContain('unlimited');
    // The free tier is one audit ever, not one a month.
    expect(mail.text).not.toContain('1 per month');
  });

  it('carries no evergreen deadline', async () => {
    // "-20% valid for 7 days" sat in an always-on automated email.
    // Either the code never expired, and the urgency was invented, or
    // it had, and we were mailing a dead code to every new signup.
    const mail = await send(PAYWALLED);
    expect(mail.text).not.toContain('LAUNCH20');
    expect(mail.text.toLowerCase()).not.toContain('valid for 7 days');
  });
});
