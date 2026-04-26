import {
  buildOcrVariants,
  decodeImageDataUrl,
  detectNamesFromText,
  extractAmountCandidates,
  normalizeDigits,
  normalizeText
} from './imageProcessing.js';

const DEPOSIT_OCR_MIN_CONFIDENCE = 80;

function extractReferenceCandidates(text) {
  const source = normalizeText(text);
  const candidates = [];
  const seen = new Set();
  for (const match of source.matchAll(/\b([a-z0-9]{6,})\b/g)) {
    const value = match[1];
    if (value.length < 6 || seen.has(value)) continue;
    seen.add(value);
    candidates.push(value);
  }
  return candidates;
}

function pickBestDepositMatch(results) {
  return results.reduce((best, current) => {
    const currentScore = (current.confidence || 0) + (current.amountMatched ? 20 : 0) + (current.senderMatched ? 10 : 0) + (current.referenceMatched ? 5 : 0);
    const bestScore = (best.confidence || 0) + (best.amountMatched ? 20 : 0) + (best.senderMatched ? 10 : 0) + (best.referenceMatched ? 5 : 0);
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
      reason: 'Screenshot must be a valid payment proof image upload of at least 10KB'
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
      const normalizedAmount = normalizeDigits(amount);
      const amountMatched = amountCandidates.includes(normalizedAmount);
      const senderMatched = detectNamesFromText(text, [senderName]).length > 0;
      const referenceCandidates = extractReferenceCandidates(text);
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
        referenceMatched
      });
    }

    const best = pickBestDepositMatch(results);
    const detectedSender = best.senderMatched ? senderName : '';
    const normalizedAmount = normalizeDigits(amount);
    const matchingAmount = best.amountCandidates.find((candidate) => candidate === normalizedAmount) || '';
    const detectedReference = transactionReference
      ? best.referenceCandidates.find((candidate) => normalizeText(candidate).includes(normalizeText(transactionReference)) || normalizeText(transactionReference).includes(normalizeText(candidate))) || ''
      : best.referenceCandidates[0] || '';
    const referenceMatched = best.referenceMatched || Boolean(detectedReference);
    const confidence = best.confidence;

    let status = 'needs_review';
    let reason = 'Proof OCR requires manual confirmation';
    if (confidence >= DEPOSIT_OCR_MIN_CONFIDENCE && detectedSender && matchingAmount) {
      status = 'matched';
      reason = 'Sender name and amount match OCR evidence';
    } else if (confidence < DEPOSIT_OCR_MIN_CONFIDENCE && (detectedSender || matchingAmount || referenceMatched)) {
      reason = 'OCR evidence is partial and needs review';
    } else if (!detectedSender && !matchingAmount && !referenceMatched) {
      status = 'failed';
      reason = 'OCR could not match sender, amount, or reference';
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
      status,
      reason,
      variants: results.map((item) => ({
        name: item.name,
        confidence: item.confidence,
        amountCandidates: item.amountCandidates
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
      reason: error.message
    };
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}
