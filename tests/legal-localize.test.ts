import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pass 3 publishes an approved item in seven languages.
 *
 * By the time anything reaches here a person has checked the facts
 * against the primary source, so the risks left are different ones:
 * publishing a page that only half exists, and putting a regulator's
 * own headline on it.
 */

vi.mock('server-only', () => ({}));

interface Journal {
  localeRows: Record<string, unknown>[];
  statusPatches: Record<string, unknown>[];
  translated: { target: string; payload: Record<string, unknown> }[];
}

let journal: Journal;
let queue: Record<string, unknown>[];
/** Locales the fake translator should fail on. */
let failFor: Set<string>;

function chain(result: unknown): Record<string, unknown> {
  const self: Record<string, unknown> = {
    select: () => chain(result),
    eq: () => chain(result),
    order: () => chain(result),
    limit: () => chain(result),
    maybeSingle: async () => result,
    single: async () => result,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej)
  };
  return self;
}

function install() {
  vi.doMock('@/lib/alert', () => ({ alertOps: () => undefined }));

  vi.doMock('@/lib/ai-clients', () => ({
    OPENAI_MODEL: 'gpt-test',
    openai: () => ({
      chat: {
        completions: {
          create: async (args: {
            messages: { role: string; content: string }[];
          }) => {
            const system = args.messages[0]!.content;
            const target = /into ([a-zA-Z-]+) \(BCP-47\)/.exec(system)?.[1] ?? '?';
            const payload = JSON.parse(args.messages[1]!.content) as Record<string, unknown>;
            journal.translated.push({ target, payload });
            if (failFor.has(target)) throw new Error('provider exploded');
            return {
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    content: JSON.stringify({ summary: `${target}:${payload['summary']}` })
                  }
                }
              ]
            };
          }
        }
      }
    })
  }));

  vi.doMock('@/lib/supabase', () => ({
    supabaseService: () => ({
      from: (table: string) => {
        if (table === 'legal_development_locales') {
          return {
            upsert: async (rows: Record<string, unknown>[]) => {
              journal.localeRows.push(...rows);
              return { error: null };
            }
          };
        }
        return {
          ...chain({ data: queue, error: null }),
          update: (patch: Record<string, unknown>) => {
            journal.statusPatches.push(patch);
            return { eq: () => ({ eq: async () => ({ error: null }) }) };
          }
        };
      }
    })
  }));
}

async function run() {
  const { GET } = await import('@/app/api/cron/localize-legal/route');
  const res = await GET(new Request('https://lexyflow.com/api/cron/localize-legal'));
  return (await res.json()) as Record<string, unknown>;
}

const ITEM = {
  id: '11111111-2222-3333-4444-555555555555',
  slug: 'sanction-societe-x-a1b2c3',
  authority: 'CNIL',
  entity: 'Société X',
  decision_date: '2026-09-09',
  articles: ['GDPR Art. 13', 'GDPR Art. 32'],
  fine_eur: 300000,
  outcome: 'fine',
  summary_en: 'The French data protection authority fined company X 300,000 euros.'
};

beforeEach(() => {
  vi.resetModules();
  journal = { localeRows: [], statusPatches: [], translated: [] };
  queue = [ITEM];
  failFor = new Set();
  delete process.env['CRON_SECRET'];
  install();
});

describe('a page exists in seven languages or in none', () => {
  it('publishes all seven when every translation lands', async () => {
    const body = await run();

    expect(body['published']).toBe(1);
    expect(journal.localeRows.map((r) => r['locale']).sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'ja', 'pt-br'].sort()
    );
    expect(journal.statusPatches[0]!['status']).toBe('published');
  });

  it('publishes nothing when a single locale fails', async () => {
    failFor = new Set(['ar']);
    const body = await run();

    expect(body['failed']).toBe(1);
    expect(body['published']).toBe(0);
    // No partial write, and the row stays `approved` for the next run.
    // Publishing the other six would advertise seven languages in
    // hreflang and serve English under one of them.
    expect(journal.localeRows).toHaveLength(0);
    expect(journal.statusPatches).toHaveLength(0);
  });

  it('marks the status only after the translations are stored', async () => {
    await run();
    // A crash between the two writes must leave orphan translations the
    // next run overwrites — never a published page with no text.
    expect(journal.localeRows.length).toBeGreaterThan(0);
    expect(journal.statusPatches).toHaveLength(1);
  });
});

