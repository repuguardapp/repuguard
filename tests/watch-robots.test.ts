import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from '@/lib/robots';

/**
 * The scan has obeyed robots.txt since it shipped. The legal watcher read
 * robots.txt too — and only ever to harvest `Sitemap:` lines out of it.
 * It polled ten regulators four times a day for months without once
 * asking whether it was allowed to. Nobody noticed, because a refusal
 * arrives as a 403 and a 403 looks like a WAF.
 */

const WATCHER = readFileSync(
  join(__dirname, '..', 'src', 'app', 'api', 'cron', 'watch-legal', 'route.ts'),
  'utf8'
);

describe('the watcher asks before it fetches', () => {
  it('checks robots.txt before the feed, the children and the probes', () => {
    // Three call sites, and the probe is one of them: guessing at paths a
    // site asked us not to touch is the same act as fetching them on
    // purpose.
    expect(WATCHER.match(/robotsAllows\(/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('identifies itself as the watcher, not as the scan', () => {
    // Two crawlers doing two different things to two different kinds of
    // site. A regulator may allow one and refuse the other, and checking
    // the watcher against the scan's rules answers the wrong question.
    expect(WATCHER).toContain("const WATCH_AGENT = 'LexyFlowLegalWatch'");
    expect(WATCHER).toContain('parseRobots((await res.text()).slice(0, 200_000), WATCH_AGENT)');
  });

  it('records a refusal as their decision, not as our failure', () => {
    expect(WATCHER).toContain('we do not fetch it');
    expect(WATCHER).toContain('their permission');
  });
});

describe('rules are read under the right name', () => {
  const ROBOTS = [
    'User-agent: LexyFlowScan',
    'Disallow: /',
    '',
    'User-agent: LexyFlowLegalWatch',
    'Allow: /anpd/',
    'Disallow: /private/'
  ].join('\n');

  it('applies the group that names this crawler', () => {
    const rules = parseRobots(ROBOTS, 'LexyFlowLegalWatch');
    expect(isAllowed('/anpd/pt-br/assuntos/noticias', rules)).toBe(true);
    expect(isAllowed('/private/x', rules)).toBe(false);
  });

  it('does not read the watcher against the scan group', () => {
    // The whole point of the parameter: the same file says "no" to one
    // agent and "yes" to the other.
    const asScan = parseRobots(ROBOTS, 'LexyFlowScan');
    expect(isAllowed('/anpd/pt-br/assuntos/noticias', asScan)).toBe(false);
  });

  it('falls back to the wildcard group when we are not named', () => {
    const wildcard = parseRobots('User-agent: *\nDisallow: /admin/', 'LexyFlowLegalWatch');
    expect(isAllowed('/admin/x', wildcard)).toBe(false);
    expect(isAllowed('/news/x', wildcard)).toBe(true);
  });
});
