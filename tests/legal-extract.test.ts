import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Extraction is the first place in the acquisition pipeline that spends
 * money and the first that could put a sentence on the public web under
 * our brand. Both need holding down.
 *
 * Money: one model call per item, hard-capped, and nothing at all when
 * there is nothing to do — this runs on a schedule whether or not a
 * regulator published, which is most of the time.
 *
 * Publication: extraction can never reach `published`. Only a human
 * moves a row there. A compliance company auto-publishing unreviewed
 * legal claims is the "confidently wrong" failure we removed from the
 * product, relocated somewhere it cannot be quietly fixed.
 */

vi.mock('server-only', () => ({}));

interface Journal {
  updates: { id: string; patch: Record<string, unknown> }[];
  modelCalls: number;
  fetched: string[];
}

let journal: Journal;
let queue: Record<string, unknown>[];
let toolInput: Record<string, unknown> | (() => Record<string, unknown>);
/** What the cross-source twin lookup finds. Empty means no duplicate. */
let twinRows: {
  id: string;
  fine_amount: number | null;
  fine_currency: string | null;
  outcome?: string | null;
}[];

function chain(result: unknown): Record<string, unknown> {
  const self: Record<string, unknown> = {
    select: () => chain(result),
    eq: () => chain(result),
    in: () => chain(result),
    // The queue excludes items that have used up their attempts.
    lt: () => chain(result),
    // findTwin's query is the only one that ends on .neq(), so this is
    // where the duplicate lookup gets its own answer.
    neq: () => chain({ data: twinRows, error: null }),
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
    ANTHROPIC_EXTRACTION_MODEL: 'claude-haiku-test',
    anthropic: () => ({
      messages: {
        create: async () => {
          journal.modelCalls += 1;
          const input = typeof toolInput === 'function' ? toolInput() : toolInput;
          return {
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', name: 'submit_development', input }]
          };
        }
      }
    })
  }));

  vi.doMock('@/lib/supabase', () => ({
    supabaseService: () => ({
      from: () => ({
        ...chain({ data: queue, error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            journal.updates.push({ id, patch });
            return { error: null };
          }
        })
      })
    })
  }));
}

async function run() {
  const { GET } = await import('@/app/api/cron/extract-legal/route');
  const res = await GET(new Request('https://lexyflow.com/api/cron/extract-legal'));
  return (await res.json()) as Record<string, unknown>;
}

const ITEM = {
  id: '11111111-2222-3333-4444-555555555555',
  primary_url: 'https://www.cnil.fr/fr/sanction-x',
  raw_title: 'Sanction de 300 000 € à l’encontre de la société X',
  raw_excerpt: 'La formation restreinte a prononcé une sanction.',
  published_at: '2026-09-09T06:30:00.000Z'
};

const GOOD_EXTRACTION = {
  relevant: true,
  authority: 'CNIL',
  decision_date: '2026-09-09',
  articles: ['GDPR Art. 13', 'GDPR Art. 32'],
  fine_amount: 300000,
  fine_currency: 'EUR',
  outcome: 'fine',
  summary_en:
    'The French data protection authority fined company X 300,000 euros for failing to inform data subjects and for inadequate security measures.'
};

/**
 * A fetch stub that survives fetchExternal, which the old one did not.
 *
 * fetchExternal follows redirects by hand: it reads `res.status` and, for
 * anything outside 2xx, `res.headers.get('location')`. The previous stub
 * returned no status and a headers.get that answered the content-type to
 * every question — so `undefined < 300` was false, the content-type was
 * taken for a Location, `new URL('text/html; charset=utf-8')` threw, and
 * readSource silently fell back to the feed excerpt.
 *
 * Every test in this file was therefore exercising the fallback path and
 * none of them was reading a page. They passed, because they asserted on
 * extraction rather than on content — which is how a stub that answers
 * the wrong question survives in a suite for weeks.
 */
function stubPage(html: string) {
  vi.stubGlobal('fetch', async (url: string) => {
    journal.fetched.push(String(url));
    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null
      },
      text: async () => html
    };
  });
}

beforeEach(() => {
  vi.resetModules();
  journal = { updates: [], modelCalls: 0, fetched: [] };
  queue = [ITEM];
  twinRows = [];
  toolInput = GOOD_EXTRACTION;
  // No CRON_SECRET configured: the route then allows the call outside
  // production, which is what lets these tests exercise it at all.
  delete process.env['CRON_SECRET'];
  // The source page is fetched for the articles it cites; failing to
  // reach it must degrade, never block.
  stubPage('<html><body><p>Décision rendue le 9 septembre 2026.</p></body></html>');
  install();
});

