import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { medianPerAudit } from '@/lib/model-usage';

/**
 * Everything said about margin in this project has been arithmetic over
 * my own estimates — "roughly five thousand input tokens an extraction",
 * "an audit is two orders of magnitude above that". Those are guesses
 * with the grammar of figures, and the question they stood in for is the
 * one that decides whether the pricing works.
 */

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const LIB = read('src', 'lib', 'model-usage.ts');
const CALC = read('src', 'components', 'CostCalculator.tsx');
const SQL = read('supabase', 'migrations', '0042_model_usage.sql');

describe('the middle audit, not the average one', () => {
  it('takes the median so one huge audit cannot move the figure', () => {
    // A thirteen-framework run against a two-megabyte contract displaces
    // a mean over a handful of audits all by itself.
    const perAudit = [
      { inputTokens: 10_000, outputTokens: 2_000 },
      { inputTokens: 12_000, outputTokens: 2_400 },
      { inputTokens: 900_000, outputTokens: 60_000 }
    ];
    expect(medianPerAudit(perAudit)).toEqual({ inputTokens: 12_000, outputTokens: 2_400 });
  });

  it('averages the two middles on an even count', () => {
    expect(
      medianPerAudit([
        { inputTokens: 10, outputTokens: 2 },
        { inputTokens: 20, outputTokens: 4 }
      ])
    ).toEqual({ inputTokens: 15, outputTokens: 3 });
  });

  it('returns null rather than zero when nothing was measured', () => {
    // Zero is a cost. "We have not measured one" is not.
    expect(medianPerAudit([])).toBeNull();
  });
});

describe('the ledger holds numbers, not text', () => {
  it('stores no prompt, completion or customer content', () => {
    for (const column of ['prompt', 'completion', 'document', 'text', 'content']) {
      expect(SQL.toLowerCase()).not.toContain(`${column} text`);
    }
  });

  it('records the model as the provider named it', () => {
    // A cost attributed to the wrong model is worse than no cost.
    expect(SQL).toContain('model          text not null');
  });

  it('writes nothing when the provider reported no usage', () => {
    // A row of zeroes would read as a free call.
    expect(LIB).toContain('if (input === null && output === null)');
    expect(LIB).toContain('no_usage_reported');
  });

  it('never lets bookkeeping break the path it measures', () => {
    expect(LIB).toContain('[model-usage] write_threw');
    expect(LIB).toContain('[model-usage] write_failed');
  });
});

describe('the calculator does the arithmetic and quotes nobody', () => {
  it('takes the rates as input rather than hard-coding a price', () => {
    // This sandbox cannot reach a pricing page, and a per-token rate
    // recalled from memory is the confident unsourced number that this
    // project exists to keep out of its own tables.
    expect(CALC).toContain('setInputRate');
    expect(CALC).toContain('setOutputRate');
    expect(CALC).not.toMatch(/const\s+\w*RATE\w*\s*=\s*[\d.]+/);
  });

  it('computes nothing until there are measured tokens', () => {
    expect(CALC).toContain('inputs.medianInput === null');
    expect(CALC).toContain('un coût par audit estimé');
  });

  it('says the margin is gross and the case is the worst one', () => {
    // A plan fully consumed, model cost only. Anything else would read
    // as a net margin it is not.
    expect(CALC).toContain('Ni Stripe, ni Vercel');
    expect(CALC).toContain('jusqu&apos;au');
  });

  it('reports how many audits carry no measurement', () => {
    // Averaging over the ones that happen to have rows would quietly
    // change the population.
    expect(CALC).toContain('auditsTotal > inputs.auditsWithUsage');
  });
});
