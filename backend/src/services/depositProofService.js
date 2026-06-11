import {
  buildOcrVariants,
  decodeImageDataUrl,
  detectNamesFromText,
  extractAmountCandidates,
  normalizeDigits,
  normalizeText
} from './imageProcessing.js';

const DEPOSIT_OCR_MIN_CONFIDENCE = 80;
const RECEIPT_OCR_MIN_CONFIDENCE = 72;
const STATUS_OK_PATTERN = /\b(effectue|effectué|succes|success|termine|terminé|complete|completed)\b/i;
const STATUS_FAILED_PATTERN = /\b(echec|echoue|échoué|failed|annule|annulé|cancelled)\b/i;

function extractReferenceCandidates(text) {
  const source = normalizeText(text);
  const candidates = [];
  const seen = new Set();
  const patterns = [
    /\b(?:ref|reference|transaction|transaction reference|id|numero|number)\s*[:\-]?\s*([a-z0-9]{4,})\b/g,
    /\b(?:id de transaction|transaction id|transactionid)\s*[:\-]?\s*([a-z0-9]{4,})\b/g,
    /\b([a-z0-9]{8,})\b/g
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      if (value.length < 4 || seen.has(value)) continue;
      seen.add(value);
      candidates.push(value);
    }
  }
  return candidates;
}

function detectReceiptStatus(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 'unknown';
  if (STATUS_OK_PATTERN.test(normalized)) return 'success';
  if (STATUS_FAILED_PATTERN.test(normalized)) return 'failed';
  return 'unknown';
}

function detectWaveLayoutHints(text) {
  const normalized = normalizeText(text);
  let score = 0;
  if (/\bmontant\s+recu\b/.test(normalized)) score += 2;
  if (/\bdate\s+et\s+heure\b/.test(normalized)) score += 2;
  if (/\bid\s+de\s+transaction\b/.test(normalized)) score += 3;
  if (/\bnouveau\s+solde\b/.test(normalized)) score += 1;
  if (/\bfrais\b/.test(normalized)) score += 1;
  if (/\beffectue\b/.test(normalized) || /\beffectue\b/.test(normalized)) score += 2;
  return score;
}

/** Reçu type WAVE : la ligne « À nom + téléphone » est souvent le bénéficiaire, pas l'expéditeur du dépôt. */
function isLikelyWaveReceipt(text, method) {
  const m = String(method || '').toLowerCase();
  if (m === 'wave') return true;
  const n = normalizeText(text);
  if (n.includes('partenariat avec uba')) return true;
  return detectWaveLayoutHints(text) >= 4;
}

function compactUpperAlphaNum(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
}

function extractPhoneCandidate(text) {
  const match = String(text || '').match(/(?:\+?\d[\d\s]{7,}\d)/);
  return match ? match[0].trim().replace(/\s+/g, ' ') : '';
}

