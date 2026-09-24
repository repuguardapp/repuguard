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

const sent: {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}[] = [];

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (args: {
        to: string;
        subject: string;
        text: string;
        html: string;
        headers?: Record<string, string>;
      }) => {
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
  // No opt-out token, no send — pinned by its own test at the bottom of
  // this file. Every case above it is about the copy, so it needs a
  // deployment that is allowed to write to somebody.
  process.env['MARKETING_OPTOUT_SECRET'] = 'test-secret-long-enough-to-be-a-secret';
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

    // The numbers, next to the plan that grants them. Asserted as
    // behaviour rather than as an exact sentence: the copy is allowed to
    // change, the arithmetic is not.
    expect(mail.text).toMatch(new RegExp(`Starter[^\\n]*\\b${PLAN_CREDITS.starter}\\b`));
    expect(mail.text).toMatch(new RegExp(`Pro[^\\n]*\\b${PLAN_CREDITS.pro}\\b`));
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

describe('the offer described is the offer the code gates', () => {
  it('claims none of the three features every tier already has', async () => {
    // The email listed four things under "The Pro plan adds". Three were
    // not Pro features at all:
    //
    //   - the full findings list — lib/paywall.ts gates on creditConsumed,
    //     so any paid audit shows everything, Starter included;
    //   - the AI editor — api/audit/[id]/rewrite authorises on org
    //     ownership and checks no plan;
    //   - cross-framework audits — the audit route takes
    //     z.array(...).min(1) with no upper bound and no plan check, and
    //     the very email saying Pro adds it told the reader they had
    //     already audited against two frameworks.
    //
    // Named individually, the way the two earlier false claims are, so a
    // future rewrite has to read why they went.
    const mail = await send(PAYWALLED);
    const text = mail.text.toLowerCase();

    expect(text).not.toContain('the pro plan adds');
    expect(text).not.toContain('ai editor');
    expect(text).not.toContain('cross-framework');
  });
});

describe('no marketing email goes out that cannot be stopped', () => {
  it('carries an opt-out link and the one-click headers', async () => {
    const mail = await send(PAYWALLED);

    expect(mail.text).toContain('/api/email/optout/');
    expect(mail.html).toContain('/api/email/optout/');
    // RFC 8058. Gmail and Yahoo have required this of bulk senders since
    // 2024, and the POST is what their own native button calls.
    expect(mail.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/.+\/api\/email\/optout\/.+>$/);
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('sends nothing at all when the opt-out secret is missing', async () => {
    // The tempting behaviour is to send anyway without a link. An email
    // somebody cannot escape from is an email we are not entitled to
    // send, so the absence of the secret stops the send rather than
    // degrading it — and it is a deployment that has not been finished,
    // not a runtime error.
    delete process.env['MARKETING_OPTOUT_SECRET'];

    const { sendLifecycleUpgrade } = await import('../src/lib/email');
    const ok = await sendLifecycleUpgrade('prospect@example.com', PAYWALLED);

    expect(ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('gives two different recipients two different tokens', async () => {
    // A shared token would let anyone unsubscribe anyone, and would make
    // the link in a forwarded email act on the wrong person.
    const { sendLifecycleUpgrade } = await import('../src/lib/email');
    await sendLifecycleUpgrade('one@example.com', PAYWALLED);
    await sendLifecycleUpgrade('two@example.com', PAYWALLED);

    const tokens = sent.map((m) => /optout\/([A-Za-z0-9_-]+)/.exec(m.text)?.[1]);
    expect(tokens[0]).toBeTruthy();
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('never puts the address in the unsubscribe URL', async () => {
    // A link carrying the e-mail leaks it to every referrer, proxy and
    // log between the inbox and us. This project forbids it outright.
    const { sendLifecycleUpgrade } = await import('../src/lib/email');
    await sendLifecycleUpgrade('reader@example.com', PAYWALLED);
    const url = /https:\/\/\S*optout\S*/.exec(sent.at(-1)!.text)?.[0] ?? '';

    expect(url).not.toContain('reader@example.com');
    expect(url).not.toContain('reader');
    expect(url).not.toContain('%40');
  });
});
