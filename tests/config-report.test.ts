import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { CONFIG_GROUPS, configStatus, missingRequired } from '../src/lib/config-report';

/**
 * The card is a diagnostic, so the only interesting failures are the ones
 * where it says something untrue.
 *
 * Two of them are possible by construction. It can call a variable absent
 * that is present — because `readEnv` reads each name with a static
 * property access and somebody added a name to CONFIG_GROUPS without adding
 * the access. And it can claim the product needs a variable that no code
 * reads. Both would send the operator to change configuration that was
 * fine, which is the shape of every incident this codebase has had.
 */

const NAMES = CONFIG_GROUPS.flatMap((g) => g.entries.map((e) => e.name));

const saved = new Map<string, string | undefined>();

function setEnv(name: string, value: string): void {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe('configStatus', () => {
  it('reports every documented variable as present when it is set', () => {
    // The guard against the false alarm. A name listed in CONFIG_GROUPS but
    // missing from readEnv reads as undefined for ever, and the card paints
    // a working secret red.
    for (const name of NAMES) setEnv(name, 'x'.repeat(40));

    const absent = configStatus()
      .flatMap((g) => g.entries)
      .filter((e) => !e.present)
      .map((e) => e.name);

    expect(absent).toEqual([]);
  });

  it('treats a variable set to an empty value as absent', () => {
    setEnv('CRON_SECRET', '   ');

    const entry = configStatus()
      .flatMap((g) => g.entries)
      .find((e) => e.name === 'CRON_SECRET');

    // `FOO=` in Vercel is a variable that exists and configures nothing.
    expect(entry?.present).toBe(false);
  });

  it('never returns the value, and fingerprints only long values', () => {
    const secret = 'S'.repeat(63);
    setEnv('DOMAIN_VERIFICATION_SECRET', secret);
    setEnv('DOCUMENT_ENCRYPTION_ACTIVE', 'v2');

    const entries = configStatus().flatMap((g) => g.entries);
    const long = entries.find((e) => e.name === 'DOMAIN_VERIFICATION_SECRET');
    const short = entries.find((e) => e.name === 'DOCUMENT_ENCRYPTION_ACTIVE');

    expect(long?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    // A short or structured value can be guessed and checked against a
    // digest offline, so it gets no fingerprint at all.
    expect(short?.fingerprint).toBeNull();

    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain(secret.slice(0, 8));
  });

  it('lists the required variables that are absent, and only those', () => {
    for (const name of NAMES) setEnv(name, 'x'.repeat(40));
    delete process.env.CRON_SECRET;
    delete process.env.RESEND_WEBHOOK_SECRET;

    const missing = missingRequired(configStatus());

    expect(missing).toContain('CRON_SECRET');
    // Optional means an absence is a note, not a fault. Mixing the two is
    // how a console stops being read.
    expect(missing).not.toContain('RESEND_WEBHOOK_SECRET');
  });
});

describe('CONFIG_GROUPS', () => {
  it('names no variable twice', () => {
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });

  it('documents a consequence for each variable', () => {
    for (const entry of CONFIG_GROUPS.flatMap((g) => g.entries)) {
      // A name with no consequence is a name the operator cannot act on.
      expect(entry.consequence.length, entry.name).toBeGreaterThan(20);
    }
  });

  it('only lists variables the application actually reads', () => {
    // Claiming the product needs a variable nothing reads is a false
    // statement about our own software, published on the page an operator
    // consults when he already distrusts the system.
    const sources = collectSources(path.resolve(__dirname, '../src'));
    const corpus = sources
      .filter((file) => file !== path.resolve(__dirname, '../src/lib/config-report.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    for (const name of NAMES) {
      expect(corpus.includes(`process.env.${name}`), name).toBe(true);
    }
  });
});

function collectSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return collectSources(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
