/**
 * Facts about a published privacy policy. Never a verdict about whoever
 * published it.
 *
 * This is the only layer of the product that writes public sentences about
 * a named third party, so the line it sits on is drawn precisely:
 *
 *   "This document does not state a retention period"  — an observable
 *     property of a text, checkable by anyone who opens it.
 *   "This company is non-compliant"                     — a legal
 *     qualification, and defamatory if wrong.
 *
 * Only the first kind is produced here. The second kind is the private
 * audit, delivered to whoever asked, about their own document.
 *
 * THREE FINDINGS, AND THE MIDDLE ONE IS DELIBERATELY WEAK
 *
 *   present    we found it, and the exact passage travels with the finding
 *   not_found  we looked and did not find it
 *   unclear    we found something related and could not tell
 *
 * `not_found`, never `absent`. A retention period written as "for as long
 * as your account remains open, and twelve months thereafter" states a
 * period without using the word; a DPO contact published only as an image,
 * or on a sub-page we did not fetch, is published and invisible to us.
 * "Absent" would be a false factual claim about a named company. "Not found
 * in this document" is true whatever the document contains.
 *
 * EVIDENCE IS THE WHOLE MECHANISM
 *
 * A `present` finding without a span is an opinion, and opinions do not go
 * on this site. The span is a verbatim quotation from the fetched document,
 * so a reader who opens the source can confirm or destroy the claim in
 * thirty seconds. That is the property we want: our own output must be
 * cheap to refute if it is wrong.
 *
 * WHY A DETERMINISTIC PASS AND NOT A MODEL
 *
 * A model can read a policy better than a regular expression. It can also
 * produce a fluent, plausible, entirely invented quotation, and this file's
 * output is published under the name of a company that did not ask us for
 * anything. So the deterministic pass runs first and its findings are
 * reproducible by construction; a model may be added later ONLY under
 * `verifySpan` below, which rejects any quotation that is not present in
 * the source. The model proposes; the document disposes.
 */

export type Finding = 'present' | 'not_found' | 'unclear';

export interface Observation {
  id: ObservationId;
  finding: Finding;
  /** Verbatim from the document. Present only when the finding is `present`. */
  evidence?: string;
}

export type ObservationId =
  | 'retention_period_stated'
  | 'dpo_contact_published'
  | 'legal_basis_cited'
  | 'data_subject_rights_listed'
  | 'supervisory_authority_named'
  | 'international_transfers_addressed'
  | 'last_updated_stated';

/**
 * Confirm that a quotation really is in the document.
 *
 * The gate every model-proposed span must pass before it can be published.
 * Whitespace is normalised on both sides, because a model reflows text and
 * a line break is not a difference in what the document says. Nothing else
 * is normalised: a changed word is a changed claim.
 *
 * Returns the passage AS IT APPEARS IN THE SOURCE, not as it was proposed,
 * so what we publish is always the document's own wording.
 */
export function verifySpan(documentText: string, proposed: string): string | null {
  const needle = proposed.replace(/\s+/g, ' ').trim();
  if (needle.length < 12) return null;

  // Map every position in the normalised haystack back to the original, so
  // the returned quotation keeps the source's own spacing and casing.
  const positions: number[] = [];
  let normalised = '';
  let previousWasSpace = false;

  for (let i = 0; i < documentText.length; i += 1) {
    const char = documentText[i]!;
    if (/\s/.test(char)) {
      if (previousWasSpace || normalised.length === 0) continue;
      normalised += ' ';
      positions.push(i);
      previousWasSpace = true;
      continue;
    }
    normalised += char;
    positions.push(i);
    previousWasSpace = false;
  }

  const at = normalised.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;

  const start = positions[at]!;
  const end = positions[Math.min(at + needle.length - 1, positions.length - 1)]!;
  return documentText.slice(start, end + 1);
}

