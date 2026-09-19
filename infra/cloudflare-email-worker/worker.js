/**
 * Cloudflare Email Worker — receives replies and posts them to LexyFlow.
 *
 * This replaces Make. Make was going to poll an IMAP mailbox and perform
 * an HTTP POST: a paid dependency, a third party in the path of our
 * prospects' personal data, and a signature scheme chosen by a vendor
 * rather than by us. Cloudflare Email Routing is free with no message
 * limit, runs this code at the edge the moment mail arrives, and signs the
 * request with a secret that exists only in our two systems.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No parsing, no classification, no decisions. It forwards the parts our
 * route asked for and stops. Logic that lives here is logic with no tests,
 * no types and no way to run it locally — and the one thing worse than an
 * unparsed email is an email silently mangled by a script nobody can read.
 *
 * DEPLOYMENT
 *
 *   1. Cloudflare → your zone → Email → Email Routing, enable it.
 *   2. Create the catch-all or the address `replies@go.lexyflow.com`
 *      and route it to this Worker.
 *   3. wrangler secret put INBOUND_WEBHOOK_SECRET   (same value as Vercel)
 *   4. wrangler deploy
 *
 * The secret must match Vercel's INBOUND_WEBHOOK_SECRET exactly. If they
 * ever drift, this Worker gets a 401 on every message and the only symptom
 * is that replies stop appearing — so the route logs every rejection with
 * its reason.
 */

/** Bodies above this are quoted threads and attachments, not a reply. */
const MAX_BYTES = 256 * 1024;

export default {
  /**
   * @param {ForwardableEmailMessage} message
   * @param {{ INBOUND_WEBHOOK_SECRET: string, TARGET_URL: string }} env
   */
  async email(message, env) {
    const headers = {};
    for (const [name, value] of message.headers) {
      headers[name.toLowerCase()] = value;
    }

    const payload = {
      // Message-ID is what makes delivery idempotent on the other side: a
      // retry after a timeout must not become two replies.
      messageId: headers['message-id'] ?? `${message.from}:${Date.now()}`,
      // The envelope recipient, which carries the +token. This is the
      // field the route trusts; `from` it treats as a claim.
      to: message.to,
      from: message.from,
      subject: headers['subject'] ?? '',
      text: await readText(message),
      headers
    };

    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sign(`${timestamp}.${body}`, env.INBOUND_WEBHOOK_SECRET);

    const response = await fetch(env.TARGET_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lexyflow-signature': signature,
        'x-lexyflow-timestamp': timestamp
      },
      body
    });

    if (!response.ok) {
      // Throwing tells Cloudflare the message was not handled, so it is
      // retried rather than dropped. A prospect's reply is not something
      // to lose because our application was restarting.
      throw new Error(`lexyflow responded ${response.status}`);
    }
  }
};

/**
 * The plain-text part, truncated.
 *
 * Only text/plain is read. HTML mail would have to be stripped somewhere,
 * and doing it here means doing it in a file with no tests; the route asks
 * for text and the classifier reads the first few lines of it anyway.
 */
async function readText(message) {
  const reader = message.raw.getReader();
  const chunks = [];
  let size = 0;

  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.releaseLock();

  const raw = new TextDecoder().decode(concat(chunks));

  // The body begins after the first blank line. Crude on purpose: the
  // classifier cuts at the quote marker regardless, and a MIME parser here
  // is a dependency in an untested file.
  const split = raw.indexOf('\r\n\r\n');
  return split === -1 ? raw.slice(0, MAX_BYTES) : raw.slice(split + 4, split + 4 + MAX_BYTES);
}

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** HMAC-SHA256, hex. Must match the recipe in the route, byte for byte. */
async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