function extractSenderNameCandidate(text) {
  const source = String(text || '').replace(/\n/g, ' ');
  const match = source.match(/[ÀA]\s+([A-Za-z][A-Za-z\s.'-]{2,}?)\s+(?:\+?\d[\d\s]{7,}\d)/);
  if (!match) return '';
  return match[1].trim().replace(/\s+/g, ' ');
}

function extractTransactionIdCandidate(text) {
  const source = String(text || '');
  const merged = source.replace(/\n/g, ' ');
  const labelled = merged.match(/id\s+de\s+transaction\s*([A-Za-z0-9_\s-]{8,40})/i);
  if (labelled) return compactUpperAlphaNum(labelled[1]);
  const refs = extractReferenceCandidates(source);
  return compactUpperAlphaNum(refs[0] || '');
}

function extractReceiptAmountCandidate(text) {
  const source = normalizeText(text);
  const local = source.match(/\bmontant\s+recu\b[\s:]*([0-9][0-9\s.,]{1,})/);
  if (local) return normalizeDigits(local[1]);
  return extractAmountCandidates(text)[0] || '';
}

function detectExactAmount(text, amount) {
  const normalizedAmount = normalizeDigits(amount);
  if (!normalizedAmount) return '';

  const candidates = extractAmountCandidates(text);
  const direct = candidates.find((candidate) => candidate === normalizedAmount);
  if (direct) return direct;

  const compact = normalizeText(text).replace(/\s+/g, '');
  if (compact.includes(normalizedAmount)) return normalizedAmount;

  return '';
}

export function detectReceiptAmount(text, amount) {
  const normalizedAmount = normalizeDigits(amount);
  if (!normalizedAmount) return '';

  const candidates = extractAmountCandidates(text);
  const exact = candidates.find((candidate) => candidate === normalizedAmount);
  if (exact) return exact;

  const target = Number(normalizedAmount);
  if (!Number.isFinite(target) || target <= 0) return '';

  const receiptCandidates = candidates
    .map((candidate) => Number(candidate))
    .filter((candidate) => Number.isFinite(candidate) && candidate > 0);

  const closeCandidate = receiptCandidates.find((candidate) => {
    const delta = Math.abs(candidate - target);
    const tolerance = Math.max(5, Math.round(target * 0.05));
    return delta <= tolerance;
  });

  return closeCandidate ? String(closeCandidate) : '';
}

export function detectReceiptSender(text, senderName, transactionReference) {
  const normalizedText = normalizeText(text);
  const senderTokens = normalizeText(senderName).split(/\s+/).filter(Boolean);
  const referenceTokens = normalizeText(transactionReference).split(/\s+/).filter(Boolean);

  if (senderTokens.length > 0) {
    const senderMatch = senderTokens.every((token) => normalizedText.includes(token));
    if (senderMatch) return true;
  }

  if (referenceTokens.length > 0) {
    return referenceTokens.some((token) => normalizedText.includes(token));
  }

  return false;
}

export { detectReceiptStatus };

function pickBestDepositMatch(results) {
  return results.reduce((best, current) => {
    const currentScore = (current.confidence || 0)
      + (current.amountMatched ? 25 : 0)
      + (current.senderMatched ? 10 : 0)
      + (current.referenceMatched ? 12 : 0)
      + (current.statusMatched ? 10 : 0)
      + (current.layoutHints || 0);
    const bestScore = (best.confidence || 0)
      + (best.amountMatched ? 25 : 0)
      + (best.senderMatched ? 10 : 0)
      + (best.referenceMatched ? 12 : 0)
      + (best.statusMatched ? 10 : 0)
      + (best.layoutHints || 0);
    return currentScore > bestScore ? current : best;
  });
}

export async function analyzeDepositProof(screenshot, { senderName, amount, method, transactionReference }) {
  const imageBuffer = decodeImageDataUrl(screenshot, { minBytes: 10 * 1024, maxBytes: 750 * 1024 });
  if (!imageBuffer) {
    return {
      text: '',
      confidence: 0,
      amountCandidates: [],
      senderMatched: false,
      referenceMatched: false,
      detectedSender: '',
      detectedAmount: '',
      detectedReference: '',
      status: 'failed',
      reason: 'La capture doit être une image de preuve valide d’au moins 10 Ko.'
    };
  }

  let worker;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng');

    const variants = await buildOcrVariants(imageBuffer, 'deposit');
    const results = [];

    for (const variant of variants) {
      if (worker.setParameters) {
        await worker.setParameters({
          preserve_interword_spaces: '1',
          tessedit_pageseg_mode: '6'
        }).catch(() => {});
      }
      const recognized = await worker.recognize(variant.buffer);
      const text = recognized.data?.text || '';
      const confidence = Math.round(recognized.data?.confidence || 0);
      const amountCandidates = extractAmountCandidates(text);
      const amountMatched = Boolean(detectReceiptAmount(text, amount));
      const senderMatched = detectNamesFromText(text, [senderName]).length > 0 || detectReceiptSender(text, senderName, transactionReference);
      const referenceCandidates = extractReferenceCandidates(text);
      const statusDetected = detectReceiptStatus(text);
      const statusMatched = statusDetected === 'success';
      const layoutHints = detectWaveLayoutHints(text);
      const referenceMatched = Boolean(transactionReference)
        ? referenceCandidates.some((candidate) => normalizeText(candidate).includes(normalizeText(transactionReference)) || normalizeText(transactionReference).includes(normalizeText(candidate)))
        : referenceCandidates.length > 0;
      results.push({
        name: variant.name,
        text,
        confidence,
        amountCandidates,
        amountMatched,
        senderMatched,
        referenceCandidates,
        referenceMatched,
        statusDetected,
        statusMatched,
        layoutHints
      });
    }

    const best = pickBestDepositMatch(results);
    const detectedSender = best.senderMatched ? senderName : '';
    const matchingAmount = detectReceiptAmount(best.text, amount);
    const detectedReference = transactionReference
      ? best.referenceCandidates.find((candidate) => normalizeText(candidate).includes(normalizeText(transactionReference)) || normalizeText(transactionReference).includes(normalizeText(candidate))) || ''
      : best.referenceCandidates[0] || '';
    const referenceMatched = best.referenceMatched || Boolean(detectedReference);
    const statusDetected = best.statusDetected || 'unknown';
    const confidence = best.confidence;

    let status = 'needs_review';
    let reason = 'Analyse OCR partielle : vérification manuelle requise.';
    if (confidence >= RECEIPT_OCR_MIN_CONFIDENCE && statusDetected === 'success' && (detectedSender || matchingAmount) && (matchingAmount || referenceMatched)) {
      status = 'matched';
      reason = 'Les éléments lus sur le reçu sont cohérents pour une validation automatique.';
    } else if (confidence >= DEPOSIT_OCR_MIN_CONFIDENCE && statusDetected === 'success' && detectedSender && matchingAmount) {
      status = 'matched';
      reason = 'Nom, montant et statut « effectué » concordent avec le reçu.';
    } else if (confidence < DEPOSIT_OCR_MIN_CONFIDENCE && (detectedSender || matchingAmount || referenceMatched)) {
      reason = 'Lecture OCR partielle : l’équipe doit confirmer la preuve.';
    } else if (!detectedSender && !matchingAmount && !referenceMatched && statusDetected !== 'success') {
      status = 'failed';
      reason = 'Impossible de relier la capture au dépôt (nom, montant ou référence).';
    }

    return {
      text: best.text,
      confidence,
      amountCandidates: best.amountCandidates,
      senderMatched: Boolean(detectedSender),
      referenceMatched,
      detectedSender,
      detectedAmount: matchingAmount || best.amountCandidates[0] || '',
      detectedReference,
      detectedMethod: method || '',
      detectedStatus: statusDetected,
      status,
      reason,
      variants: results.map((item) => ({
        name: item.name,
        confidence: item.confidence,
        amountCandidates: item.amountCandidates,
        referenceCandidates: item.referenceCandidates || [],
        statusDetected: item.statusDetected || 'unknown',
        layoutHints: item.layoutHints || 0
      }))
    };
  } catch (error) {
    return {
      text: '',
      confidence: 0,
      amountCandidates: [],
      senderMatched: false,
      referenceMatched: false,
      detectedSender: '',
      detectedAmount: '',
      detectedReference: '',
      status: 'failed',
      reason: process.env.NODE_ENV === 'production'
        ? 'Analyse OCR impossible. Vérification manuelle nécessaire.'
        : error.message
    };
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}

export async function analyzeDepositPrefill(screenshot, { method = '' } = {}) {
  const imageBuffer = decodeImageDataUrl(screenshot, { minBytes: 10 * 1024, maxBytes: 750 * 1024 });
  if (!imageBuffer) {
    return {
      status: 'failed',
      reason: 'La capture doit être une image de preuve valide d’au moins 10 Ko.',
      fields: {},
      manualFields: []
    };
  }

  let worker;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng');
    const variants = await buildOcrVariants(imageBuffer, 'deposit');
    const results = [];

    for (const variant of variants) {
      if (worker.setParameters) {
        await worker.setParameters({
          preserve_interword_spaces: '1',
          tessedit_pageseg_mode: '6'
        }).catch(() => {});
      }
      const recognized = await worker.recognize(variant.buffer);
      const text = recognized.data?.text || '';
      const confidence = Math.round(recognized.data?.confidence || 0);
      const layoutHints = detectWaveLayoutHints(text);
      const statusDetected = detectReceiptStatus(text);
      results.push({ text, confidence, layoutHints, statusDetected });
    }

    const best = results.reduce((acc, cur) => {
      const accScore = (acc.confidence || 0) + (acc.layoutHints || 0) + (acc.statusDetected === 'success' ? 12 : 0);
      const curScore = (cur.confidence || 0) + (cur.layoutHints || 0) + (cur.statusDetected === 'success' ? 12 : 0);
      return curScore > accScore ? cur : acc;
    });

    const amount = extractReceiptAmountCandidate(best.text);
    const transactionReference = extractTransactionIdCandidate(best.text);
    const detectedMethod = method || (normalizeText(best.text).includes('partenariat avec uba') ? 'wave' : '');
    const waveLike = isLikelyWaveReceipt(best.text, detectedMethod || method);

    const senderName = waveLike ? '' : extractSenderNameCandidate(best.text);
    const senderPhone = waveLike ? '' : extractPhoneCandidate(best.text);

    return {
      status: 'ok',
      reason: 'Préremplissage OCR effectué.',
      fields: {
        method: detectedMethod,
        amount: amount ? Number(amount) : null,
        senderName,
        senderPhone,
        transactionReference,
        receiptStatus: best.statusDetected || 'unknown'
      },
      manualFields: waveLike ? ['senderPhone'] : []
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: process.env.NODE_ENV === 'production'
        ? 'Impossible d’analyser la capture pour le préremplissage.'
        : error.message,
      fields: {},
      manualFields: []
    };
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}
