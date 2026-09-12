import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The public face of the legal-watch corpus.
 *
 * Two properties matter more than anything visual. Only rows a person
 * approved may be readable, and a page must never be served in a
 * language it was not actually translated into — the second is what
 * the all-or-nothing rule in pass 3 exists to guarantee, and this is
 * where it would leak if the guarantee were ever broken.
 */

vi.mock('server-only', () => ({}));

interface Journal {
  filters: [string, unknown][];
}

let journal: Journal;
let rows: Record<string, unknown>[];

function chain(result: unknown): Record<string, unknown> {
  const self: Record<string, unknown> = {
    select: () => chain(result),
    eq: (col: string, val: unknown) => {
      journal.filters.push([col, val]);
      return chain(result);
    },
    not: () => chain(result),
    order: () => chain(result),
    limit: () => chain(result),
    maybeSingle: async () => ({
      data: (result as { data: unknown[] }).data[0] ?? null,
      error: null
    }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej)
  };
  return self;
}

function install() {
  vi.doMock('@/lib/supabase', () => ({
    supabaseService: () => ({ from: () => chain({ data: rows, error: null }) })
  }));
}

const ROW = {
  id: 'd1',
  slug: 'cnil-fine-a1b2c3',
  primary_url: 'https://www.cnil.fr/fr/sanction-x',
  authority: 'CNIL',
  decision_date: '2026-09-09',
  articles: ['GDPR Art. 13'],
  fine_eur: 300000,
  outcome: 'fine',
  legal_sources: {
    name: 'CNIL (France)',
    licence: 'Licence Ouverte / Etalab 2.0',
    framework_ids: ['gdpr']
  },
  legal_development_locales: [
    { locale: 'en', title: 'CNIL — €300,000 fine', summary: 'The authority fined company X.' },
    { locale: 'fr', title: 'CNIL — amende de 300 000 €', summary: "L'autorité a sanctionné X." }
  ]
};

beforeEach(() => {
  vi.resetModules();
  journal = { filters: [] };
  rows = [ROW];
  install();
});

describe('only approved-and-published rows are readable', () => {
  it('filters the list on published status', async () => {
    const { listPublishedDecisions } = await import('../src/lib/legal-decisions');
    await listPublishedDecisions('en');

    // Rows spend most of their life in discovered/extracted/rejected,
    // none of which a person has cleared. Filtering lives in this
    // module so a new page cannot forget to do it.
    expect(journal.filters).toContainEqual(['status', 'published']);
  });

  it('filters the single lookup on published status too', async () => {
    const { getPublishedDecision } = await import('../src/lib/legal-decisions');
    await getPublishedDecision('cnil-fine-a1b2c3', 'en');
    expect(journal.filters).toContainEqual(['status', 'published']);
  });
});

describe('a page is never served in a language it was not translated into', () => {
  it('omits a decision from a locale it has no text for', async () => {
    const { listPublishedDecisions } = await import('../src/lib/legal-decisions');
    // Only en and fr exist on this row.
    expect(await listPublishedDecisions('ja')).toHaveLength(0);
    expect(await listPublishedDecisions('fr')).toHaveLength(1);
  });

  it('returns null for a single decision missing that locale, so the page 404s', async () => {
    const { getPublishedDecision } = await import('../src/lib/legal-decisions');

    // Falling back to English under an /ar/ URL would be duplicate
    // content competing with our own /en page — the exact outcome the
    // all-or-nothing rule in pass 3 exists to prevent.
    expect(await getPublishedDecision('cnil-fine-a1b2c3', 'ar')).toBeNull();
    expect(await getPublishedDecision('cnil-fine-a1b2c3', 'fr')).not.toBeNull();
  });

  it('serves the locale it does have, in that locale', async () => {
    const { getPublishedDecision } = await import('../src/lib/legal-decisions');
    const decision = await getPublishedDecision('cnil-fine-a1b2c3', 'fr');
    expect(decision?.title).toBe('CNIL — amende de 300 000 €');
    expect(decision?.summary).toBe("L'autorité a sanctionné X.");
  });
});

describe('the funnel entrance', () => {
  it('deep-links into the audit form with the framework preselected', async () => {
    const { auditHrefFor, getPublishedDecision } = await import('../src/lib/legal-decisions');
    const decision = (await getPublishedDecision('cnil-fine-a1b2c3', 'en'))!;

    // This is what turns a reference page into the top of the funnel.
    expect(auditHrefFor(decision)).toBe('/audit?frameworks=gdpr');
  });

  it('falls back to a bare audit link when the source maps to no framework', async () => {
    rows = [{ ...ROW, legal_sources: { ...ROW.legal_sources, framework_ids: [] } }];
    const { auditHrefFor, getPublishedDecision } = await import('../src/lib/legal-decisions');
    const decision = (await getPublishedDecision('cnil-fine-a1b2c3', 'en'))!;

    expect(auditHrefFor(decision)).toBe('/audit');
  });

  it('resolves only frameworks that exist in the catalogue', async () => {
    rows = [
      { ...ROW, legal_sources: { ...ROW.legal_sources, framework_ids: ['gdpr', 'not_a_framework'] } }
    ];
    const { getPublishedDecision } = await import('../src/lib/legal-decisions');
    const decision = (await getPublishedDecision('cnil-fine-a1b2c3', 'en'))!;

    // A stale id in a source row must not render a blank badge or
    // produce a link to a page that does not exist.
    expect(decision.frameworks.map((f) => f.id)).toEqual(['gdpr']);
  });
});

describe('the audit form honours the deep link', () => {
  const source = readFileSync(
    join(__dirname, '..', 'src/app/[locale]/audit/page.tsx'),
    'utf8'
  );

  it('reads the frameworks query parameter', () => {
    expect(source).toContain('searchParams');
    expect(source).toContain('requestedFrameworks');
  });

  it('validates the ids against the catalogue rather than trusting the URL', () => {
    // The value comes from a URL anyone can edit, and an unknown id
    // that reached the engine would silently narrow the audit's scope.
    expect(source).toContain('FRAMEWORKS.some');
  });
});
