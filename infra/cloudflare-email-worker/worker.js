import PostalMime from 'postal-mime';

/**
 * Cloudflare Email Worker — receives replies and posts them to LexyFlow.
 *
 * This replaces Make. Make was going to poll an IMAP mailbox and perform an
 * HTTP POST: a paid dependency, a third party in the path of our prospects'
 * personal data, and a signature scheme chosen by a vendor rather than by
 * us. Cloudflare Email Routing is free with no message limit, runs this code
 * at the edge the moment mail arrives, and signs the request with a secret
 * that exists only in our two systems.
 *
 * WHY THERE IS NOW A DEPENDENCY HERE, HAVING ARGUED AGAINST ONE
 *
 * The previous version of this file said "Only text/plain is read" and then
 * returned everything after the first blank line of the raw message. For a
 * reply from Gmail or Outlook — which is multipart/alternative — that is not
 * the text. It is a MIME boundary followed by quoted-printable or base64.
 * The comment was false, and the classifier downstream would have been
 * labelling encoded bytes as interest or refusal, then writing that label
 * onto the one dashboard number this company's validation rests on.
 *
 * The old note called a MIME parser "a dependency in an untested file". It
 * was right about the risk and wrong about the trade: a wrong answer
 * delivered confidently is worse than a dependency, and this is a project
 * that does not publish what it has not actually read. postal-mime is the
 * parser Cloudflare's own Email Workers documentation uses, it has no
 * dependencies of its own, and it does the one job this file cannot do
 * correctly by hand.
 *
 * WHAT IT STILL DELIBERATELY DOES NOT DO
 *
 * No classification, no decisions, no database. It forwards the fields the
 * route asked for and stops.
 *
 * DEPLOYMENT
 *
 *   ./deploy.sh        (needs CLOUDFLARE_API_TOKEN and INBOUND_WEBHOOK_SECRET)
 *
 * and, once, in the Cloudflare dashboard: zone → Email → Email Routing,
 * enable it and route `replies@go.lexyflow.com` (or the catch-all) to this
 * Worker. That step configures MX records for the zone and is the only part
 * that is not a command.
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
      // The envelope recipient, which carries the +token. This is the field
      // the route trusts; `from` it treats as a claim.
      to: message.to,
      from: message.from,
      subject: headers['subject'] ?? '',
      text: await extractText(message),
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
      // retried rather than dropped. A prospect's reply is not something to
      // lose because our application was restarting.
      //
      // 401 is named separately because it is the one failure retrying will
      // never fix: it means this Worker's secret and Vercel's have drifted,
      // and the only other symptom is silence. Cloudflare's log is where
      // somebody will look, so the sentence has to be readable there.
      if (response.status === 401) {
        throw new Error(
          'lexyflow rejected the signature (401) — INBOUND_WEBHOOK_SECRET here does not match the one in Vercel'
        );
      }
      if (response.status === 503) {
        throw new Error('lexyflow has no INBOUND_WEBHOOK_SECRET configured (503)');
      }
      throw new Error(`lexyflow responded ${response.status}`);
    }
  }
};

/**
 * The reply's plain text.
 *
 * Order of preference, and each step is a fact rather than a guess:
 *
 *   1. the text/plain part, which is what a mail client wrote for readers
 *      without HTML and is the closest thing to what the person typed;
 *   2. failing that, the HTML part with its tags removed — a degradation,
 *      and it is one because some senders now ship HTML only;
 *   3. failing both, an empty string.
 *
 * Empty is not a failure the route cannot handle: it records that somebody
 * replied regardless of what the classifier made of the text, and "a human
 * answered" is the signal. A label we could not compute is left uncomputed
 * rather than invented.
 */
async function extractText(message) {
  let parsed;
  try {
    parsed = await PostalMime.parse(message.raw);
  } catch (err) {
    // A message we cannot parse still happened. Forwarding it with no text
    // records the reply and leaves the label to a human, which is better
    // than dropping a prospect's answer on the floor.
    console.error('mime_parse_failed', err instanceof Error ? err.message : String(err));
    return '';
  }

  if (parsed.text) return parsed.text.slice(0, MAX_BYTES);
  if (parsed.html) return stripTags(parsed.html).slice(0, MAX_BYTES);
  return '';
}

/** Crude, and only ever reached when there is no text/plain part at all. */
function stripTags(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * HMAC-SHA256, hex.
 *
 * Must match src/lib/inbound-signature.ts byte for byte. That module is the
 * written form of this recipe and carries a test that signs a payload the
 * way this function does and asserts the route accepts it — because two
 * implementations of one contract, in two runtimes, is precisely the
 * arrangement that drifts silently.
 */
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
