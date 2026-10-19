import type { FrameworkId } from '@/lib/legal-frameworks';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface AuditFinding {
  id: string;
  framework: FrameworkId;
  /** Citation, e.g. "GDPR Art. 6(1)(a)" — kept verbatim across translations. */
  citation: string;
  severity: Severity;
  /** Short headline. Localized in pass 2. */
  title: string;
  /** Long-form analysis. Localized in pass 2. */
  body: string;
  /** Concrete remediation steps. Localized in pass 2. */
  recommendation: string;
  /** Verbatim quotation from the source document — never localized. */
  evidence: string;
  /**
   * What makes the cited provision govern this document.
   *
   * `evidence` proves the fact the finding rests on; this proves the
   * other half, which nothing used to have to establish. The first real
   * audit returned a `high` finding citing GDPR Art. 27 — a provision
   * that binds controllers NOT established in the EU — against a
   * controller established in France.
   */
  appliesBecause: string;
  /**
   * False when the provision's reach turns on a fact the document does
   * not settle. Forces the severity to `info`: an obligation nobody has
   * established the reader is under must not drive a risk score.
   */
  applicabilityCertain: boolean;
}

export interface AuditReport {
  /** Stable hash of the source document (sha-256) — used for idempotency. */
  documentHash: string;
  frameworks: FrameworkId[];
  /** BCP-47 tag of the report. Independent from the UI locale. */
  language: string;
  generatedAt: string;
  summary: string;
  riskScore: number;
  findings: AuditFinding[];
}
