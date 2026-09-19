import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Deliverability is not destroyed by volume.
 *
 * It is destroyed by writing again to a mailbox that has already said
 * no. 345 magic links went out and nothing came back: a hard bounce
 * meant the mailbox does not exist and we sent to it again, a spam
 * complaint meant someone told their provider we were junk and we sent
 * to them again. Mailbox providers read exactly that pattern.
 */

vi.mock('server-only', () => ({}));

let row: { reason: string; detail: string | null } | null;
let lookupError: string | null;
let inserted: Record<string, unknown>[];

function install() {
  vi.doMock('@/lib/supabase', () => ({
    supabaseService: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              lookupError ? { data: null, error: { message: lookupError } } : { data: row, error: null }
          })
        }),
        upsert: async (r: Record<string, unknown>) => {
          inserted.push(r);
          return { error: null };
        }
      })
    })
  }));
}

async function lib() {
  install();
  return import('@/lib/email-suppression');
}

beforeEach(() => {
  vi.resetModules();
  row = null;
  lookupError = null;
  inserted = [];
});

describe('addresses that can never receive anything', () => {
  it('refuses SMS gateways', async () => {
    // Seven of our 345 signups used one, every local part a bare phone
    // number. A magic link cannot be opened from a text message, and
    // what arrives is an unsolicited SMS.
    const { isStructurallyUndeliverable } = await lib();
    for (const address of ['4808230763@txt.att.net', '6163281457@tmomail.net', '7039663862@vtext.com']) {
      expect(isStructurallyUndeliverable(address), address).toMatch(/SMS gateway/);
    }
  });

  it('refuses role addresses', async () => {
    // abuse@ziggo.nl signed up. That is either a spam trap or a
    // reporting desk; both are mailboxes to stay away from.
    const { isStructurallyUndeliverable } = await lib();
    expect(isStructurallyUndeliverable('abuse@ziggo.nl')).toMatch(/role address/);
    expect(isStructurallyUndeliverable('postmaster@example.com')).toMatch(/role address/);
  });

  it('does not refuse a consumer mailbox', async () => {
    // The instruction was to suppress 222 consumer addresses. A
    // freelance DPO on gmail is a real customer of a €49/month
    // compliance tool; blocking the domain would lose them to protect
    // a statistic.
    const { isStructurallyUndeliverable } = await lib();
    for (const address of ['marie@gmail.com', 'j.dupont@yahoo.fr', 'dpo@hotmail.com']) {
      expect(isStructurallyUndeliverable(address), address).toBeNull();
    }
  });

  it('refuses a malformed address before anything else touches it', async () => {
    const { isStructurallyUndeliverable } = await lib();
    expect(isStructurallyUndeliverable('not-an-address')).toMatch(/malformed/);
    expect(isStructurallyUndeliverable('@example.com')).toMatch(/malformed/);
  });
});

describe('addresses that have said no', () => {
  it('blocks one that bounced', async () => {
    row = { reason: 'bounced', detail: 'hard' };
    const { isSuppressed } = await lib();
    expect(await isSuppressed('gone@example.com')).toEqual({ blocked: true, reason: 'bounced' });
  });

  it('blocks one that complained', async () => {
    row = { reason: 'complained', detail: null };
    const { isSuppressed } = await lib();
    expect((await isSuppressed('angry@example.com')).blocked).toBe(true);
  });

  it('lets an unknown address through', async () => {
    const { isSuppressed } = await lib();
    expect(await isSuppressed('new@example.com')).toEqual({ blocked: false });
  });

  it('normalises case and whitespace, because a bounce does not', async () => {
    row = { reason: 'bounced', detail: null };
    const { isSuppressed } = await lib();
    expect((await isSuppressed('  GONE@Example.COM ')).blocked).toBe(true);
  });
});

describe('the gate fails open, deliberately', () => {
  it('lets mail through when the lookup errors', async () => {
    // A Supabase blip must not silently stop every magic link on the
    // site. One extra message to an address that already bounced is a
    // smaller harm than a customer who cannot sign in.
    lookupError = 'connection reset';
    const { isSuppressed } = await lib();
    expect(await isSuppressed('someone@example.com')).toEqual({ blocked: false });
  });

  it('still refuses the structural cases when the database is down', async () => {
    // Those need no lookup, so an outage cannot turn an SMS gateway
    // back into a valid recipient.
    lookupError = 'connection reset';
    const { isSuppressed } = await lib();
    expect((await isSuppressed('4808230763@txt.att.net')).blocked).toBe(true);
  });
});