afterEach(() => vi.unstubAllGlobals());

describe('extraction spends nothing it does not have to', () => {
  it('makes no model call when the queue is empty', async () => {
    queue = [];
    const body = await run();

    expect(journal.modelCalls).toBe(0);
    expect(body['extracted']).toBe(0);
    expect(body['note']).toBe('queue empty');
  });

  it('makes exactly one model call per item', async () => {
    await run();
    expect(journal.modelCalls).toBe(1);
  });
});

describe('extraction records facts, not opinions', () => {
  it('writes the five facts and our own summary', async () => {
    await run();
    const patch = journal.updates[0]!.patch;

    expect(patch['status']).toBe('extracted');
    expect(patch['authority']).toBe('CNIL');
    expect(patch['decision_date']).toBe('2026-09-09');
    expect(patch['articles']).toEqual(['GDPR Art. 13', 'GDPR Art. 32']);
    expect(patch['fine_amount']).toBe(300000);
    expect(patch['fine_currency']).toBe('EUR');
    expect(patch['outcome']).toBe('fine');
    expect(String(patch['summary_en'])).toContain('300,000 euros');
  });

  it('never reaches published — that gate is human-only', async () => {
    await run();
    for (const { patch } of journal.updates) {
      expect(patch['status']).not.toBe('published');
      expect(patch['status']).not.toBe('approved');
    }
  });

  it('builds a deterministic slug rather than asking the model for one', async () => {
    await run();
    const first = journal.updates[0]!.patch['slug'];

    journal.updates.length = 0;
    vi.resetModules();
    install();
    await run();

    // Re-extracting after a prompt change must not move a URL that may
    // already be indexed.
    expect(journal.updates[0]!.patch['slug']).toBe(first);
    expect(String(first)).toMatch(/^[a-z0-9-]+$/);
    expect(String(first)).toContain('sanction-de-300-000');
  });
});

describe('extraction filters the feed instead of trusting it', () => {
  it('rejects a recruitment notice with a recorded reason', async () => {
    toolInput = { relevant: false, reject_reason: 'recruitment announcement, not a decision' };
    const body = await run();

    expect(body['rejected']).toBe(1);
    expect(body['extracted']).toBe(0);
    const patch = journal.updates[0]!.patch;
    expect(patch['status']).toBe('rejected');
    expect(patch['rejected_reason']).toBe('recruitment announcement, not a decision');
  });

  it('refuses to promote a relevant item with no usable summary', async () => {
    // An empty row in the review queue is worse than no row: a human
    // opens it, learns nothing, and the item is marked as handled.
    toolInput = { relevant: true, authority: 'CNIL', summary_en: 'Too short.' };
    const body = await run();

    expect(body['failed']).toBe(1);
    // Left as `discovered`, so the next run retries it — but the attempt
    // is counted, because a retry nobody counts is a standing order to
    // spend.
    const patch = journal.updates[0]!.patch;
    expect(patch['status']).toBeUndefined();
    expect(patch['extract_attempts']).toBe(1);
  });
});

/**
 * The bug that paid for this section.
 *
 * The tool schema says "omit the field entirely" when there is no fine.
 * The model sent `evidence: { fine_amount: null }`, the parse rejected it,
 * the item stayed `discovered`, and the next run picked it up again: two
 * developments charged four times a day from 27 September onward, each
 * run emitting one more alert naming one more development id. A single
 * schema bug, dressed as a stream of unrelated item failures.
 */
