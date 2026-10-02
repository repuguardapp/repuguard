import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Discovery, actually run — against a site we built.
 *
 * Its companion file asserts things about this module's source text,
 * which is the right tool for "it must never do X". It is the wrong tool
 * for "it finds the document", and the gap cost a real number: the
 * observatory's largest refusal bucket was "the homepage was read and
 * links to no privacy policy", on lefigaro.fr, leparisien.fr,
 * francetvinfo.fr, radiofrance.fr, paris.fr and rfi.fr — sites whose
 * footers carry the link in plain sight. Every static test passed the
 * whole time.
 *
 * So these fetch a site. The site is a fixture in this file, which means
 * the awkward footers can be the ones that actually broke us.
 */

vi.mock('server-only', () => ({}));

/** path or absolute url → body. Anything not listed answers 404. */
let site: Record<string, string>;
let requested: string[];

function install() {
  vi.doMock('@/lib/safe-fetch', () => ({
    describeFetchError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    fetchExternal: async (raw: string) => {
      requested.push(raw);
      const body = site[raw] ?? site[new URL(raw).pathname];
      if (body === undefined) {
        return { ok: false, status: 404, url: raw, text: async () => '' } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        url: raw,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => body
      } as unknown as Response;
    }
  }));
}

async function discover(domain: string) {
  const { discoverPolicy } = await import('@/lib/policy-discovery');
  return discoverPolicy(domain);
}

const homepage = (footer: string) =>
  `<html><body><main>Actualités</main><footer>${footer}</footer></body></html>`;

beforeEach(() => {
  vi.resetModules();
  requested = [];
  site = { '/robots.txt': 'User-agent: *\nAllow: /\n' };
  install();
});

afterEach(() => vi.resetModules());

describe('the words a footer is written in', () => {
  it('finds a link whose accents arrive as HTML entities', async () => {
    // What a CMS emits by default, and what produced "this site links to
    // no privacy policy" for five French national newspapers. Only
    // &nbsp; and &amp; were being decoded, so the matcher compared
    // "politique de confidentialit&eacute;" against the accented word
    // and found nothing. The sentence was about our decoder and was
    // published as a sentence about their footer.
    site['/'] = homepage(
      '<a href="/politique-de-confidentialit">Politique de confidentialit&eacute;</a>'
    );

    const found = await discover('example.fr');

    expect(found.refused).toBeNull();
    expect(found.candidates[0]!.provenance).toBe('linked-from-homepage');
    expect(found.candidates[0]!.url).toBe('https://example.fr/politique-de-confidentialit');
  });

  it('decodes numeric references too, not a list of named ones', async () => {
    site['/'] = homepage('<a href="/vie-privee">Donn&#233;es personnelles</a>');

    const found = await discover('example.fr');
    expect(found.refused).toBeNull();
    expect(found.candidates[0]!.url).toBe('https://example.fr/vie-privee');
  });

  it('still refuses a footer that names no policy', async () => {
    // The decoder must not become a reason to match loosely. "Nothing
    // found" has to stay available as an answer, or every site gets a
    // document and some of them get the wrong one.
    site['/'] = homepage('<a href="/contact">Nous contacter</a>');

    const found = await discover('example.fr');
    expect(found.candidates).toHaveLength(0);
    expect(found.refused).toContain('links to no privacy policy');
  });
});

