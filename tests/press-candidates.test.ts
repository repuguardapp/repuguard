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

/**
 * A list of people to write to that contained no people.
 *
 * Mounir opened this page ready to send, found press releases, and
 * concluded there was nobody to contact. He was reading the page
 * correctly. The signed articles were in the list — the ranking had
 * pushed them below the fold, and the thing pushing them was a feed
 * that cannot produce a contact at all.
 *
 * A regulator's release trips four of the topic patterns (CNIL, RGPD,
 * politique de confidentialité, conformité) where a journalist writing
 * about one of them trips two. Sorting by how many matched made the
 * institution win every time, by construction.
 */
describe('only feeds with a byline can produce somebody to write to', () => {
  it('declares what each feed is, rather than hinting at it in the label', () => {
    // The old marker was the words "(pour le contexte)" inside a display
    // string. That told a human and told the code nothing.
    const feeds = [...SRC.matchAll(/id: '([a-z-]+)',[\s\S]{0,300}?kind: '(press|institution)'/g)];
    expect(feeds.length).toBeGreaterThanOrEqual(6);
    const kinds = Object.fromEntries(feeds.map((m) => [m[1], m[2]]));
    expect(kinds['cnil']).toBe('institution');
    expect(kinds['next']).toBe('press');
  });

  it('keeps the regulator polled and out of the candidates', () => {
    // Removed from the list it would stop being watched, and a feed
    // nobody watches is a feed nobody notices dying.
    expect(SRC).toContain("id: 'cnil'");
    expect(code).toContain("if (feed.kind === 'institution') continue;");
  });

  it('skips the institution after fetching it, so a dead one still reports', () => {
    // Skipping before the fetch would make a broken regulator feed look
    // identical to a healthy one — the exact failure this module exists
    // to prevent.
    expect(code.indexOf('await fetchExternal(feed.url')).toBeLessThan(
      code.indexOf("if (feed.kind === 'institution') continue;")
    );
  });

  it('gives every feed an id that names its own publication', () => {
    // The id was `lalettrea` and the label was Acteurs publics. An id
    // naming a different publication cannot attribute a failure, which
    // is the only job an id has here.
    // Scoped to the feed array: `cnil` is legitimately both a feed id
    // and a topic id, and conflating the two namespaces would make this
    // test fail on something that is not a defect.
    const block = SRC.slice(
      SRC.indexOf('export const PRESS_FEEDS'),
      SRC.indexOf('const TOPICS')
    );
    const ids = [...block.matchAll(/\bid: '([a-z-]+)'/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('lalettrea');
  });
});

describe('fit is weighted, not counted', () => {
  it('ranks the specialist above the round-up', () => {
    expect(code).toContain('if (b.fit !== a.fit) return b.fit - a.fit;');
    expect(code).not.toContain('b.topics.length - a.topics.length');
  });

  it('weights international transfers highest, because that is the finding', () => {
    // 14 of 106 is the headline. Somebody who has just written on
    // transfers is the best recipient in the list; somebody whose piece
    // merely contains "RGPD" is not.
    const weights = Object.fromEntries(
      [...SRC.matchAll(/id: '(transfers|policy|cookies|cnil|gdpr|dpo)',[\s\S]{0,900}?weight: (\d)/g)].map(
        (m) => [m[1], Number(m[2])]
      )
    );
    expect(weights['transfers']).toBeGreaterThan(weights['cnil']!);
    expect(weights['transfers']).toBeGreaterThan(weights['gdpr']!);
    expect(weights['policy']).toBeGreaterThan(weights['dpo']!);
  });
});
