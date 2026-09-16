import 'server-only';

/**
 * The two halves of PostgREST's bytea wire format, in one place.
 *
 * They were a one-liner in the route that writes ciphertext and a
 * function in the route that reads it. That is fine until they
 * disagree, and the way they disagree is silent: a document sealed
 * with one encoding and opened with another fails its GCM auth tag,
 * and the customer is told their document cannot be decrypted. On a
 * product whose promise is that we can always give the document back,
 * there is no acceptable version of that bug — so the encoder and the
 * decoder live together, where a change to one is in front of the
 * other.
 */

/** Buffer → the hex literal Postgres accepts for a bytea column. */
export function toBytea(buf: Buffer): string {
  return `\\x${buf.toString('hex')}`;
}

/** The hex literal PostgREST returns → Buffer. */
export function fromBytea(hexLiteral: string): Buffer {
  const hex = hexLiteral.startsWith('\\x') ? hexLiteral.slice(2) : hexLiteral;
  return Buffer.from(hex, 'hex');
}