describe('a policy the site keeps on another hostname', () => {
  it('follows the link and labels it as off-site', async () => {
    // google.fr does not host Google's privacy policy and never will.
    // Refusing the link because the hostname differs reports "no policy
    // found" about a site that published one — and the module already
    // follows the site's own redirect off-origin for exactly this
    // reason.
    site['/'] = homepage('<a href="https://policies.example.com/privacy">Confidentialité</a>');
    site['https://policies.example.com/robots.txt'] = 'User-agent: *\nAllow: /\n';

    const found = await discover('example.fr');

    expect(found.refused).toBeNull();
    expect(found.candidates[0]!.provenance).toBe('linked-offsite');
    expect(found.candidates[0]!.url).toBe('https://policies.example.com/privacy');
  });

  it('asks the other hostname before using its page', async () => {
    // Its robots.txt, not ours. The rules we hold answer for the origin
    // that was typed; applying them to somebody else's server is asking
    // the wrong site for permission.
    site['/'] = homepage('<a href="https://policies.example.com/privacy">Confidentialité</a>');
    site['https://policies.example.com/robots.txt'] = 'User-agent: *\nDisallow: /\n';

    const found = await discover('example.fr');

    expect(requested).toContain('https://policies.example.com/robots.txt');
    expect(found.candidates).toHaveLength(0);
  });

  it('prefers the policy on the domain that was typed', async () => {
    site['/'] = homepage(
      '<a href="https://policies.example.com/privacy">Privacy</a>' +
        '<a href="/confidentialite">Politique de confidentialité</a>'
    );

    const found = await discover('example.fr');

    expect(found.candidates).toHaveLength(1);
    expect(found.candidates[0]!.provenance).toBe('linked-from-homepage');
    // And nobody's robots.txt was fetched for a link we did not need.
    expect(requested).not.toContain('https://policies.example.com/robots.txt');
  });
});

describe('the sitemap, which this module has promised since it was written', () => {
  it('reads the site’s own sitemap before guessing at paths', async () => {
    // The Provenance type has carried 'listed-in-sitemap' and a comment
    // describing it from the first commit, and nothing ever produced
    // one. One request to a file that exists to be read by clients like
    // ours beats six guesses on their server, and it finds the document
    // whatever they decided to call it.
    site['/robots.txt'] = 'User-agent: *\nAllow: /\nSitemap: https://example.fr/sitemap.xml\n';
    site['/'] = homepage('<a href="/contact">Nous contacter</a>');
    site['/sitemap.xml'] =
      '<urlset><url><loc>https://example.fr/a-propos</loc></url>' +
      '<url><loc>https://example.fr/charte-donnees-personnelles</loc></url></urlset>';

    const found = await discover('example.fr');

    expect(found.refused).toBeNull();
    expect(found.candidates[0]!.provenance).toBe('listed-in-sitemap');
    expect(found.candidates[0]!.url).toBe('https://example.fr/charte-donnees-personnelles');
    // And no path was guessed, because the site answered.
    expect(requested).not.toContain('https://example.fr/privacy');
  });

  it('falls through to our own guesses when the sitemap lists nothing', async () => {
    site['/robots.txt'] = 'User-agent: *\nAllow: /\nSitemap: https://example.fr/sitemap.xml\n';
    site['/'] = homepage('<a href="/contact">Nous contacter</a>');
    site['/sitemap.xml'] = '<urlset><url><loc>https://example.fr/a-propos</loc></url></urlset>';
    site['/privacy'] = '<html>policy</html>';

    const found = await discover('example.fr');

    expect(found.candidates[0]!.provenance).toBe('conventional-path');
  });
});

describe('a refusal says what the search saw', () => {
  it('carries the census, so the next one is a diagnosis and not a guess', async () => {
    // The old sentence was true and said nothing: an undecoded entity, a
    // link to another hostname and a footer injected by a consent
    // manager all produce the same words. Shipping a fix for the wrong
    // one of those is how the Tranco 404 got diagnosed as a timeout.
    site['/'] = homepage(
      '<a href="/contact">Nous contacter</a><a href="/cgu">Conditions</a>'
    );

    const found = await discover('example.fr');

    expect(found.refused).toContain('2 link(s) on the page');
    expect(found.refused).toContain('0 sitemap(s) in robots.txt');
    expect(found.refused).toContain('6 path(s) tried');
  });

  it('never turns our own failure to read into a fact about the site', async () => {
    site = {};
    const found = await discover('example.fr');

    expect(found.refused).toContain('we could not read the homepage');
    expect(found.refused).not.toContain('links to no privacy policy');
  });
});
