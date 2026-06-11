/**
 * Regenerate the sample-report snapshot from a real public document.
 *
 * Pipeline:
 *   1. Fetch a public source document by URL.
 *   2. Strip HTML to plain text (lightweight regex — good enough for
 *      MediaWiki and most public privacy notices).
 *   3. Invoke the REAL runMultiPassAudit() pipeline — same code path
 *      that serves paying customers, no shortcut, no mock.
 *   4. Write the audit envelope + full provenance metadata to
 *      data/sample-report-snapshot.json.
 *
 * Usage:
 *   npm run regenerate:sample-report
 *   npm run regenerate:sample-report -- \
 *     --source https://foundation.wikimedia.org/wiki/Policy:Privacy_policy \
 *     --framework qatar_pdppl \
 *     --language ar
 *
 * Required env vars (same as production audit pipeline):
 *   ANTHROPIC_API_KEY
 *   OPENAI_API_KEY
 *
 * The script costs roughly $0.20-0.40 in API spend per run and takes
 * about 90-120 seconds wall-clock. Run it manually after every
 * material change to either the Multi-Pass prompts or the framework
 * rule index, and commit the updated JSON. The /sample-report page
 * is statically rendered from the committed snapshot — there is no
 * runtime API call from the visitor's request.
 *
 * Ethical contract: this script is the single mechanism by which
 * findings reach the public showcase page. No hand-edited findings,
 * no "polishing" the AI output, no synthetic injection. What the
 * engine returns is what the page renders.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runMultiPassAudit } from '../src/lib/multi-pass-engine';
import type { FrameworkId } from '../src/lib/legal-frameworks';

const DEFAULT_SOURCE_URL = 'https://foundation.wikimedia.org/wiki/Policy:Privacy_policy';
const DEFAULT_SOURCE_NAME = 'Wikimedia Foundation Privacy Policy';
const DEFAULT_SOURCE_LICENSE = 'CC BY-SA 4.0 — Wikimedia Foundation';
const DEFAULT_FRAMEWORK: FrameworkId = 'qatar_pdppl';
const DEFAULT_LANGUAGE = 'ar';

interface CliArgs {
  source: string;
  sourceName: string;
  sourceLicense: string;
  framework: FrameworkId;
  language: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    source: DEFAULT_SOURCE_URL,
    sourceName: DEFAULT_SOURCE_NAME,
    sourceLicense: DEFAULT_SOURCE_LICENSE,
    framework: DEFAULT_FRAMEWORK,
    language: DEFAULT_LANGUAGE
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--source' && next) { out.source = next; i++; }
    else if (arg === '--source-name' && next) { out.sourceName = next; i++; }
    else if (arg === '--source-license' && next) { out.sourceLicense = next; i++; }
    else if (arg === '--framework' && next) { out.framework = next as FrameworkId; i++; }
    else if (arg === '--language' && next) { out.language = next; i++; }
  }
  return out;
}

/**
 * Strip HTML to plain text. Good-enough heuristics for MediaWiki and
 * most public privacy notices — drops script/style/nav blocks, then
 * replaces tags with spaces and collapses whitespace. Not a
 * production HTML parser; if the source URL needs sophisticated
 * extraction, swap this for a real library.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('[regenerate-sample-report] config', args);

  // 1. Fetch source document
  console.log(`[regenerate-sample-report] fetching ${args.source}`);
  const res = await fetch(args.source, {
    headers: { 'User-Agent': 'LexyFlow sample-report regenerator (https://lexyflow.com)' }
  });
  if (!res.ok) {
    throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const text = htmlToText(html);
  const charCount = text.length;
  console.log(`[regenerate-sample-report] extracted ${charCount} characters`);
  if (charCount < 1000) {
    throw new Error(`extracted text too short (${charCount} chars) — check the source URL or htmlToText heuristics`);
  }

  // 2. Invoke the REAL audit engine. Same code path as production.
  console.log(`[regenerate-sample-report] running Multi-Pass against ${args.framework}, output language ${args.language}`);
  const t0 = Date.now();
  const report = await runMultiPassAudit({
    documentText: text,
    frameworks: [args.framework],
    targetLanguage: args.language
  });
  const durationSeconds = Math.round((Date.now() - t0) / 1000);
  console.log(`[regenerate-sample-report] audit complete in ${durationSeconds}s, riskScore=${report.riskScore}, findings=${report.findings.length}`);

  // 3. Map engine output to the snapshot shape. We pass findings
  // through verbatim — no editing, no curation, no severity remap.
  const snapshot = {
    $comment: 'Real LexyFlow audit output from the production Multi-Pass engine. See src/lib/sample-report-snapshot.ts for the ethical contract this file enforces.',
    generated: new Date().toISOString(),
    source: {
      url: args.source,
      name: args.sourceName,
      retrievedAt: new Date().toISOString(),
      charCount,
      license: args.sourceLicense
    },
    audit: {
      generatedAt: new Date().toISOString(),
      anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-latest',
      openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o',
      frameworks: [args.framework],
      targetLanguage: args.language,
      riskScore: report.riskScore,
      durationSeconds,
      findings: report.findings.map((f) => ({
        severity: f.severity,
        framework: f.framework,
        title: f.title,
        body: f.body,
        recommendation: f.recommendation,
        evidence: f.evidence
      }))
    }
  };

  const here = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(here, '..', 'data', 'sample-report-snapshot.json');
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`[regenerate-sample-report] wrote ${outPath}`);
  console.log('[regenerate-sample-report] DONE — commit data/sample-report-snapshot.json and redeploy.');
}

main().catch((err) => {
  console.error('[regenerate-sample-report] FAILED', err);
  process.exit(1);
});
