import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The half hour in front of the send, and the two things that stay.
 *
 * Mounir's objection was not to the e-mail. It was to spending thirty
 * minutes per round opening a search engine, reading recent articles on
 * CNIL sanctions, noting who signed them. That half hour is machine
 * work: the publications publish RSS feeds, which exist to be read by
 * machines, and our seven observations give a precise filter.
 *
 * What does not move is the address and the send, and the reasons are
 * different. Collecting professional contacts into our database makes us
 * the controller of personal data obtained from somewhere other than the
 * person — Article 14, and a duty to notify every one of them within a
 * month. That is the file we deleted, rebuilt one row at a time. The
 * send is not a legal objection at all: ten identical messages leaving
 * one mailbox in a minute are a sequence and are read as one.
 */
const SRC = readFileSync(join(__dirname, '..', 'src/lib/press-candidates.ts'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('it reads articles and collects nobody', () => {
  it('writes no personal data anywhere', () => {
    // No table, no cache, no log line carrying a name. What is handled
    // is an article: a public document with a public byline, held for
    // one page render.
    expect(code).not.toContain('supabase');
    expect(code).not.toContain('.insert(');
    expect(code).not.toContain('console.log');
  });

  it('never looks for an address', () => {
    expect(code).not.toMatch(/mailto|@[a-z]+\.[a-z]{2,}|email|courriel/i);
  });

  it('never sends anything', () => {
    expect(code).not.toContain('resend');
    expect(code).not.toContain('sendOps');
    expect(code).not.toMatch(/method:\s*'POST'/);
  });
});

describe('it is a crawler and behaves like our other crawlers', () => {
  it('reads robots.txt first and obeys it', () => {
    expect(code).toContain('robotsAllows');
    expect(code).toContain('isAllowed(url.pathname');
  });

  it('refuses to read when robots.txt is unreadable', () => {
    // Unknown means unknown. Same rule as the policy crawler.
    const fn = code.slice(code.indexOf('async function robotsAllows'));
    expect(fn).toContain('return false');
  });

  it('identifies itself and goes through the SSRF-guarded fetch', () => {
    expect(code).toContain('LexyFlowPressWatch/1.0 (+https://lexyflow.com)');
    expect(code).toContain('fetchExternal');
  });
});

describe('a dead feed says so instead of returning fewer leads', () => {
  it('records an outcome for every feed, failures included', () => {
    // The ranking this whole study is built on answered 404 eight times
    // before anybody looked. A silent shortfall is the same bug.
    expect(code).toContain('refused: string | null');
    expect(code).toContain('feeds.push(outcome)');
    expect(code).toContain("a répondu HTTP");
    expect(code).toContain('aucune entrée exploitable dans le flux');
  });

  it('is a list of candidates rather than a constant anybody trusts', () => {
    expect(code).toContain('export const PRESS_FEEDS');
    expect(SRC).toContain('Feeds to try, not feeds we know work');
  });
});

describe('the drafted line quotes the article and judges it', () => {
  it('names the piece and its date, which is checkable', () => {
    expect(code).toContain('Je vous écris après avoir lu');
  });

  it('never summarises or compliments the article', () => {
    // A machine telling a journalist what their own piece argued is the
    // tell that nobody read it, and a compliment we did not mean is a
    // small lie.
    const fn = code.slice(code.indexOf('function suggestLine'));
    expect(fn).not.toMatch(/excellent|intéressant|pertinent|remarquable|votre analyse/i);
  });
});
