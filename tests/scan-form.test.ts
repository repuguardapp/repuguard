import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The field that triggers a request to somebody else's server.
 *
 * Two things are being defended here: that the visitor gets a real answer
 * when it refuses, and that the page says what it is about to do before it
 * does it.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const FORM = 'src/components/ScanForm.tsx';
const PAGE = 'src/app/[locale]/scan/page.tsx';
const LOCALES = ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar'] as const;
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`)).scan as Record<string, string>])
);

describe('every refusal gets its own sentence', () => {
  const form = code(FORM);

  it('maps each API error to a distinct message', () => {
    // "Something went wrong" tells a visitor to retry for ever. Each of
    // these tells them the reason and implies the remedy.
    for (const code of ['not_a_domain', 'rate_limited', 'domain_rate_limited']) {
      expect(form, code).toContain(`case '${code}'`);
    }
    expect(form).toContain('errorService');
  });

  it('does not blame the domain when our own fetch failed', () => {
    // Telling someone their domain is wrong because our network blipped
    // sends them to correct something that was correct.
    const networkCatch = form.slice(form.indexOf('} catch {'));
    expect(networkCatch.slice(0, 200)).toContain('errorService');
    expect(networkCatch.slice(0, 200)).not.toContain('errorNotADomain');
  });

  it('says out loud that a domain limit protects the other site', () => {
    // The refusal that is not an embarrassment: it exists for somebody who
    // is not our visitor.
    expect(messages['fr']!['errorDomainRateLimited']).toMatch(/solliciter un site/i);
    expect(messages['en']!['errorDomainRateLimited']).toMatch(/one site too often/i);
  });
});

describe('the field itself', () => {
  const form = code(FORM);

  it('accepts a bare domain instead of demanding a scheme', () => {
    // A browser rejecting "example.fr" for missing https:// would turn the
    // first interaction with the product into a correction.
    expect(form).toContain('type="text"');
    expect(form).toContain('inputMode="url"');
    expect(form).not.toContain('type="url"');
  });

  it('announces its error to a screen reader', () => {
    expect(form).toContain("role=\"alert\"");
    expect(form).toContain('aria-describedby');
    expect(form).toContain('aria-invalid');
  });

  it('reuses the project’s input styling rather than inventing a second one', () => {
    const audit = read('src/components/AuditForm.tsx');
    const shared = 'rounded-md border border-input bg-background px-3 py-2 text-sm';
    expect(form).toContain(shared);
    expect(audit).toContain(shared);
  });
});

describe('the page says what it is about to do', () => {
  const page = code(PAGE);

  it('states the method on the page, not in a policy nobody opens', () => {
    // A visitor about to point our infrastructure at a third party's
    // server is entitled to know what that sends.
    for (const key of ['howRobots', 'howPublic', 'howPrivate', 'howNoVerdict']) {
      expect(page, key).toContain(`t('${key}')`);
    }
  });

  it('promises robots.txt obedience in every language, and the code keeps it', () => {
    for (const locale of LOCALES) {
      expect(messages[locale]!['howRobots'], locale).toMatch(/robots\.txt/);
    }
    // The promise is not decoration: discovery stops when robots refuses.
    expect(read('src/lib/policy-discovery.ts')).toContain("'robots.txt disallows us'");
  });

  it('promises no judgement, and the observation layer has no verdict to give', () => {
    for (const locale of LOCALES) {
      expect(String(messages[locale]!['howNoVerdict']).length, locale).toBeGreaterThan(20);
    }
    const observations = code('src/lib/policy-observations.ts');
    expect(observations).not.toMatch(/compliant|conforme|violation|breach/i);
  });

  it('is indexable, unlike the results it produces', () => {
    // This page is ours and names nobody. A result page names a company
    // that did not ask to be catalogued.
    expect(page).not.toContain('index: false');
    expect(page).toContain('canonical');
    expect(code('src/app/[locale]/scan/[token]/page.tsx')).toContain('index: verified');
  });
});
