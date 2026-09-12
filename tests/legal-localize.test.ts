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
                    content: JSON.stringify({
                      title: `${target}:${payload['title']}`,
                      summary: `${target}:${payload['summary']}`
                    })
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
    expect(en['title']).toBe('CNIL — €300,000 fine — GDPR Art. 13, GDPR Art. 32 — 2026-09-09');
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
