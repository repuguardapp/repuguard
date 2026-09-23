import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A date we do not know is not a date we may state.
 *
 * Every entry in the sitemap used to carry `lastModified: new Date()`,
 * and the file regenerates hourly, so we told Google that all ~469 pages
 * had changed one hour ago — every hour, for ever. The pricing page has
 * not changed since it shipped. That is a fact about our own site,
 * asserted to a machine in order to influence what it does, and it is
 * false. It is the SEO version of filling in a review field we have no
 * reviews for, and the answer is the same one: the field goes.
 *
 * Asserted against the source text rather than by rendering the route,
 * because the route reads the database and discovers locales from the
 * filesystem. What matters here is that nobody reintroduces a
 * manufactured date, and that is visible in the file.
 */

const SOURCE = readFileSync(join(__dirname, '..', 'src', 'app', 'sitemap.ts'), 'utf8');

describe('the sitemap states no date it cannot source', () => {
  it('never stamps entries with the current time', () => {
    // `new Date()` with no argument is now. In a file regenerated hourly
    // that is a claim about every page on the site, renewed every hour.
    expect(SOURCE).not.toMatch(/lastModified:\s*now\b/);
    expect(SOURCE).not.toMatch(/lastModified:\s*new Date\(\s*\)/);
    expect(SOURCE).not.toMatch(/const now = new Date\(\)/);
  });

  it('dates the decision pages from the row that was actually modified', () => {
    // The one family whose modification date we genuinely hold.
    expect(SOURCE).toContain('entry.updatedAt');
    expect(SOURCE).toContain('new Date(entry.updatedAt)');
  });

  it('omits the field rather than inventing one when there is no date', () => {
    // A published row with a null updated_at gets no lastmod at all, not
    // a substitute. Spread-on-condition is how that is expressed here.
    expect(SOURCE).toMatch(/entry\.updatedAt\s*\?\s*\{\s*lastModified/);
  });
});
