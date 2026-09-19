import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAMEWORKS } from '../src/lib/legal-frameworks';

/**
 * Every framework the application offers must exist in the database.
 *
 * `audit_findings.framework_id` is a foreign key onto
 * `public.legal_frameworks`. The seed migration shipped 7 of the 13
 * frameworks in the application catalogue — the six Gulf regimes were
 * missing — and nothing anywhere connected the two. The picker offered
 * Saudi PDPL, Claude audited against it, and then the findings insert
 * (a single batch) failed wholesale on the foreign key. The failure was
 * best-effort and non-fatal, so the audit still saved as `completed`
 * with an empty findings list, which the UI renders as "no findings —
 * your document is compliant", under a risk score of 78/100.
 *
 * A missing seed row is invisible in every environment until a customer
 * selects that jurisdiction. This test makes the drift fail in CI
 * instead — it reads the migrations as text, so it needs no database.
 */

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

/** ids inserted into legal_frameworks across all numbered migrations. */
function seededFrameworkIds(): Set<string> {
  const ids = new Set<string>();

  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f))) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Take each `insert into ... legal_frameworks ...` statement up to
    // its terminating semicolon, then collect the first quoted value of
    // every tuple — that column is the id.
    const statements = sql.matchAll(
      /insert\s+into\s+public\.legal_frameworks[\s\S]*?;/gi
    );
    for (const [statement] of statements) {
      for (const [, id] of statement.matchAll(/\(\s*'([a-z0-9_]+)'\s*,/gi)) {
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

describe('legal framework catalogue ↔ database seed parity', () => {
  it('seeds every framework the application can offer', () => {
    const seeded = seededFrameworkIds();
    const missing = FRAMEWORKS.map((f) => f.id).filter((id) => !seeded.has(id));

    expect(
      missing,
      `Offered in src/lib/legal-frameworks.ts but never inserted into ` +
        `public.legal_frameworks. audit_findings.framework_id is a foreign ` +
        `key onto that table, so findings citing these are silently ` +
        `discarded: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('does not seed frameworks the application no longer knows about', () => {
    // The reverse drift is milder — an orphan row breaks nothing — but
    // it usually means a framework was renamed and the old id is still
    // referenced by historical findings.
    const known = new Set<string>(FRAMEWORKS.map((f) => f.id));
    const orphans = [...seededFrameworkIds()].filter((id) => !known.has(id));

    expect(orphans, `Seeded but absent from the application catalogue`).toEqual([]);
  });
});

describe('a free-zone law is offered, never assumed', () => {
  /**
   * The DIFC and the ADGM are financial free zones inside the United Arab
   * Emirates with their own data protection statutes, and those statutes
   * bind only the entities established inside those zones. A company in
   * mainland Dubai is subject to the federal PDPL and not to DIFC Law No. 5
   * of 2020.
   *
   * So listing 'AE' against them would tick three mutually inapplicable
   * regimes for every Emirati visitor, and the audit they received would
   * cite two laws that do not apply to them — under a risk score, in a PDF,
   * from a company selling the prevention of exactly that error. The audit
   * form offers every framework and pre-selects only what the org's country
   * implies, so an empty `countries` is what "offered, never assumed" is
   * spelled as.
   */

  const ZONES = ['difc_dp', 'adgm_dp'] as const;

  it('never pre-selects a zone law from the country alone', () => {
    for (const id of ZONES) {
      const framework = FRAMEWORKS.find((f) => f.id === id);
      expect(framework, `${id} missing from the catalogue`).toBeDefined();
      expect(framework!.countries, `${id} must not be implied by a country`).toEqual([]);
    }

    // The federal law is still the one a UAE organisation gets by default,
    // and it is still exactly one law.
    const forAE = FRAMEWORKS.filter((f) => f.countries.includes('AE')).map((f) => f.id);
    expect(forAE).toEqual(['uae_pdpl']);
  });

  it('cites each instrument by the kind of provision it actually has', () => {
    // The DIFC instrument is a Law divided into Articles; the ADGM
    // instrument is Regulations divided into Sections. "Article 6 of the
    // ADGM Regulations" is the first thing a lawyer reading our report
    // would notice.
    expect(FRAMEWORKS.find((f) => f.id === 'difc_dp')?.citationStyle).toBe('article');
    expect(FRAMEWORKS.find((f) => f.id === 'adgm_dp')?.citationStyle).toBe('section');
  });

  it('names the zone in every language, because "UAE data protection law" is three laws', async () => {
    const { frameworkName } = await import('../src/lib/legal-labels');
    for (const id of ZONES) {
      const framework = FRAMEWORKS.find((f) => f.id === id)!;
      const english = frameworkName(framework, 'en');

      for (const locale of ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar']) {
        const name = frameworkName(framework, locale);
        expect(name.length).toBeGreaterThan(10);

        // A real translation, not the English falling through. This is the
        // defect that put ~360 SEO pages in English under seven hreflang
        // tags, and frameworkName falls back to English silently, so the
        // only way to tell a translation from a fallback is that they
        // differ.
        if (locale !== 'en') {
          expect(name, `${id} in ${locale} is the English string`).not.toBe(english);
        }
        // The zone's own initials appear in every rendering, including the
        // Arabic one, where the acronym is kept alongside the translation.
        expect(
          /DIFC|ADGM|مركز دبي|أبوظبي/.test(name),
          `${id} in ${locale} does not name its zone: ${name}`
        ).toBe(true);
      }
    }
  });
});
