import sharp from 'sharp';
import {
  buildOcrVariants,
  decodeImageDataUrl,
  extractAmountCandidates,
  extractScoreCandidates,
  normalizeScore
} from './imageProcessing.js';
import crypto from 'crypto';
import {
  buildParsedMatchOcrResult,
  detectPlayersFromText,
  probableWinnerFromScore
} from './ocrParsingService.js';
import { decideMatchOcrOutcome } from './ocrDecisionService.js';

const OCR_MIN_CONFIDENCE = 68;
const OCR_STRONG_CONFIDENCE = 80;
const MAX_DUEL_SCREENSHOT_BYTES = 1024 * 1024;
const DUEL_BANNER_HINTS = /(fin du match|final|full\s*time|ft)/i;
const DUEL_NAME_VARIANT_BONUS = new Set(['score-top-normal', 'score-top-binary', 'score-top-zoom']);
const DUEL_OCR_EARLY_EXIT_CONF = 72;
const DUEL_OCR_EARLY_EXIT_STRONG_CONF = 80;
const DUEL_VISUAL_SIMILARITY_MIN = 0.78;

const workerPool = [];
const WORKER_POOL_SIZE = 2;
const WORKER_LANGUAGE = 'eng';

async function preprocessImage(buffer) {
  try {
    return await sharp(buffer)
      .resize(1200, null, { withoutEnlargement: true }) // Taille optimale pour Tesseract
      .grayscale() // Réduit le bruit de couleur
      .normalize() // Améliore le contraste
      .sharpen() // Accentue les bords des caractères
      .toBuffer();
  } catch (error) {
    console.error('Erreur prétraitement image:', error);
    return buffer; // Fallback sur l'original
  }
}

function calculateImageHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function calculateImageFingerprint(buffer) {
  try {
    const { data } = await sharp(buffer)
      .resize(8, 8, { fit: 'fill' })
      .grayscale()
      .normalize()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = Array.from(data);
    if (!pixels.length) return '';
    const average = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
    const bits = pixels.map((value) => (value >= average ? '1' : '0')).join('');
    return bits.match(/.{1,4}/g)?.map((chunk) => parseInt(chunk, 2).toString(16)).join('') || '';
  } catch (error) {
    console.error('Erreur calcul empreinte image:', error);
    return '';
  }
}

function fingerprintToBits(fingerprint) {
  const hex = String(fingerprint || '').trim();
  if (!hex) return '';
  return hex.split('').map((digit) => Number.parseInt(digit, 16).toString(2).padStart(4, '0')).join('');
}

function compareImageFingerprints(left, right) {
  const leftBits = fingerprintToBits(left);
  const rightBits = fingerprintToBits(right);
  if (!leftBits || !rightBits || leftBits.length !== rightBits.length) {
    return 0;
  }

  let distance = 0;
  for (let i = 0; i < leftBits.length; i += 1) {
    if (leftBits[i] !== rightBits[i]) distance += 1;
  }
  return 1 - (distance / leftBits.length);
}

async function getWorkerFromPool() {
  if (workerPool.length > 0) {
    return workerPool.pop();
  }
  const { createWorker } = await import('tesseract.js');
  return createWorker(WORKER_LANGUAGE);
}

function returnWorkerToPool(worker) {
  if (workerPool.length < WORKER_POOL_SIZE) {
    workerPool.push(worker);
  } else if (worker) {
    worker.terminate().catch(() => { });
  }
}


async function recognizeVariant(worker, imageBuffer, parameters = {}, metadata = {}) {
  if (worker.setParameters) {
    await worker.setParameters(parameters).catch(() => { });
  }

  const result = await worker.recognize(imageBuffer);
  const text = result.data?.text || '';
  const confidence = Math.round(result.data?.confidence || 0);
  return {
    variantName: metadata.variantName || 'unknown',
    text,
    confidence,
    scoreCandidates: extractScoreCandidates(text),
    amountCandidates: extractAmountCandidates(text),
    playersDetected: []
  };
}

function rankVariant(result) {
  const scoreBonus = result.scoreCandidates.length > 0 ? 35 : 0;
  const amountBonus = result.amountCandidates.length > 0 ? 12 : 0;
  const textBonus = String(result.text || '').trim().length > 40 ? 8 : 0;
  const scoreBandBonus = DUEL_NAME_VARIANT_BONUS.has(result.variantName) && result.scoreCandidates.length > 0 ? 28 : 0;
  const matchSummaryBonus = DUEL_BANNER_HINTS.test(result.text || '') ? 12 : 0;
  return result.confidence + scoreBonus + amountBonus + textBonus + scoreBandBonus + matchSummaryBonus;
}

function pickBestVariant(results) {
  return results.reduce((best, current) => (rankVariant(current) > rankVariant(best) ? current : best));
}

