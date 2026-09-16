import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rotating the key must never cost a customer their document.
 *
 * Every ciphertext was sealed under a single master key with nothing
 * recording which one. The day that key had to be rotated — a leaked
 * environment dump, a laptop out of the building — rotating would have
 * made every stored contract, DPA and policy permanently unreadable,
 * so the only available answer to "rotate it" would have been "we
 * cannot". These tests are the ones that let us say we can.
 */

vi.mock('server-only', () => ({}));

const K1 = Buffer.alloc(32, 1).toString('base64');
const K2 = Buffer.alloc(32, 2).toString('base64');
const K3 = Buffer.alloc(32, 3).toString('base64');

const SECRET = 'Clause 7.2 — le sous-traitant notifie toute violation sous 48 heures.';

async function crypto() {
  const mod = await import('@/lib/document-crypto');
  mod.__resetKeyCacheForTests();
  return mod;
}

function setEnv(env: Record<string, string | undefined>) {
  for (const key of [
    'DOCUMENT_ENCRYPTION_KEY',
    'DOCUMENT_ENCRYPTION_KEYS',
    'DOCUMENT_ENCRYPTION_ACTIVE'
  ]) {
    delete process.env[key];
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
}

beforeEach(() => vi.resetModules());
afterEach(() => setEnv({}));

describe('nothing changes until someone rotates on purpose', () => {
  it('reads the old single variable and calls it v1', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEY: K1 });
    const { encryptDocument, activeKeyId } = await crypto();

    expect(activeKeyId()).toBe('v1');
    expect(encryptDocument(SECRET).keyId).toBe('v1');
  });

  it('opens a row that has no key id at all', async () => {
    // Every document written before the keyring existed. A back-fill
    // would have claimed a fact about ciphertext nobody had opened;
    // resolving null to v1 claims nothing.
    setEnv({ DOCUMENT_ENCRYPTION_KEY: K1 });
    const { encryptDocument, decryptDocument } = await crypto();
    const sealed = encryptDocument(SECRET);

    expect(
      decryptDocument({
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyId: null
      })
    ).toBe(SECRET);
  });
});

describe('a rotation keeps every old document readable', () => {
  it('opens v1 ciphertext while sealing new documents under v2', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEY: K1 });
    const before = await crypto();
    const old = before.encryptDocument(SECRET);
    expect(old.keyId).toBe('v1');

    // The deploy that rotates: both keys held, v2 active.
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v1:${K1},v2:${K2}`, DOCUMENT_ENCRYPTION_ACTIVE: 'v2' });
    const after = await crypto();

    expect(after.activeKeyId()).toBe('v2');
    expect(after.encryptDocument(SECRET).keyId).toBe('v2');
    // The whole point: the pre-rotation document still opens.
    expect(after.decryptDocument({ ...old, keyId: old.keyId })).toBe(SECRET);
  });

  it('survives two rotations, so the mechanism is not a one-off', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v1:${K1}`, DOCUMENT_ENCRYPTION_ACTIVE: 'v1' });
    const first = await crypto();
    const a = first.encryptDocument('un');

    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v1:${K1},v2:${K2}`, DOCUMENT_ENCRYPTION_ACTIVE: 'v2' });
    const second = await crypto();
    const b = second.encryptDocument('deux');

    setEnv({
      DOCUMENT_ENCRYPTION_KEYS: `v1:${K1},v2:${K2},v3:${K3}`,
      DOCUMENT_ENCRYPTION_ACTIVE: 'v3'
    });
    const third = await crypto();

    expect(third.decryptDocument(a)).toBe('un');
    expect(third.decryptDocument(b)).toBe('deux');
    expect(third.encryptDocument('trois').keyId).toBe('v3');
  });

  it('says which key is missing when a retired one was dropped too early', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v1:${K1}`, DOCUMENT_ENCRYPTION_ACTIVE: 'v1' });
    const before = await crypto();
    const old = before.encryptDocument(SECRET);

    // v1 dropped while rows still reference it — the mistake step 5 of
    // the runbook exists to prevent.
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v2:${K2}`, DOCUMENT_ENCRYPTION_ACTIVE: 'v2' });
    const after = await crypto();

    // Naming the id is what makes this diagnosable at 3am.
    expect(() => after.decryptDocument(old)).toThrow(/no key "v1"/);
  });
});

describe('re-wrapping is what lets a key actually be retired', () => {
  it('flags a document sealed under a retired key', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v1:${K1},v2:${K2}`, DOCUMENT_ENCRYPTION_ACTIVE: 'v2' });
    const { needsRewrap } = await crypto();

    expect(needsRewrap('v1')).toBe(true);
    expect(needsRewrap(null)).toBe(true); // pre-keyring rows
    expect(needsRewrap('v2')).toBe(false);
  });

  it('re-seals under the active key without changing the plaintext', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEY: K1 });
    const before = await crypto();
    const old = before.encryptDocument(SECRET);

    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v1:${K1},v2:${K2}`, DOCUMENT_ENCRYPTION_ACTIVE: 'v2' });
    const after = await crypto();

    const opened = after.decryptDocument(old);
    const resealed = after.encryptDocument(opened);

    expect(resealed.keyId).toBe('v2');
    expect(after.plaintextEquals(after.decryptDocument(resealed), SECRET)).toBe(true);
    // A new IV every time, or GCM's nonce-reuse catastrophe is one
    // re-wrap away.
    expect(resealed.iv.equals(old.iv)).toBe(false);
  });

  it('nothing needs re-wrapping once a rotation has finished', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v2:${K2}`, DOCUMENT_ENCRYPTION_ACTIVE: 'v2' });
    const { encryptDocument, needsRewrap } = await crypto();
    expect(needsRewrap(encryptDocument(SECRET).keyId)).toBe(false);
  });
});