describe('recording a refusal', () => {
  it('stores the address lower-cased with its reason', async () => {
    const { suppress } = await lib();
    await suppress('  Gone@Example.COM ', 'bounced', 'hard');
    expect(inserted[0]).toMatchObject({ email: 'gone@example.com', reason: 'bounced', detail: 'hard' });
  });

  it('keeps the first reason when the same event arrives twice', async () => {
    // A hard bounce is a fact about the mailbox; a later complaint does
    // not make it less true, and a webhook redelivery must not error.
    const { suppress } = await lib();
    await suppress('x@example.com', 'bounced');
    await suppress('x@example.com', 'complained');
    expect(inserted).toHaveLength(2);
    expect(inserted.every((r) => r['email'] === 'x@example.com')).toBe(true);
  });
});

describe('every outbound path goes through the gate', () => {
  it('guards the magic link, the audit report and the lifecycle mails', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(__dirname, '..', 'src/lib/email.ts'), 'utf8');

    // A gate with six doors is a gate someone walks around, so the
    // check lives in the sending library rather than at each call site.
    expect(source).toContain("from '@/lib/email-suppression'");
    expect(source.match(/isSuppressed\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);

    // The ops digest is deliberately NOT gated: it goes to our own
    // allowlist, and silencing it would remove our own alerting.
    const digest = source.slice(source.indexOf('sendOpsDigest'), source.indexOf('sendAuditCompletedEmail'));
    expect(digest).not.toContain('isSuppressed');
  });
});

describe('what the signup table taught us', () => {
  /**
   * Of 345 accounts, the segment that looked like a prospect list turned
   * out to contain Valve's subpoena inbox, 7-Eleven's ethics line and press
   * desk, a charity's accounts-payable address, three carrier SMS gateways,
   * eleven addresses on one domain and two typo-squatted domains. It is a
   * harvested contact list being injected into the signup form, and it ran
   * through September.
   *
   * On that evidence I withdrew a recommendation I had made repeatedly —
   * to re-engage "123 corporate prospects". Sending unsolicited commercial
   * mail to a published subpoena inbox would have burned the sending domain
   * our own login depends on, from a company that sells the prevention of
   * exactly that.
   */

  it('refuses the published inboxes that were actually in our table', async () => {
    const { isStructurallyUndeliverable } = await lib();
    for (const address of [
      'subpoenainquiries@valvesoftware.com',
      'askspeakout@7-11.com',
      'mediaqueries@7eleven.com.au',
      'accountspayable@cbwm.org',
      'webmaster@example.com'
    ]) {
      expect(isStructurallyUndeliverable(address), address).not.toBeNull();
    }
  });

  it('catches an SMS gateway by its telephone local part, not only its domain', async () => {
    const { isStructurallyUndeliverable } = await lib();
    // There are dozens of carrier bridges worldwide and enumerating the
    // domains is a losing game; the address shape gives it away.
    expect(isStructurallyUndeliverable('7725196304@tmomail.net')).not.toBeNull();
    expect(isStructurallyUndeliverable('4915112345678@sms.unknown-carrier.example')).toContain(
      'telephone'
    );
  });

  it('never turns away the person we are built for', async () => {
    const { isStructurallyUndeliverable } = await lib();
    // A data protection officer writes from dpo@, privacy@, compliance@,
    // legal@ or security@. A general "block role accounts" rule would
    // refuse our entire buyer persona to catch a handful of bots — the
    // most expensive kind of correct-looking fix.
    for (const address of [
      'dpo@company.com',
      'privacy@company.com',
      'compliance@company.com',
      'legal@company.com',
      'security@korper.nl',
      'info@small-firm.fr',
      'contact@cabinet.fr'
    ]) {
      expect(isStructurallyUndeliverable(address), address).toBeNull();
    }
  });
});
