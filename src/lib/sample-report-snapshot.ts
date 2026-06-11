import snapshotJson from '../../data/sample-report-snapshot.json';

/**
 * Read access to the most recently generated sample-report snapshot.
 *
 * Strict ethical contract — this loader will NEVER synthesize an
 * audit. The /sample-report page is the public-facing showcase of
 * LexyFlow's actual output; presenting hand-crafted findings dressed
 * as a real audit would contradict the trust posture the product is
 * sold on (citations from a real document, scoring from the real
 * engine, recommendations from the real Multi-Pass pipeline).
 *
 * The snapshot at data/sample-report-snapshot.json is populated by
 * running `npm run regenerate:sample-report` — a Node script that:
 *
 *   1. fetches a public source document by URL (default: Wikimedia
 *      Foundation Privacy Policy, CC-BY-SA, fully verifiable);
 *   2. extracts plain text;
 *   3. invokes the REAL runMultiPassAudit() pipeline against the
 *      target framework (default: Qatar PDPPL);
 *   4. writes the audit envelope plus full provenance metadata
 *      (source URL, retrieval ISO, audit ISO, model versions,
 *      framework version) into the snapshot file.
 *
 * Until the script has been run, getSampleSnapshot() returns null
 * and the page renders a transparent "regenerating" state with a
 * link to /audit so visitors can run their own. No fabricated
 * findings are ever rendered.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SnapshotFinding {
  severity: Severity;
  framework: string;
  title: string;
  body: string;
  recommendation: string;
  evidence: string;
}

export interface SnapshotSource {
  /** Publicly accessible URL the source document was fetched from. */
  url: string;
  /** Human-readable name of the source — "Wikimedia Foundation Privacy Policy" etc. */
  name: string;
  /** ISO 8601 timestamp the source was fetched. */
  retrievedAt: string;
  /** Number of characters extracted. Lets the UI surface "audited 23 480 characters". */
  charCount: number;
  /** Copyright / licensing note shown in the page footer. */
  license: string;
}

export interface SnapshotAudit {
  /** ISO 8601 timestamp the audit pipeline was invoked. */
  generatedAt: string;
  /** Anthropic model id used for the Multi-Pass pipeline. */
  anthropicModel: string;
  /** OpenAI model id used for the Multi-Pass pipeline. */
  openaiModel: string;
  /** Framework ids the audit was scoped against. */
  frameworks: string[];
  /** Localized target language of the report. */
  targetLanguage: string;
  /** Aggregate 0-100 risk score. */
  riskScore: number;
  /** Total wall-clock seconds the audit pipeline took. */
  durationSeconds: number;
  /** Findings — verbatim from the engine, no post-processing. */
  findings: SnapshotFinding[];
}

/**
 * The shape the page consumes — every field is guaranteed non-null
 * because getSampleSnapshot() narrows on emptiness before returning.
 */
export interface SampleSnapshot {
  generated: string;
  source: SnapshotSource;
  audit: SnapshotAudit;
}

interface RawSnapshot {
  generated: string | null;
  source: SnapshotSource | null;
  audit: SnapshotAudit | null;
}

/**
 * Returns the snapshot iff it has been populated by the regeneration
 * script. Returns null when the snapshot is empty (the initial
 * post-deploy state, before the script has been run).
 */
export function getSampleSnapshot(): SampleSnapshot | null {
  const raw = snapshotJson as RawSnapshot;
  if (!raw.generated || !raw.source || !raw.audit) return null;
  return { generated: raw.generated, source: raw.source, audit: raw.audit };
}