interface Rule {
  id: ObservationId;
  /** Vocabulary that says the topic is being discussed, in all seven locales. */
  topic: RegExp;
  /**
   * What must ALSO be present for the topic to count as answered.
   *
   * The two-part test is what keeps `present` honest. A policy that says
   * "we retain data as long as necessary" discusses retention and states no
   * period; matching the topic alone would publish "states a retention
   * period" about a document that does not.
   */
  confirm?: RegExp;
  /** How many distinct topic hits are needed. Used where one word is weak. */
  minimumHits?: number;
}

/** A duration: "12 months", "trois ans", "24 Monate", "5年", "٣ سنوات". */
const DURATION =
  /(\b\d{1,4}\s*(days?|jours?|months?|mois|years?|ans?|années?|Tage|Monate|Jahre|días|dias|meses|años|anos|日|ヶ月|年|يوم|شهر|سنة|سنوات)\b|\b(thirty|sixty|ninety|twelve|twenty-four|trois|six|douze|vingt-quatre|zwölf|doce|doze)\s*(days?|jours?|months?|mois|years?|ans?|Monate|meses)\b)/i;

/** Something that can actually be contacted. */
const CONTACT = /([\w.+-]+@[\w-]+\.[\w.]{2,}|https?:\/\/\S+|\+\d[\d\s().-]{7,})/;