function pickWeightedScoreCandidate(results, combinedText) {
  const weightByScore = new Map();
  for (const result of results) {
    const base = rankVariant(result);
    for (const score of result.scoreCandidates || []) {
      const existing = weightByScore.get(score) || 0;
      const fromBanner = DUEL_NAME_VARIANT_BONUS.has(result.variantName) ? 18 : 0;
      weightByScore.set(score, existing + base + fromBanner);
    }
  }

  const combinedScores = extractScoreCandidates(combinedText);
  for (const score of combinedScores) {
    weightByScore.set(score, (weightByScore.get(score) || 0) + 20);
  }

  let bestScore = '';
  let bestWeight = -1;
  for (const [score, weight] of weightByScore.entries()) {
    if (weight > bestWeight) {
      bestScore = score;
      bestWeight = weight;
    }
  }
  return bestScore;
}

export async function analyzeMatchScreenshot(screenshot, players) {
  const imageBuffer = decodeImageDataUrl(screenshot, { minBytes: 10 * 1024, maxBytes: MAX_DUEL_SCREENSHOT_BYTES });
  if (!imageBuffer) {
    return {
      text: '',
      score: '',
      scoreCandidates: [],
      playersDetected: [],
      confidence: 0,
      probableWinner: null,
      status: 'failed',
      error: 'La capture doit être une image PNG, JPEG ou WEBP valide entre 10 Ko et 1 Mo.'
    };
  }

  const imageHash = calculateImageHash(imageBuffer);
  const imageFingerprint = await calculateImageFingerprint(imageBuffer);
  const processedBuffer = await preprocessImage(imageBuffer);

  let worker;
  let workerWasFromPool = false;
  try {
    worker = await getWorkerFromPool();
    workerWasFromPool = true;

    const variants = (await buildOcrVariants(processedBuffer, 'duel')).slice(0, 3);
    const generalResults = [];
    for (let i = 0; i < variants.length; i += 1) {
      const variant = variants[i];
      const row = await recognizeVariant(worker, variant.buffer, {
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '7'
      }, { variantName: variant.name });
      generalResults.push(row);
      const hasScore = Boolean(row.scoreCandidates?.length);
      if (hasScore && row.confidence >= DUEL_OCR_EARLY_EXIT_STRONG_CONF) break;
      if (hasScore && row.confidence >= DUEL_OCR_EARLY_EXIT_CONF && i >= 1) break;
    }

    const bestGeneral = pickBestVariant(generalResults);
    const parsed = buildParsedMatchOcrResult({ generalResults, bestGeneral, players });
    const isLowConfidence = parsed.confidence < OCR_MIN_CONFIDENCE || !parsed.score;
    const status = isLowConfidence ? 'low_confidence' : 'ok';

    return {
      text: parsed.text,
      score: parsed.score || '',
      scoreCandidates: parsed.scoreCandidates,
      playersDetected: parsed.playersDetected,
      confidence: parsed.confidence,
      probableWinner: parsed.probableWinner,
      status,
      imageHash,
      imageFingerprint,
      scoreConsensusCount: parsed.scoreConsensusCount,
      partialSuggestions: isLowConfidence ? {
        bestScore: parsed.score || parsed.scoreCandidates[0] || '',
        bestConfidence: parsed.confidence,
        fuzzyMatchedPlayers: parsed.fuzzyMatchedPlayers
      } : undefined
    };
  } catch (error) {
    return {
      text: '',
      score: '',
      scoreCandidates: [],
      playersDetected: [],
      confidence: 0,
      probableWinner: null,
      status: 'failed',
      error: error.message,
      imageHash,
      imageFingerprint,
      partialSuggestions: undefined
    };
  } finally {
    if (worker) {
      if (workerWasFromPool) {
        returnWorkerToPool(worker);
      } else {
        await worker.terminate().catch(() => { });
      }
    }
  }
}

export function shouldAutoApproveWithOcr({ duel, player1, player2 }) {
  const confidence1 = Number(duel.ocrConfidencePlayer1 || duel.resultPlayer1?.confidence || 0);
  const confidence2 = Number(duel.ocrConfidencePlayer2 || duel.resultPlayer2?.confidence || 0);
  const visualSimilarity = compareImageFingerprints(duel.resultPlayer1?.imageFingerprint, duel.resultPlayer2?.imageFingerprint);

  return decideMatchOcrOutcome({
    duel,
    player1,
    player2,
    confidence1,
    confidence2,
    visualSimilarity,
    probableWinnerFromScore
  }, {
    strongConfidence: OCR_STRONG_CONFIDENCE,
    visualSimilarityMin: DUEL_VISUAL_SIMILARITY_MIN
  });
}

export { OCR_MIN_CONFIDENCE, extractScoreCandidates, normalizeScore, compareImageFingerprints };