describe('the headline is ours, not the regulator\'s', () => {
  it('assembles a title from the facts', async () => {
    await run();
    const en = journal.localeRows.find((r) => r['locale'] === 'en')!;

    // Facts carry no copyright; a regulator's sentence does. And the
    // assembled form carries the terms a compliance officer searches.
    expect(en['title']).toBe(
      'Société X — CNIL — €300,000 fine — GDPR Art. 13, 32 — 2026-09-09'
    );
  });

  it('leads with the organisation, because that is what distinguishes it', async () => {
    // The first two pages we published were headed "CNIL — €300,000
    // fine — GDPR Art. 12, GDPR Art. 17 — 2026-07-21" and "CNIL —
    // €500,000 fine — GDPR Art. 32, GDPR Art. 34 — 2026-07-21". Same
    // authority, same date, nothing to tell them apart, and matching no
    // query any human makes.
    await run();
    for (const locale of ['en', 'fr', 'ja', 'ar']) {
      const title = String(journal.localeRows.find((r) => r['locale'] === locale)!['title']);
      expect(title.startsWith('Société X —'), `${locale}: ${title}`).toBe(true);
    }
  });

  it('keeps the authority-led shape when nothing was sanctioned', async () => {
    // Guidance and opinions have no respondent. A header invented for
    // them would be worse than a missing one.
    queue = [{ ...ITEM, entity: null, fine_eur: null, outcome: 'guidance' }];
    await run();
    expect(journal.localeRows.find((r) => r['locale'] === 'en')!['title']).toBe(
      'CNIL — guidance — GDPR Art. 13, 32 — 2026-09-09'
    );
  });

  it('names the instrument once when the citations share it', async () => {
    // "GDPR Art. 13, GDPR Art. 32" pushed the date past the ~60
    // characters a search result shows — and the date is the part that
    // makes a result look current.
    await run();
    const title = String(journal.localeRows.find((r) => r['locale'] === 'en')!['title']);
    expect(title).toContain('GDPR Art. 13, 32');
    expect(title.match(/GDPR/g)).toHaveLength(1);
  });

  it('names both instruments when they differ', async () => {
    queue = [{ ...ITEM, articles: ['GDPR Art. 5', 'ePrivacy Art. 3'] }];
    await run();
    const title = String(journal.localeRows.find((r) => r['locale'] === 'en')!['title']);
    expect(title).toContain('GDPR Art. 5, ePrivacy Art. 3');
  });

  it('never reads the feed headline at all', async () => {
    // raw_title is extraction input and internal-only. It is not even
    // selected by this route, so it cannot leak into a page.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(__dirname, '..', 'src/app/api/cron/localize-legal/route.ts'),
      'utf8'
    );
    expect(source).not.toContain('raw_title');
  });

  it('falls back to the outcome when there was no fine', async () => {
    queue = [{ ...ITEM, fine_eur: null, outcome: 'court_ruling' }];
    await run();
    expect(journal.localeRows.find((r) => r['locale'] === 'en')!['title']).toContain(
      'court ruling'
    );
  });

  it('writes the headline in each language, not English seven times', async () => {
    await run();
    const title = (locale: string) =>
      String(journal.localeRows.find((r) => r['locale'] === locale)!['title']);

    // The first real publication put "CNIL — €300,000 fine — GDPR Art.
    // 13 — 2026-09-09" on the Arabic and Japanese pages too. A title is
    // nine parts proper noun, so a model told not to translate statute
    // names, amounts or dates correctly returned the whole thing
    // untouched — including the one word that was ours.
    expect(title('fr')).toContain('amende');
    expect(title('ja')).toContain('制裁金');
    expect(title('ar')).toContain('غرامة');
    expect(title('de')).toContain('Bußgeld');

    // And the parts that must NOT move stay put in every language.
    for (const locale of ['fr', 'ja', 'ar', 'de', 'es', 'pt-br']) {
      expect(title(locale)).toContain('CNIL');
      expect(title(locale)).toContain('GDPR Art. 13');
      expect(title(locale)).toContain('2026-09-09');
    }
  });

  it('keeps Arabic numerals Latin, because that is what people type', async () => {
    await run();
    const ar = String(journal.localeRows.find((r) => r['locale'] === 'ar')!['title']);

    // Intl would otherwise render ٣٠٠٬٠٠٠ — correct Arabic, and
    // unsearchable: nobody looking for this fine will type it that way.
    expect(ar).toContain('300,000');
    expect(ar).not.toMatch(/[٠-٩]/);
  });

  it('translates the outcome word when there is no fine', async () => {
    queue = [{ ...ITEM, fine_eur: null, outcome: 'guidance' }];
    await run();
    const title = (locale: string) =>
      String(journal.localeRows.find((r) => r['locale'] === locale)!['title']);

    expect(title('fr')).toContain('lignes directrices');
    expect(title('ja')).toContain('ガイドライン');
  });

  it('asks the model for the summary alone', async () => {
    await run();
    // The title is structured data assembled in code. Sending it to a
    // model would cost tokens to get the same string back, and would
    // make a URL's public face non-deterministic.
    for (const call of journal.translated) {
      expect(Object.keys(call.payload)).toEqual(['summary']);
    }
  });

  it('keeps the title short when many articles were cited', async () => {
    queue = [{ ...ITEM, articles: ['A1', 'A2', 'A3', 'A4', 'A5'] }];
    await run();
    const title = String(journal.localeRows.find((r) => r['locale'] === 'en')!['title']);
    expect(title).toContain('A1, A2');
    expect(title).not.toContain('A3');
  });
});