const RULES: Rule[] = [
  {
    id: 'retention_period_stated',
    topic:
      /(retention|retain(ed|ing)?|conservation|conservons|conserv(é|ee|ees|és)|Speicherdauer|aufbewahr|conservación|conservamos|retenção|retemos|保存期間|保持期間|الاحتفاظ|مدة)/i,
    confirm: DURATION
  },
  {
    id: 'dpo_contact_published',
    topic:
      /(data protection officer|\bDPO\b|délégué(e)? à la protection des données|\bDPD\b|Datenschutzbeauftragte|delegado de protección de datos|encarregado de (proteção|dados)|データ保護責任者|個人情報保護管理者|مسؤول حماية البيانات)/i,
    confirm: CONTACT
  },
  {
    id: 'legal_basis_cited',
    topic:
      /(legal bas[ie]s|lawful bas[ie]s|base l[ée]gale|fondement juridique|Rechtsgrundlage|base jurídica|base legal|法的根拠|الأساس القانوني|article\s*6|art\.?\s*6\b)/i,
    confirm:
      /(consent|consentement|Einwilligung|consentimiento|consentimento|同意|موافقة|legitimate interest|intérêt légitime|berechtigte[sn]? Interesse|interés legítimo|interesse legítimo|contract|contrat|Vertrag|contrato|legal obligation|obligation légale|rechtliche Verpflichtung|obligación legal|obrigação legal|正当な利益|article\s*6)/i
  },
  {
    id: 'data_subject_rights_listed',
    // One right mentioned in passing is not a list of rights. Three is.
    topic:
      /(right to (access|rectification|erasure|be forgotten|restrict|object|portability|withdraw)|droit (d['’]acc[èe]s|de rectification|à l['’]effacement|d['’]opposition|à la portabilité|à la limitation)|Recht auf (Auskunft|Berichtigung|Löschung|Widerspruch|Datenübertragbarkeit|Einschränkung)|derecho de (acceso|rectificación|supresión|oposición|portabilidad|limitación)|direito (de acesso|à retificação|ao apagamento|de oposição|à portabilidade)|(開示|訂正|利用停止|削除)を請求|الحق في (الوصول|التصحيح|المحو|الاعتراض))/gi,
    minimumHits: 3
  },
  {
    id: 'supervisory_authority_named',
    topic:
      /(supervisory authority|autorit[ée] de contr[ôo]le|Aufsichtsbehörde|autoridad de control|autoridade (de controlo|nacional)|監督機関|個人情報保護委員会|السلطة الرقابية|\bCNIL\b|\bICO\b|\bAEPD\b|\bANPD\b|Garante|Datatilsynet|\bEDPB\b|\bSDAIA\b)/i,
    confirm:
      /(complain|plainte|réclamation|Beschwerde|reclamación|reclamação|苦情|شكوى|lodge|introduire|einreichen|presentar|apresentar|\bCNIL\b|\bICO\b|\bAEPD\b|\bANPD\b|Garante|\bSDAIA\b)/i
  },
  {
    id: 'international_transfers_addressed',
    topic:
      /(international transfer|transfer(s|red)? (outside|to a third country|internationa)|transfert(s)? (hors|internationa)|Drittland|internationale Übermittlung|transferencia(s)? internacional|transferência(s)? internacional|国外(移転|提供)|third[- ]country|النقل الدولي)/i,
    confirm:
      /(standard contractual clauses|clauses contractuelles types|Standardvertragsklauseln|cláusulas contractuales tipo|cláusulas contratuais|\bSCCs?\b|adequacy (decision|finding)|décision d['’]adéquation|Angemessenheitsbeschluss|decisión de adecuación|binding corporate rules|\bBCRs?\b|標準契約条項|十分性認定|derogation|dérogation)/i
  },
  {
    id: 'last_updated_stated',
    topic:
      /(last updated|last revised|effective date|dernière (mise à jour|révision)|mis à jour le|en vigueur le|zuletzt (aktualisiert|geändert)|Stand:|última actualización|última atualização|最終更新|改定日|آخر تحديث)/i,
    confirm:
      /(\b\d{1,2}[\/.\- ]\d{1,2}[\/.\- ]\d{2,4}\b|\b\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janeiro|fevereiro|março|maio|junho|julho|setembro|outubro|novembro|dezembro)\b[^.]{0,20}\d{4}|\d{4}\s*年)/i
  }
];

/**
 * How much text travels with a finding.
 *
 * Long enough that a reader can tell what the sentence was about, short
 * enough that we are quoting a fact rather than republishing somebody's
 * prose. Facts are not copyrightable; a page of their writing is.
 */
const EVIDENCE_CHARS = 240;

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - Math.floor((EVIDENCE_CHARS - length) / 2));
  const end = Math.min(text.length, start + EVIDENCE_CHARS);

  // Trim to word boundaries so the quotation does not start mid-word, which
  // reads like a doctored one.
  let slice = text.slice(start, end);
  if (start > 0) slice = slice.replace(/^\S*\s/, '');
  if (end < text.length) slice = slice.replace(/\s\S*$/, '');

  return `${start > 0 ? '…' : ''}${slice.trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Read a document and report what is in it.
 *
 * Every rule is a two-part test: the topic must be discussed AND the thing
 * that answers it must be there. A policy saying "we retain your data for
 * as long as necessary" discusses retention and states no period — matching
 * the topic alone would publish "states a retention period" about a
 * document that does not, which is exactly the error this whole design is
 * built to make impossible.
 *
 * Topic without confirmation is `unclear`, not `not_found`. The subject was
 * raised; we simply cannot tell whether it was answered, and saying so is
 * both true and more useful than a wrong binary.
 */
export function observePolicy(text: string): Observation[] {
  return RULES.map((rule): Observation => {
    if (rule.minimumHits) {
      const matches = [...text.matchAll(new RegExp(rule.topic.source, 'gi'))];
      if (matches.length >= rule.minimumHits) {
        const first = matches[0]!;
        return {
          id: rule.id,
          finding: 'present',
          evidence: excerptAround(text, first.index ?? 0, first[0].length)
        };
      }
      return { id: rule.id, finding: matches.length > 0 ? 'unclear' : 'not_found' };
    }

    const topic = rule.topic.exec(text);
    if (!topic) return { id: rule.id, finding: 'not_found' };

    if (!rule.confirm) {
      return {
        id: rule.id,
        finding: 'present',
        evidence: excerptAround(text, topic.index, topic[0].length)
      };
    }

    // The confirmation has to be NEAR the topic, not anywhere in a
    // twelve-thousand-word document. A retention section and an unrelated
    // "30 days" in the cookie table are not the same sentence.
    const window = text.slice(Math.max(0, topic.index - 200), topic.index + 600);
    if (!rule.confirm.test(window)) return { id: rule.id, finding: 'unclear' };

    return {
      id: rule.id,
      finding: 'present',
      evidence: excerptAround(text, topic.index, topic[0].length)
    };
  });
}