describe('an explicit null means absent, not malformed', () => {
  it('extracts an item whose evidence carries nulls for the fields it has none for', async () => {
    toolInput = {
      ...GOOD_EXTRACTION,
      evidence: {
        entity: 'la société X',
        decision_date: 'Décision rendue le 9 septembre 2026.',
        fine_amount: null
      }
    };

    const body = await run();

    expect(body['failed']).toBe(0);
    expect(body['extracted']).toBe(1);
    expect(journal.updates[0]!.patch['status']).toBe('extracted');
  });

  it('accepts nulls across every optional field rather than abandoning the item', async () => {
    toolInput = {
      relevant: true,
      authority: 'CNIL',
      entity: null,
      decision_date: null,
      articles: null,
      fine_amount: null,
      fine_currency: null,
      outcome: null,
      evidence: null,
      summary_en: GOOD_EXTRACTION.summary_en
    };

    const body = await run();

    expect(body['extracted']).toBe(1);
    const patch = journal.updates[0]!.patch;
    expect(patch['decision_date']).toBeNull();
    expect(patch['articles']).toBeNull();
    expect(patch['fine_amount']).toBeNull();
    expect(patch['fine_currency']).toBeNull();
    expect(patch['evidence']).toBeNull();
  });

  it('still refuses a null where the answer itself is required', async () => {
    // `relevant` is the one field the model must decide. A null there is
    // not an absent fact, it is a missing answer, and guessing either way
    // would publish or discard on our own authority.
    toolInput = { relevant: null, summary_en: GOOD_EXTRACTION.summary_en };
    const body = await run();

    expect(body['extracted']).toBe(0);
    expect(body['failed']).toBe(1);
  });
});

describe('an item that cannot be extracted stops costing money', () => {
  it('parks the item on the third failure, carrying the reason', async () => {
    queue = [{ ...ITEM, extract_attempts: 2 }];
    toolInput = { relevant: true, authority: 'CNIL', summary_en: 'Too short.' };

    const body = await run();

    expect(body['failed']).toBe(1);
    const patch = journal.updates[0]!.patch;
    expect(patch['status']).toBe('extract_failed');
    expect(patch['extract_attempts']).toBe(3);
    expect(String(patch['extract_error'])).toContain('usable summary');
  });

  it('never parks an item over an account-level failure', async () => {
    // A billing lapse is not the item's fault. Parking eight real
    // decisions because a card expired is the expensive mistake in the
    // other direction, so the run abandons and the counter is untouched.
    queue = [{ ...ITEM, extract_attempts: 2 }];
    vi.resetModules();
    vi.doMock('@/lib/alert', () => ({ alertOps: () => undefined }));
    vi.doMock('@/lib/ai-clients', () => ({
      ANTHROPIC_EXTRACTION_MODEL: 'claude-haiku-test',
      anthropic: () => ({
        messages: {
          create: async () => {
            throw new Error('Your credit balance is too low to access the Anthropic API');
          }
        }
      })
    }));
    vi.doMock('@/lib/supabase', () => ({
      supabaseService: () => ({
        from: () => ({
          ...chain({ data: queue, error: null }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              journal.updates.push({ id, patch });
              return { error: null };
            }
          })
        })
      })
    }));

    const body = await run();

    expect(body['ok']).toBe(false);
    expect(String(body['reason'])).toContain('credit balance');
    expect(journal.updates).toHaveLength(0);
  });
});

describe('one bad item never costs the batch', () => {
  it('keeps going after a failure and reports both counts', async () => {
    queue = [ITEM, { ...ITEM, id: '99999999-8888-7777-6666-555555555555' }];
    let call = 0;
    toolInput = () => {
      call += 1;
      return call === 1 ? { relevant: true } : GOOD_EXTRACTION;
    };

    const body = await run();

    expect(body['failed']).toBe(1);
    expect(body['extracted']).toBe(1);
  });
});

describe('reading the source degrades rather than blocks', () => {
  it('falls back to the feed excerpt when the page cannot be read', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ETIMEDOUT');
    });
    const body = await run();

    // A PDF, a consent wall or a timeout must not park the item for
    // ever — the feed already told us the headline fact.
    expect(body['extracted']).toBe(1);
  });

  it('ignores a non-HTML response instead of feeding bytes to the model', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      headers: { get: () => 'application/pdf' },
      text: async () => '%PDF-1.4 binary garbage'
    }));
    const body = await run();
    expect(body['extracted']).toBe(1);
  });
});

