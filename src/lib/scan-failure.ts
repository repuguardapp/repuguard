/**
 * Turn the machine's reason into a sentence, without claiming more than
 * the machine knows.
 *
 * `read ECONNRESET` is exact and means nothing to a data protection
 * officer. It was also being printed in English on a French page, which is
 * a translation gap on the one line a visitor most needs to understand.
 *
 * Each code below maps a raw failure to a sentence, and the raw string is
 * still shown underneath it. The sentence is the reading; the code is the
 * evidence, and a reader who knows what ECONNRESET means can check that we
 * read it correctly — the same arrangement as an observation and its
 * quotation.
 *
 * WHAT NONE OF THESE SENTENCES SAY
 *
 * That the company has no privacy policy, or that its site is broken.
 * Every one is a fact about our connection attempt. A site that resets our
 * connection has refused us, and "they refused us" is what we report.
 *
 * AND WE DO NOT WORK AROUND A REFUSAL
 *
 * A site dropping our connection is bot mitigation doing its job. We could
 * very probably get past it by sending browser-shaped headers and hiding
 * what we are — and that is the one thing this product cannot do. We obey
 * robots.txt, we identify ourselves in the user agent, and when a site
 * says no we publish the refusal instead of defeating it. A compliance
 * company that disguises its crawler has nothing left to sell.
 */

export type FailureCode =
  | 'refused_connection'
  | 'unreachable'
  | 'tls'
  | 'robots'
  | 'no_link'
  | 'shell_page'
  | 'not_a_policy'
  | 'pdf'
  | 'http_error'
  | 'other';

export function classifyScanFailure(raw: string | null): FailureCode {
  if (!raw) return 'other';
  const text = raw.toLowerCase();

  // The connection was made and then cut. Almost always a bot gate.
  if (/econnreset|econnaborted|epipe|socket hang up/.test(text)) return 'refused_connection';

  // The name did not resolve, or nothing answered at all.
  if (/enotfound|eai_again|econnrefused|ehostunreach|enetunreach|timeout|timed out/.test(text)) {
    return 'unreachable';
  }

  if (/cert|tls|ssl|self.signed|handshake/.test(text)) return 'tls';
  if (/robots\.txt/.test(text)) return 'robots';
  if (/links to no privacy policy|no policy link|no candidate/.test(text)) return 'no_link';
  if (/none of the seven observations/.test(text)) return 'not_a_policy';
  if (/built in the browser|characters of text|yielded only/.test(text)) return 'shell_page';
  if (/\bpdf\b/.test(text)) return 'pdf';
  if (/http \d{3}|http_\d{3}/.test(text)) return 'http_error';

  return 'other';
}