describe('a misconfigured keyring fails at the deploy, not on a customer read', () => {
  it('refuses an active id the keyring does not hold', async () => {
    // Sealing under a key nobody has produces ciphertext even we
    // cannot open, and the failure would surface later, to someone
    // else, on a read.
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v1:${K1}`, DOCUMENT_ENCRYPTION_ACTIVE: 'v9' });
    const { encryptDocument } = await crypto();
    expect(() => encryptDocument(SECRET)).toThrow(/DOCUMENT_ENCRYPTION_ACTIVE is "v9"/);
  });

  it('refuses a malformed entry rather than guessing', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `${K1}` });
    const { encryptDocument } = await crypto();
    expect(() => encryptDocument(SECRET)).toThrow(/is not "id:base64"/);
  });

  it('refuses a duplicate id, which would silently shadow a key', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v1:${K1},v1:${K2}` });
    const { encryptDocument } = await crypto();
    expect(() => encryptDocument(SECRET)).toThrow(/defines "v1" twice/);
  });

  it('refuses a key that is not 32 bytes', async () => {
    setEnv({ DOCUMENT_ENCRYPTION_KEYS: `v1:${Buffer.alloc(16, 7).toString('base64')}` });
    const { encryptDocument } = await crypto();
    expect(() => encryptDocument(SECRET)).toThrow(/32 bytes/);
  });

  it('says how to generate a key when none is configured', async () => {
    setEnv({});
    const { encryptDocument } = await crypto();
    expect(() => encryptDocument(SECRET)).toThrow(/randomBytes\(32\)/);
  });
});

describe('the bytea encoder and decoder agree', () => {
  it('round-trips ciphertext through the wire format', async () => {
    // They used to be a one-liner in the writer and a function in the
    // reader. A disagreement there fails the GCM tag and tells the
    // customer their document cannot be decrypted.
    const { toBytea, fromBytea } = await import('@/lib/bytea');
    setEnv({ DOCUMENT_ENCRYPTION_KEY: K1 });
    const { encryptDocument, decryptDocument } = await crypto();

    const sealed = encryptDocument(SECRET);
    const wire = {
      ciphertext: toBytea(sealed.ciphertext),
      iv: toBytea(sealed.iv),
      authTag: toBytea(sealed.authTag)
    };
    expect(wire.ciphertext.startsWith('\\x')).toBe(true);

    expect(
      decryptDocument({
        ciphertext: fromBytea(wire.ciphertext),
        iv: fromBytea(wire.iv),
        authTag: fromBytea(wire.authTag),
        keyId: sealed.keyId
      })
    ).toBe(SECRET);
  });
});
