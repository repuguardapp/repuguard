import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAMEWORKS } from '@/lib/legal-frameworks';
import { frameworkName } from '@/lib/legal-labels';

/**
 * Seven locales, one set of keys.
 *
 * A missing key does not crash next-intl in production — it renders the
 * key path itself, or falls back to the default locale depending on
 * configuration. Both read as "the page failed to translate", which is
 * a defect this codebase has already shipped twice: the decision
 * headline, then the whole /compliance and /compare families, ninety-one
 * and two-hundred-odd pages respectively, all English under seven
 * hreflang tags pointing at each other.
 *
 * So parity is asserted mechanically rather than trusted to review.
 */

const LOCALES = ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar'] as const;

type Messages = Record<string, Record<string, unknown>>;

function load(locale: string): Messages {
  return JSON.parse(
    readFileSync(join(__dirname, '..', 'messages', `${locale}.json`), 'utf8')
  ) as Messages;
}

/** Every leaf path in a nested message object, e.g. "home.title". */
function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    paths(v, prefix ? `${prefix}.${k}` : k)
  );
}

/**
 * ICU argument names used by a message.
 *
 * Both forms count: the plain `{name}`, and the argument of a typed
 * block such as `{count, plural, one {# credit} other {# credits}}`.
 * Matching only the plain form reports English as taking no argument
 * wherever it pluralises, and then flags Japanese — which has no
 * grammatical plural and correctly writes `{count}` flat — as having
 * invented one. The nested `{one {…}}` cases do not match, because the
 * selector is followed by `{` rather than by `,` or `}`.
 */
function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]!));
}

function leaves(messages: Messages): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (value: unknown, prefix: string) => {
    if (typeof value === 'string') {
      out.set(prefix, value);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, prefix ? `${prefix}.${k}` : k);
    }
  };
  walk(messages, '');
  return out;
}

const REFERENCE = load('en');

describe('every locale carries every key', () => {
  for (const locale of LOCALES) {
    it(`${locale} has no missing or stray keys`, () => {
      const expected = new Set(paths(REFERENCE));
      const actual = new Set(paths(load(locale)));

      const missing = [...expected].filter((k) => !actual.has(k));
      const extra = [...actual].filter((k) => !expected.has(k));

      expect(missing, `missing in ${locale}`).toEqual([]);
      expect(extra, `only in ${locale}`).toEqual([]);
    });
  }
});

describe('a translation cannot silently drop a placeholder', () => {
  for (const locale of LOCALES) {
    if (locale === 'en') continue;
    it(`${locale} interpolates the same variables as English`, () => {
      // A message whose {name} was lost in translation renders a
      // sentence with a hole in it — grammatical, plausible, and
      // missing the regulation it is about.
      const reference = leaves(REFERENCE);
      const translated = leaves(load(locale));
      const drift: string[] = [];

      for (const [path, english] of reference) {
        const other = translated.get(path);
        if (other === undefined) continue; // reported by the parity test
        const want = [...placeholders(english)].sort();
        const got = [...placeholders(other)].sort();
        if (want.join(',') !== got.join(',')) drift.push(`${path}: ${want} vs ${got}`);
      }

      expect(drift).toEqual([]);
    });
  }
});

describe('the SEO families are translated, not merely re-served', () => {
  for (const locale of LOCALES) {
    if (locale === 'en') continue;
    it(`${locale} does not reuse the English copy of /compliance and /compare`, () => {
      // Ninety-one framework pages and ~266 comparison pages were the
      // same English page under seven hreflang tags. Identical copy
      // under a different lang attribute is how that comes back.
      const reference = leaves(REFERENCE);
      const translated = leaves(load(locale));

      for (const namespace of ['frameworkPage', 'comparePage']) {
        for (const [path, english] of reference) {
          if (!path.startsWith(`${namespace}.`)) continue;
          // Short labels legitimately coincide across languages
          // ("Jurisdiction" / "Jurisdicción" do not, but a two-word
          // heading might); only flag substantial prose.
          if (english.length < 40) continue;
          expect(translated.get(path), `${locale} ${path}`).not.toBe(english);
        }
      }
    });
  }
});

describe('the regulations are named in the reader language', () => {
  it('gives every framework a name in every locale', () => {
    for (const framework of FRAMEWORKS) {
      for (const locale of LOCALES) {
        expect(frameworkName(framework, locale), `${framework.id}/${locale}`).toBeTruthy();
      }
    }
  });

  it('does not serve the English title to French, German or Japanese readers', () => {
    // The H1 of /fr/compliance/gdpr read "General Data Protection
    // Regulation". A regulation with an official French title is
    // called by it.
    const gdpr = FRAMEWORKS.find((f) => f.id === 'gdpr')!;
    for (const locale of ['fr', 'es', 'de', 'pt-br', 'ja', 'ar']) {
      expect(frameworkName(gdpr, locale), locale).not.toBe(gdpr.name);
    }
    expect(frameworkName(gdpr, 'de')).toContain('DSGVO');
    expect(frameworkName(gdpr, 'fr')).toContain('RGPD');
  });
});
