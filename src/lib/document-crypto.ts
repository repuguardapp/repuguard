import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Document encryption, with a keyring rather than a key.
 *
 * WHY THIS IS NOT ONE VARIABLE ANY MORE
 *
 * Every stored document was sealed under a single master key with
 * nothing recording which key that was. That is fine until the day it
 * is not, and the day it is not is the worst day this company will
 * have: a suspected key compromise. Rotating would have made every
 * ciphertext in the table undecryptable — customers' contracts, their
 * DPAs, their policies, gone — so the only available answer to
 * "rotate the key" would have been "we cannot". Refusing to rotate
 * after a compromise is not a decision anyone gets to defend.
 *
 * So a ciphertext now carries the id of the key that sealed it, and
 * the process holds several keys at once: one ACTIVE key that seals
 * new documents, and any number of retired keys kept only to open old
 * ones. Rotation becomes a deploy, not an incident.
 *
 * CONFIGURATION
 *
 *   DOCUMENT_ENCRYPTION_KEYS   v1:<base64>,v2:<base64>
 *   DOCUMENT_ENCRYPTION_ACTIVE v2
 *
 * Both optional. With neither set, the old DOCUMENT_ENCRYPTION_KEY is
 * read and registered as `v1`, active — which is exactly today's
 * behaviour, so this change is inert until someone rotates on purpose.
 *
 * Rows written before this existed have no key id. They were sealed by
 * DOCUMENT_ENCRYPTION_KEY, so a null id means `v1` and nothing has to
 * be back-filled.
 *
 * TO ROTATE
 *
 *   1. Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   2. DOCUMENT_ENCRYPTION_KEYS = v1:<old>,v2:<new>
 *   3. DOCUMENT_ENCRYPTION_ACTIVE = v2
 *   4. Deploy. New documents seal under v2; old ones still open under
 *      v1, and re-seal under v2 the next time they are read.
 *   5. When `select count(*) from audits where document_key_id <> 'v2'`
 *      reaches zero, drop v1 from the list and the old key is dead.
 *
 * Step 5 is the one that makes a compromise survivable, and it is the
 * one a keyring without lazy re-wrapping never reaches.
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

/** The id written for ciphertexts that predate the keyring. */
export const LEGACY_KEY_ID = 'v1';

interface Keyring {
  activeId: string;
  keys: Map<string, Buffer>;
}

let cached: Keyring | null = null;

function decodeKey(raw: string, where: string): Buffer {
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`${where} must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

function loadKeyring(): Keyring {
  if (cached) return cached;

  const list = process.env.DOCUMENT_ENCRYPTION_KEYS?.trim();

  if (list) {
    const keys = new Map<string, Buffer>();
    for (const entry of list.split(',')) {
      const at = entry.indexOf(':');
      if (at < 1) {
        throw new Error(
          `DOCUMENT_ENCRYPTION_KEYS entry "${entry.slice(0, 12)}…" is not "id:base64"`
        );
      }
      const id = entry.slice(0, at).trim();
      if (keys.has(id)) throw new Error(`DOCUMENT_ENCRYPTION_KEYS defines "${id}" twice`);
      keys.set(id, decodeKey(entry.slice(at + 1), `DOCUMENT_ENCRYPTION_KEYS["${id}"]`));
    }

    const activeId = process.env.DOCUMENT_ENCRYPTION_ACTIVE?.trim() || [...keys.keys()].pop()!;
    if (!keys.has(activeId)) {
      // Sealing under a key nobody holds would produce ciphertext that
      // cannot be opened even by us, and the failure would surface
      // later, on read, for someone else.
      throw new Error(
        `DOCUMENT_ENCRYPTION_ACTIVE is "${activeId}" but the keyring holds ${[...keys.keys()].join(', ')}`
      );
    }
    cached = { activeId, keys };
    return cached;
  }

  const single = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!single) {
    throw new Error(
      'No document encryption key is configured. Set DOCUMENT_ENCRYPTION_KEYS ' +
        '(id:base64,…) with DOCUMENT_ENCRYPTION_ACTIVE, or the single ' +
        'DOCUMENT_ENCRYPTION_KEY. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  cached = {
    activeId: LEGACY_KEY_ID,
    keys: new Map([[LEGACY_KEY_ID, decodeKey(single, 'DOCUMENT_ENCRYPTION_KEY')]])
  };
  return cached;
}

export interface EncryptedDocument {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  /** Which key sealed this. Store it beside the ciphertext. */
  keyId: string;
}

export function encryptDocument(plaintext: string): EncryptedDocument {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encryptDocument: plaintext must be a string');
  }
  const { activeId, keys } = loadKeyring();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keys.get(activeId)!, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyId: activeId };
}

/**
 * Open a document.
 *
 * `keyId` may be null, which is what every row written before the
 * keyring carries. Those were sealed by DOCUMENT_ENCRYPTION_KEY, which
 * loads as `v1`.
 */
export function decryptDocument(enc: {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyId?: string | null;
}): string {
  if (enc.iv.length !== IV_BYTES) {
    throw new Error(`decryptDocument: iv must be ${IV_BYTES} bytes`);
  }
  if (enc.authTag.length !== TAG_BYTES) {
    throw new Error(`decryptDocument: authTag must be ${TAG_BYTES} bytes`);
  }

  const { keys } = loadKeyring();
  const keyId = enc.keyId ?? LEGACY_KEY_ID;
  const key = keys.get(keyId);
  if (!key) {
    // Naming the id is safe and is the only thing that makes this
    // diagnosable: it says which retired key was dropped too early.
    throw new Error(
      `decryptDocument: no key "${keyId}" on the keyring (holds ${[...keys.keys()].join(', ')})`
    );
  }

  const decipher = createDecipheriv(ALGO, key, enc.iv);
  decipher.setAuthTag(enc.authTag);
  return Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Is this ciphertext sealed under the key we currently seal with?
 *
 * The caller uses this to re-wrap on read. Lazy rotation is what lets
 * a retired key actually be retired: without it the old key has to be
 * kept for ever, and a keyring that never sheds a key is a keyring
 * that has not rotated.
 */
export function needsRewrap(keyId: string | null | undefined): boolean {
  return (keyId ?? LEGACY_KEY_ID) !== loadKeyring().activeId;
}

/** The id new documents are sealed under. */
export function activeKeyId(): string {
  return loadKeyring().activeId;
}

/**
 * Constant-time equality, used by the tests that assert a re-wrap
 * preserves the plaintext without printing it on failure.
 */
export function plaintextEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Test-only: drop the memoised keyring so env changes take effect. */
export function __resetKeyCacheForTests(): void {
  cached = null;
}
