import 'server-only';
import { supabaseService } from './supabase';

/**
 * What a model call actually cost, in tokens.
 *
 * Everything said about margin in this project so far has been
 * arithmetic over my own estimates: "roughly five thousand input tokens
 * an extraction", "an audit is two orders of magnitude above that". Those
 * are guesses dressed as figures, and the one number the business
 * actually needs — does the Starter plan cover ten audits — cannot be
 * built on them.
 *
 * The provider returns the true count on every response. Recording it is
 * the difference between "an audit probably costs about X" and "the last
 * forty audits cost this".
 *
 * NEVER BLOCKS AND NEVER THROWS
 *
 * This is bookkeeping attached to the path that produces the product. An
 * audit must not fail because we could not write down what it cost, so
 * every failure here is logged and swallowed — and the ledger being
 * incomplete is itself visible, because the dashboard reports how many
 * audits carry no usage rows rather than averaging over the ones that do.
 */

export type UsagePurpose =
  | 'extract_legal'
  | 'audit_pass1'
  | 'audit_localize'
  | 'audit_rewrite'
  | 'reply_classify'
  | 'other';

/** The shape both the Anthropic and OpenAI SDKs give back, narrowed. */
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export async function recordModelUsage(args: {
  purpose: UsagePurpose;
  model: string;
  usage: TokenUsage | null | undefined;
  auditId?: string | null;
}): Promise<void> {
  // Anthropic says input/output; OpenAI says prompt/completion. Reading
  // both here rather than at each call site keeps the ledger in one
  // vocabulary — and means a provider that reports neither writes no row
  // rather than a row of zeroes, which would read as a free call.
  const input = args.usage?.input_tokens ?? args.usage?.prompt_tokens ?? null;
  const output = args.usage?.output_tokens ?? args.usage?.completion_tokens ?? null;

  if (input === null && output === null) {
    console.warn('[model-usage] no_usage_reported', {
      purpose: args.purpose,
      model: args.model
    });
    return;
  }

  try {
    const { error } = await supabaseService().from('model_usage').insert({
      purpose: args.purpose,
      model: args.model,
      input_tokens: input ?? 0,
      output_tokens: output ?? 0,
      audit_id: args.auditId ?? null
    });
    if (error) console.error('[model-usage] write_failed', { error: error.message });
  } catch (err) {
    console.error('[model-usage] write_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export interface UsageRollup {
  purpose: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageReport {
  sinceDays: number;
  rollup: UsageRollup[];
  /** Audits in the window, and how many of them have any usage recorded. */
  audits: { total: number; withUsage: number };
  /** Per-audit totals, so the median is available rather than the mean. */
  perAudit: { inputTokens: number; outputTokens: number }[];
}

/** Null means we could not read the ledger — never an empty one. */
export async function usageReport(sinceDays = 30): Promise<UsageReport | null> {
  try {
    const db = supabaseService();
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

    const [{ data: usage, error }, { data: audits, error: auditError }] = await Promise.all([
      db
        .from('model_usage')
        .select('purpose, model, input_tokens, output_tokens, audit_id')
        .gte('created_at', since)
        .limit(50_000),
      db.from('audits').select('id').gte('created_at', since).limit(10_000)
    ]);

    if (error || auditError) {
      console.error('[model-usage] read_failed', {
        error: error?.message ?? auditError?.message
      });
      return null;
    }

    const rows = (usage ?? []) as {
      purpose: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      audit_id: string | null;
    }[];

    const byKey = new Map<string, UsageRollup>();
    const byAudit = new Map<string, { inputTokens: number; outputTokens: number }>();

    for (const row of rows) {
      const key = `${row.purpose}|${row.model}`;
      const entry = byKey.get(key) ?? {
        purpose: row.purpose,
        model: row.model,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0
      };
      entry.calls += 1;
      entry.inputTokens += row.input_tokens;
      entry.outputTokens += row.output_tokens;
      byKey.set(key, entry);

      if (row.audit_id) {
        const a = byAudit.get(row.audit_id) ?? { inputTokens: 0, outputTokens: 0 };
        a.inputTokens += row.input_tokens;
        a.outputTokens += row.output_tokens;
        byAudit.set(row.audit_id, a);
      }
    }

    return {
      sinceDays,
      rollup: [...byKey.values()].sort((a, b) => b.inputTokens - a.inputTokens),
      audits: { total: (audits ?? []).length, withUsage: byAudit.size },
      perAudit: [...byAudit.values()]
    };
  } catch (err) {
    console.error('[model-usage] read_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

/**
 * The middle audit, not the average one.
 *
 * A mean over a handful of audits is moved bodily by one thirteen-
 * framework run against a two-megabyte contract. The median says what a
 * typical audit costs, which is the number a price has to cover.
 */
export function medianPerAudit(perAudit: { inputTokens: number; outputTokens: number }[]): {
  inputTokens: number;
  outputTokens: number;
} | null {
  if (perAudit.length === 0) return null;
  const mid = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const i = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? Math.round((sorted[i - 1]! + sorted[i]!) / 2) : sorted[i]!;
  };
  return {
    inputTokens: mid(perAudit.map((a) => a.inputTokens)),
    outputTokens: mid(perAudit.map((a) => a.outputTokens))
  };
}
