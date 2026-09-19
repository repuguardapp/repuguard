import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots, USER_AGENT } from '@/lib/robots';

/**
 * A compliance company that ignores robots.txt to run a compliance scan has
 * lost the argument before it starts.
 *
 * Every test here is about erring in one direction: where the standard is
 * ambiguous or the parser is unsure, the answer is "not allowed". A scan we
 * did not run costs a page. A scan we ran against a site's stated wishes
 * costs the thing we sell.
 */

describe('which group applies to us', () => {
  it('prefers a group that names us over the wildcard', () => {
    const robots = parseRobots(
      `User-agent: *\nDisallow: /\n\nUser-agent: ${USER_AGENT}\nAllow: /\nDisallow: /admin`
    );
    // A site that names us has gone to the trouble of having an opinion.
    expect(isAllowed('/privacy', robots)).toBe(true);
    expect(isAllowed('/admin', robots)).toBe(false);
  });

  it('falls back to the wildcard when we are not named', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /private');
    expect(isAllowed('/privacy', robots)).toBe(true);
    expect(isAllowed('/private/x', robots)).toBe(false);
  });

  it('shares one rule block between consecutive user-agent lines', () => {
    const robots = parseRobots(`User-agent: Googlebot\nUser-agent: ${USER_AGENT}\nDisallow: /no`);
    expect(isAllowed('/no', robots)).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    const robots = parseRobots('# a comment\n\nUser-agent: *   # trailing\nDisallow: /x');
    expect(isAllowed('/x', robots)).toBe(false);
    expect(isAllowed('/y', robots)).toBe(true);
  });
});

describe('precedence', () => {
  it('lets the longest match win', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /legal\nAllow: /legal/privacy');
    expect(isAllowed('/legal/terms', robots)).toBe(false);
    expect(isAllowed('/legal/privacy', robots)).toBe(true);
  });

  it('lets Allow win at equal length', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /p\nAllow: /p');
    expect(isAllowed('/p', robots)).toBe(true);
  });

  it('treats an empty Disallow as no rule at all', () => {
    // "Disallow:" with nothing after it means nothing is disallowed, and
    // reading it as "disallow everything" would refuse half the web.
    const robots = parseRobots('User-agent: *\nDisallow:');
    expect(isAllowed('/anything', robots)).toBe(true);
  });
});

describe('wildcards and anchors', () => {
  it('matches * inside a pattern', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /*/private');
    expect(isAllowed('/a/private', robots)).toBe(false);
    expect(isAllowed('/a/public', robots)).toBe(true);
  });

  it('honours $ as an end anchor', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /*.pdf$');
    expect(isAllowed('/policy.pdf', robots)).toBe(false);
    expect(isAllowed('/policy.pdf.html', robots)).toBe(true);
  });

  it('treats a pattern as a prefix, not a substring', () => {
    // `/admin` must not block `/public/admin-guide`.
    const robots = parseRobots('User-agent: *\nDisallow: /admin');
    expect(isAllowed('/public/admin-guide', robots)).toBe(true);
  });
});

describe('when we do not know', () => {
  it('refuses when robots.txt could not be read', () => {
    // Stricter than every crawler in existence, and the right default for a
    // product whose whole claim is that it respects rules other people set.
    expect(isAllowed('/privacy', { rules: [], unknown: true })).toBe(false);
  });

  it('allows everything when the site published no rules', () => {
    // A 404 on robots.txt means the site has no opinion, which the standard
    // reads as "everything is allowed". That is different from unreadable.
    expect(isAllowed('/privacy', { rules: [], unknown: false })).toBe(true);
  });
});