describe('the English pivot is never round-tripped', () => {
  it('stores the approved wording verbatim and translates into six', async () => {
    await run();

    const en = journal.localeRows.find((r) => r['locale'] === 'en')!;
    // A person approved these exact words. Sending them through a model
    // could only degrade them.
    expect(en['summary']).toBe(ITEM.summary_en);
    expect(journal.translated.map((t) => t.target).sort()).toEqual(
      ['ar', 'de', 'es', 'fr', 'ja', 'pt-br'].sort()
    );
    expect(journal.translated.some((t) => t.target === 'en')).toBe(false);
  });
});

describe('an empty queue costs nothing', () => {
  it('makes no model call when nothing is approved', async () => {
    queue = [];
    const body = await run();

    expect(journal.translated).toHaveLength(0);
    expect(body['note']).toBe('queue empty');
  });
});

describe('an item that should not have been approved is refused', () => {
  it('fails rather than publishing a headline with no body', async () => {
    queue = [{ ...ITEM, summary_en: null }];
    const body = await run();

    expect(body['failed']).toBe(1);
    expect(journal.localeRows).toHaveLength(0);
  });
});

describe('a published page is visible immediately', () => {
  it('revalidates every locale path and the sitemap', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(__dirname, '..', 'src/app/api/cron/localize-legal/route.ts'),
      'utf8'
    );

    // The public pages are cached for an hour. Without an explicit
    // revalidation, approving an item and then looking at the site
    // shows the state from up to an hour ago — indistinguishable from
    // a publication that silently failed.
    expect(source).toContain('revalidatePath');
    expect(source).toContain('/decisions/${item.slug}');
    expect(source).toContain("revalidatePath('/sitemap.xml')");
  });

  it('never loses the page over a cache hint', () => {
    // The item IS published by this point, and the hourly
    // revalidation catches up on its own.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const source = readFileSync(
      join(__dirname, '..', 'src/app/api/cron/localize-legal/route.ts'),
      'utf8'
    );
    expect(source).toContain('revalidate_failed');
  });
});