describe('one decision, one page — whatever reported it', () => {
  /**
   * The uniqueness key is (source_id, external_id): idempotent per feed,
   * blind across feeds. The CNIL fine against EXTIA arrived twice —
   * once from cnil.fr, once from the EDPB newsroom that republishes it.
   * Two rows become two pages describing the same decision, which is
   * duplicate content on our own domain, where the pages compete with
   * each other and the corpus looks padded.
   */
  it('rejects the second report of a decision, naming the first', async () => {
    const twinId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    twinRows = [
      { id: twinId, fine_amount: GOOD_EXTRACTION.fine_amount, fine_currency: 'EUR', outcome: 'fine' }
    ];

    const body = await run();

    expect(body['rejected']).toBe(1);
    expect(body['extracted']).toBe(0);
    const patch = journal.updates[0]!.patch;
    expect(patch['status']).toBe('rejected');
    expect(String(patch['rejected_reason'])).toContain('duplicate of');
    expect(String(patch['rejected_reason'])).toContain(twinId);
  });

  it('is not fooled by a different fine on the same day', async () => {
    // Same authority, same date, different amount: two real decisions.
    twinRows = [{ id: 'other', fine_amount: 999, fine_currency: 'EUR', outcome: 'fine' }];
    const body = await run();
    expect(body['extracted']).toBe(1);
  });

  it('never calls an undated decision a duplicate', async () => {
    // With no date there is nothing to match on, and guessing would
    // silently drop a real decision — far worse than publishing one
    // twice.
    twinRows = [
      { id: 'other', fine_amount: GOOD_EXTRACTION.fine_amount, fine_currency: 'EUR', outcome: 'fine' }
    ];
    toolInput = { ...GOOD_EXTRACTION, decision_date: undefined };
    const body = await run();
    expect(body['extracted']).toBe(1);
    expect(body['rejected']).toBe(0);
  });
});

describe('a publication date is not a decision date', () => {
  it('tells the model which date wins when the source gives both', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(
      join(__dirname, '..', 'src/app/api/cron/extract-legal/route.ts'),
      'utf8'
    );

    // Found on the first item ever reviewed. The CNIL page opens "Le 3
    // septembre 2026, la CNIL a prononcé une sanction" and carries, at
    // its foot, "Délibération n°SAN-2026-009 du 21 juillet 2026". The
    // model took the prose date, which is when the sanction was
    // announced, not when it was decided.
    //
    // Our page labels the field "Decision date" and puts it in the
    // title, and a compliance officer citing the ruling cites the
    // deliberation. Every CNIL sanction page has this shape, so the
    // defect was systematic rather than a one-off slip.
    expect(source).toContain('not of its announcement');
    expect(source).toContain('A publication date is not a decision date');
  });
});

/**
 * The amount carries its currency, or it is not a fact.
 *
 * The field was `fine_eur` and the tool schema said "omit entirely if
 * the currency is not euros". Of the nine ICO fines that reached the
 * review queue, the model ignored that on nine. Our own summaries are
 * the evidence: "£963,900" stored as 963900 in a column named for
 * euros, "£300,000" as 300000 — and, once, "£66,000" stored as
 * 73,920.00, a conversion the model performed at a rate it never
 * stated, producing a figure that appears in no document anywhere,
 * attached to the name of a police force.
 *
 * Nothing in this codebase converts a currency. A sum we cannot
 * attribute to one is no sum at all.
 */
describe('a fine without its currency is not published', () => {
  it('stores the amount and the currency the source used', async () => {
    toolInput = { ...GOOD_EXTRACTION, fine_amount: 963900, fine_currency: 'gbp' };
    await run();

    const patch = journal.updates[0]!.patch;
    expect(patch['fine_amount']).toBe(963900);
    // Upper-cased on the way in: ISO 4217 is three capitals, and
    // Intl.NumberFormat is the thing that has to accept it.
    expect(patch['fine_currency']).toBe('GBP');
  });

  it('drops an amount whose currency the model did not give', async () => {
    // Not a smaller fact than no amount — a different one. This is the
    // exact shape that put nine pound figures behind a euro sign.
    toolInput = { ...GOOD_EXTRACTION, fine_amount: 963900, fine_currency: undefined };
    const body = await run();

    expect(body['extracted']).toBe(1);
    const patch = journal.updates[0]!.patch;
    expect(patch['fine_amount']).toBeNull();
    expect(patch['fine_currency']).toBeNull();
  });

  it('drops a currency with no amount behind it', async () => {
    toolInput = { ...GOOD_EXTRACTION, fine_amount: undefined, fine_currency: 'GBP' };
    await run();

    const patch = journal.updates[0]!.patch;
    expect(patch['fine_amount']).toBeNull();
    expect(patch['fine_currency']).toBeNull();
  });

  it('refuses a currency that is not three letters', async () => {
    // "£" and "pounds sterling" are not ISO 4217. Accepting either is
    // how a symbol ends up compared against a code, which is how the
    // wrong sign gets rendered.
    toolInput = { ...GOOD_EXTRACTION, fine_amount: 963900, fine_currency: '£' };
    const body = await run();

    expect(body['extracted']).toBe(0);
    expect(body['failed']).toBe(1);
  });

  it('does not call two amounts equal because their digits match', async () => {
    // 300000 GBP and 300000 EUR are two different decisions. Matching on
    // the number alone would reject the second as a duplicate of the
    // first and lose it silently.
    twinRows = [{ id: 'other', fine_amount: 300000, fine_currency: 'GBP', outcome: 'fine' }];
    toolInput = { ...GOOD_EXTRACTION, fine_amount: 300000, fine_currency: 'EUR' };
    const body = await run();

    expect(body['extracted']).toBe(1);
    expect(body['rejected']).toBe(0);
  });

  it('tells the model never to convert, in the schema and the system prompt', async () => {
    const source = readFileSync(
      join(__dirname, '..', 'src/app/api/cron/extract-legal/route.ts'),
      'utf8'
    );
    expect(source).toContain('NEVER convert between currencies');
    expect(source).toContain('You NEVER convert a currency');
    // And the one number that proves why.
    expect(source).toContain('73,920');
  });
});

