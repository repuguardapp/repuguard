import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The privacy policy names the models we send customer text to. It named
 * one we had stopped using.
 *
 * "Anthropic, PBC (USA) — Claude 3.5 Sonnet, audit pass." The audit pass
 * had been running on claude-sonnet-4-6 since Anthropic retired the 3.5
 * model; the migration note sits in lib/ai-clients.ts and the policy was
 * never updated with it.
 *
 * The sub-processor, the country and the transfer basis were all right.
 * It is still a false statement of fact on a published privacy policy,
 * by a company that audits privacy policies — and our own engine read
 * this exact section, flagged the missing DPA confirmation under Art.
 * 28(3), and did not notice the model name was wrong.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const CLIENTS = read('src/lib/ai-clients.ts');
const POLICY = read('src/app/[locale]/privacy/page.tsx');

/** The list the policy publishes, without the surrounding comment. */
const published = POLICY.slice(POLICY.indexOf('<h2>4. AI sub-processors</h2>'))
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .slice(0, 900);

function defaultModel(constant: string): string {
  const line = CLIENTS.split('\n').find((l) => l.includes(`export const ${constant}`));
  return line?.match(/\?\?\s*'([^']+)'/)?.[1] ?? '';
}

describe('the policy names the models we actually call', () => {
  it('does not name a model the code no longer uses', () => {
    // 3.5 survives in ai-clients.ts only inside the comment explaining
    // that it was retired. It must not survive in the policy at all.
    expect(published).not.toMatch(/3\.5 Sonnet/);
  });

  it('names the current audit model', () => {
    const model = defaultModel('ANTHROPIC_MODEL');
    expect(model).toBe('claude-sonnet-4-6');
    // The policy writes it for humans; the identifier is the source of
    // truth. Compare on the version so a rename of the prose cannot
    // quietly drift from the model being called.
    expect(published).toMatch(/Sonnet 4\.6/);
  });

  it('names the current localisation model', () => {
    expect(defaultModel('OPENAI_MODEL')).toBe('gpt-4o');
    expect(published).toMatch(/GPT-4o/);
  });

  it('keeps the facts that were always right', () => {
    // Only the model name was wrong. The rest of the disclosure is what
    // makes it a sub-processor list rather than a brand list.
    expect(published).toContain('Anthropic, PBC (USA)');
    expect(published).toContain('OpenAI, L.L.C. (USA)');
  });
});
