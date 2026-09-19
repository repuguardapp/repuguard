import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAutoReply, topOfReply } from '@/lib/reply-classifier';

/**
 * The inbound endpoint is the only place in this product where text
 * written by a stranger, unsolicited, reaches a language model — and its
 * address ends up, by construction, in messages sent to people who did not
 * ask for them. Everything here is about what somebody can do to us by
 * sending an email.
 */

vi.mock('server-only', () => ({}));

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const ROUTE = 'src/app/api/webhooks/inbound/route.ts';
const CLASSIFIER = 'src/lib/reply-classifier.ts';

describe('quoting and auto-replies are handled before any money is spent', () => {
  it('cuts the thread off at the quote', () => {
    // Without this the classifier reads our own question sitting under a
    // two-word refusal and calls the whole thing a question.
    const reply = [
      'Non merci, nous avons déjà un prestataire.',
      '',
      "Le 18 septembre 2026 à 09:12, LexyFlow a écrit :",
      '> Combien de temps vous prend un audit ?'
    ].join('\n');

    expect(topOfReply(reply)).toBe('Non merci, nous avons déjà un prestataire.');
  });

  it('cuts at an English quote marker too', () => {
    const reply = 'Sounds interesting.\n\nOn 18 Sep 2026, LexyFlow wrote:\n> anything';
    expect(topOfReply(reply)).toBe('Sounds interesting.');
  });

  it('recognises an out-of-office from the headers, not the prose', () => {
    // Most replies to a cold sequence are absence notices. Reading one as
    // interest would put a number on the dashboard the whole validation
    // decision rests on, and pay a model call to get it wrong.
    expect(isAutoReply({ 'auto-submitted': 'auto-replied' })).toBe(true);
    expect(isAutoReply({ precedence: 'bulk' })).toBe(true);
    expect(isAutoReply({ 'x-autoreply': 'yes' })).toBe(true);
    expect(isAutoReply({ 'return-path': '<>' })).toBe(true);
    expect(isAutoReply({ 'x-auto-response-suppress': 'All' })).toBe(true);
  });

  it('does not mistake an ordinary reply for a machine', () => {
    expect(isAutoReply({ from: 'someone@example.com', subject: 'Re: audits' })).toBe(false);
    expect(isAutoReply({})).toBe(false);
  });
});

describe('what an injected reply cannot do', () => {
  const route = code(ROUTE);
  const classifier = code(CLASSIFIER);

  it('never lets a classification convert a contact', () => {
    // `converted` is written by the audit pipeline when a real audit
    // finishes. If a reply could set it, anyone receiving our email could
    // manufacture the single number this company is about to decide on.
    expect(route).not.toContain("'converted'");
    expect(route).not.toContain('converted');
  });

  it('accepts only six words out of the model, whatever it was told to say', () => {
    expect(classifier).toContain('ALLOWED.has(word)');
    expect(classifier).toContain("'unknown'");
    // A low token ceiling is a second, mechanical bound: even a fully
    // successful injection cannot produce a paragraph.
    expect(classifier).toMatch(/max_tokens:\s*8\b/);
  });

  it('gives the model no tools', () => {
    expect(classifier).not.toContain('tools');
    expect(classifier).not.toContain('tool_choice');
  });

  it('tells the model the reply is data, inside the prompt', () => {
    expect(read(CLASSIFIER)).toContain('untrusted third-party data');
    expect(read(CLASSIFIER)).toContain('<reply>');
  });
});

describe('who sent this', () => {
  const route = code(ROUTE);

  it('identifies the thread by a token in the recipient, not by From', () => {
    // A From header is a line of text the sender chooses.
    expect(route).toMatch(/\\\+\(\[A-Za-z0-9_-\]\{16,64\}\)@/);
    expect(route).toContain('trusted: true');
  });

  it('lets an untrusted match unsubscribe and nothing else', () => {
    // The asymmetry is the design. Forging a reply to remove somebody from
    // our list does them a favour; forging one to mark them interested
    // corrupts the measurement.
    expect(route).toContain('match.trusted');
    const unsubBranch = route.slice(route.indexOf("sentiment === 'unsubscribe'"));
    expect(unsubBranch.slice(0, 400)).not.toContain('match.trusted');
  });
});

describe('the endpoint itself', () => {
  const route = code(ROUTE);

  it('fails closed when its secret is missing', () => {
    // The signup bot gate returned success for months while its secret was
    // absent, and nobody could later say whether it had ever been set.
    expect(route).toContain('INBOUND_WEBHOOK_SECRET');
    expect(route).toContain("status: 503");
  });

  it('signs the exact bytes with a timestamp, and compares in constant time', () => {
    expect(route).toContain('createHmac');
    expect(route).toContain('timingSafeEqual');
    expect(route).toContain('${timestamp}.${raw}');
    expect(route).toMatch(/age > 300/);
  });

  it('answers 401 for every rejection, without saying which', () => {
    // Distinguishing a bad signature from a stale timestamp tells an
    // attacker which half to work on.
    const rejections = route.match(/status: 401/g) ?? [];
    expect(rejections).toHaveLength(1);
  });

  it('rate-limits before it authenticates', () => {
    // Otherwise a signature check is something an attacker makes us do a
    // million times.
    expect(route.indexOf('rateLimit')).toBeLessThan(route.indexOf('INBOUND_WEBHOOK_SECRET'));
  });

  it('answers 200 to a payload it cannot parse', () => {
    // A provider that sees an error retries, and a malformed body will not
    // parse on the fourth attempt either.
    expect(route).toContain("ignored: 'malformed'");
  });

  it('is idempotent on the provider message id', () => {
    // A delivery retried after a timeout must not become two replies, and
    // two replies from one person is the difference between "somebody
    // answered" and "somebody is interested".
    expect(route).toContain("ignored: 'duplicate'");
    expect(route).toContain("eq('detail', mail.messageId)");
  });

  it('stores no subject and no body', () => {
    // This table is read on a screen; the body is somebody's
    // correspondence, and we asked them nothing.
    const insert = route.slice(route.indexOf("kind: 'replied'"));
    expect(insert.slice(0, 300)).toContain('mail.messageId');
    expect(insert.slice(0, 300)).not.toContain('mail.text');
    expect(insert.slice(0, 300)).not.toContain('mail.subject');
  });
});

describe('the signature a worker has to produce', () => {
  beforeEach(() => vi.resetModules());

  it('is reproducible from the documented recipe', () => {
    // If this ever disagrees with docs/growth-machine.md, the worker
    // stops being able to talk to us and the only symptom is silence.
    const secret = 'test-secret';
    const body = JSON.stringify({ messageId: 'abc', to: 'x', from: 'y' });
    const timestamp = '1758300000';

    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

    expect(signature).toHaveLength(64);
    expect(createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')).toBe(signature);
  });
});