/**
 * The fine the deduplication threw away.
 *
 * The ICO published two documents about Elderly Aids Limited on the same
 * day: an enforcement notice ordering the company to stop, and a
 * monetary penalty notice of £190,000. Same authority, same date, and
 * neither carrying an amount we had managed to read.
 *
 * The amounts were compared with `mine === theirs`, and two nulls are
 * equal in JavaScript. So on 20 September the penalty notice was
 * rejected as "duplicate of" the enforcement notice: the fine left the
 * corpus, the order stayed, and nobody looked — because a rejection
 * carrying a reason reads exactly like the system working.
 *
 * The doc comment on findTwin already said "a decision with no date and
 * no amount has nothing to match on, so it is never treated as a
 * duplicate". It was true, and the code did not do it.
 */
describe('an absence is never a matching key', () => {
  it('never calls two amount-less decisions duplicates of each other', async () => {
    twinRows = [{ id: 'the-enforcement-notice', fine_amount: null, fine_currency: null, outcome: 'order' }];
    toolInput = {
      ...GOOD_EXTRACTION,
      outcome: 'order',
      fine_amount: undefined,
      fine_currency: undefined
    };

    const body = await run();

    expect(body['rejected']).toBe(0);
    expect(body['extracted']).toBe(1);
  });

  it('does not match a fine against a row that has no amount', async () => {
    // The exact shape of the Elderly Aids loss, from the other side: the
    // penalty notice arrives with its £190,000 and the order is already
    // in the corpus with nothing.
    twinRows = [{ id: 'the-enforcement-notice', fine_amount: null, fine_currency: null, outcome: 'fine' }];
    toolInput = { ...GOOD_EXTRACTION, fine_amount: 190000, fine_currency: 'GBP' };

    const body = await run();

    expect(body['extracted']).toBe(1);
    expect(journal.updates[0]!.patch['fine_amount']).toBe(190000);
    expect(journal.updates[0]!.patch['fine_currency']).toBe('GBP');
  });

  it('never calls an order and a fine the same decision', async () => {
    // However identical the rest of the metadata. One notice tells a
    // company to stop and one tells it what to pay; a regulator
    // routinely publishes both on one day.
    twinRows = [{ id: 'the-order', fine_amount: 190000, fine_currency: 'GBP', outcome: 'order' }];
    toolInput = { ...GOOD_EXTRACTION, outcome: 'fine', fine_amount: 190000, fine_currency: 'GBP' };

    const body = await run();

    expect(body['rejected']).toBe(0);
    expect(body['extracted']).toBe(1);
  });
});

/**
 * The model was shown 12,000 characters of a page and told us what was
 * not in them.
 *
 * "The page does not state a fine amount or currency" — a true statement
 * about the slice it was given and a false one about the ICO page, which
 * carries "ICO hits company selling call blockers with £190k fine for
 * nuisance calls" below the body text.
 *
 * The same mistake as the crawler's 800,000-character cap, in a
 * different file: a bound applied to the head is not a bound on size, it
 * is a choice of which part of the document to read.
 */
describe('the regulator’s page is read at both ends', () => {
  it('sends the end of a long page, where the money is', async () => {
    const body = 'Le contrevenant a été identifié par la commission. '.repeat(3_000);
    stubPage(
      `<html><body><p>${body}</p><p>ICO hits company selling call blockers with 190k fine</p></body></html>`
    );

    let seen = '';
    vi.resetModules();
    vi.doMock('@/lib/alert', () => ({ alertOps: () => undefined }));
    vi.doMock('@/lib/ai-clients', () => ({
      ANTHROPIC_EXTRACTION_MODEL: 'claude-haiku-test',
      anthropic: () => ({
        messages: {
          create: async (req: { messages: { content: string }[] }) => {
            seen = req.messages[0]!.content;
            return {
              stop_reason: 'tool_use',
              content: [{ type: 'tool_use', name: 'submit_development', input: GOOD_EXTRACTION }]
            };
          }
        }
      })
    }));
    vi.doMock('@/lib/supabase', () => ({
      supabaseService: () => ({
        from: () => ({
          ...chain({ data: queue, error: null }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              journal.updates.push({ id, patch });
              return { error: null };
            }
          })
        })
      })
    }));

    await run();

    // The head is there, the tail is there, and the elision is marked
    // rather than silently joining two unrelated sentences.
    expect(seen).toContain('Le contrevenant a été identifié');
    expect(seen).toContain('190k fine');
    expect(seen).toContain('[...]');
  });
});

/**
 * The closure of an injunction is not an injunction.
 *
 * The CNIL published "Clôture de l'injonction prononcée à l'encontre de
 * la société SOLOCAL MARKETING SERVICES" — the regulator recording that
 * the company had complied. It came back as `order`, and the page that
 * would have produced reads:
 *
 *   SOLOCAL MARKETING SERVICES — CNIL — injonction — 17 septembre 2026
 *
 * The opposite of what the authority decided, under a real company's
 * name, in seven languages. Not a missing field: an accusation, and the
 * one error in this file that would be worth suing over.
 *
 * The fix is not a better enum description. The model is asked a fact —
 * does this document impose something? — and the label is derived from
 * the answer in code, the same reasoning as building the slug ourselves
 * rather than asking for one.
 */
describe('a document that ends a measure is never published as the measure', () => {
  it('overrides a punitive label when nothing was imposed', async () => {
    toolInput = {
      ...GOOD_EXTRACTION,
      entity: 'SOLOCAL MARKETING SERVICES',
      outcome: 'order',
      imposes_a_measure: false,
      fine_amount: undefined,
      fine_currency: undefined,
      summary_en:
        'The CNIL closed the injunction issued against SOLOCAL MARKETING SERVICES after the company brought its practices into line.'
    };

    await run();

    expect(journal.updates[0]!.patch['outcome']).toBe('closed');
    expect(journal.updates[0]!.patch['entity']).toBe('SOLOCAL MARKETING SERVICES');
  });

  it('overrides every punitive label, not just order', async () => {
    for (const label of ['fine', 'reprimand', 'ban', 'order']) {
      journal.updates.length = 0;
      vi.resetModules();
      install();
      toolInput = { ...GOOD_EXTRACTION, outcome: label, imposes_a_measure: false };
      await run();
      expect(journal.updates[0]!.patch['outcome']).toBe('closed');
    }
  });

  it('leaves the label alone when a measure was imposed', async () => {
    toolInput = { ...GOOD_EXTRACTION, outcome: 'fine', imposes_a_measure: true };
    await run();
    expect(journal.updates[0]!.patch['outcome']).toBe('fine');
  });

  it('never promotes guidance into a sanction', async () => {
    // Only the demoting direction. If the model says a document imposes
    // something and calls it guidance, the disagreement is left for a
    // human — inventing a sanction is the error this file exists against.
    toolInput = { ...GOOD_EXTRACTION, outcome: 'guidance', imposes_a_measure: true };
    await run();
    expect(journal.updates[0]!.patch['outcome']).toBe('guidance');
  });

  it('does not treat a closure as a duplicate of the order it closes', async () => {
    // Same authority, same date, same amount: the twin check compares
    // outcomes, and it must compare the one we are about to store rather
    // than the one the model offered.
    twinRows = [{ id: 'the-order', fine_amount: 300000, fine_currency: 'EUR', outcome: 'order' }];
    toolInput = { ...GOOD_EXTRACTION, outcome: 'order', imposes_a_measure: false };

    const body = await run();

    expect(body['rejected']).toBe(0);
    expect(journal.updates[0]!.patch['outcome']).toBe('closed');
  });
});
