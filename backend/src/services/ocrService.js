import {
  buildOcrVariants,
  decodeImageDataUrl,
  detectNamesFromText,
  extractAmountCandidates,
  extractScoreCandidates,
  normalizeScore
} from './imageProcessing.js';

const OCR_MIN_CONFIDENCE = 85;

function probableWinnerFromScore(score, players) {
  const normalized = normalizeScore(score);
  const match = normalized.match(/^(\d+)-(\d+)$/);
  if (!match || !players?.[0] || !players?.[1]) return null;

  const player1Score = Number(match[1]);
  const player2Score = Number(match[2]);
  if (player1Score === player2Score) return null;
  return player1Score > player2Score ? players[0]._id : players[1]._id;
}

async function recognizeVariant(worker, imageBuffer, parameters = {}) {
  if (worker.setParameters) {
    await worker.setParameters(parameters).catch(() => {});
  }

  const result = await worker.recognize(imageBuffer);
  const text = result.data?.text || '';
  const confidence = Math.round(result.data?.confidence || 0);
  return {
    text,
    confidence,
    scoreCandidates: extractScoreCandidates(text),
    amountCandidates: extractAmountCandidates(text),
    playersDetected: []
  };
}

function rankVariant(result) {
  const scoreBonus = result.scoreCandidates.length > 0 ? 20 : 0;
  const amountBonus = result.amountCandidates.length > 0 ? 10 : 0;
  return result.confidence + scoreBonus + amountBonus;
}

function pickBestVariant(results) {
  return results.reduce((best, current) => (rankVariant(current) > rankVariant(best) ? current : best));
}

export async function analyzeMatchScreenshot(screenshot, players) {
  const imageBuffer = decodeImageDataUrl(screenshot, { minBytes: 10 * 1024 });
  if (!imageBuffer) {
    return {
      text: '',
      score: '',
      scoreCandidates: [],
      playersDetected: [],
      confidence: 0,
      probableWinner: null,
      status: 'failed',
      error: 'Screenshot must be a valid match image upload of at least 10KB'
    };
  }

  let worker;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng');

    const variants = await buildOcrVariants(imageBuffer, 'duel');
    const generalResults = [];
    for (const variant of variants) {
      generalResults.push(await recognizeVariant(worker, variant.buffer, {
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '6'
      }));
    }

    const bestGeneral = pickBestVariant(generalResults);
    const bestVariant = variants[generalResults.indexOf(bestGeneral)] || variants[0];
    const digitsResult = await recognizeVariant(worker, bestVariant.buffer, {
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: '0123456789-:/scoreresultfinalft '
    });

    const combinedText = [bestGeneral.text, digitsResult.text].filter(Boolean).join('\n').trim();
    const combinedScoreCandidates = Array.from(new Set([
      ...(bestGeneral.scoreCandidates || []),
      ...(digitsResult.scoreCandidates || [])
    ]));
    const score = combinedScoreCandidates[0] || extractScoreCandidates(combinedText)[0] || '';
    const playersDetected = detectNamesFromText(combinedText, players.map((player) => player.username));
    const confidence = Math.max(bestGeneral.confidence, digitsResult.confidence);
    const probableWinner = probableWinnerFromScore(score, players);

    return {
      text: combinedText,
      score,
      scoreCandidates: combinedScoreCandidates,
      playersDetected,
      confidence,
      probableWinner,
      status: confidence >= OCR_MIN_CONFIDENCE && Boolean(score) ? 'ok' : 'low_confidence'
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
      error: error.message
    };
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}

export function shouldAutoApproveWithOcr({ duel, player1, player2 }) {
  const sameWinner = String(duel.resultPlayer1?.declaredWinner) === String(duel.resultPlayer2?.declaredWinner);
  const sameScore = normalizeScore(duel.resultPlayer1?.score) === normalizeScore(duel.resultPlayer2?.score);
  if (!sameWinner || !sameScore) return { approved: false, reason: 'Declared results do not match' };

  const declaredScore = normalizeScore(duel.resultPlayer1.score);
  const confidenceOk = duel.ocrConfidencePlayer1 >= OCR_MIN_CONFIDENCE && duel.ocrConfidencePlayer2 >= OCR_MIN_CONFIDENCE;
  if (!confidenceOk) return { approved: false, reason: 'OCR confidence below 85%' };

  const ocrScoresMatch = normalizeScore(duel.ocrScorePlayer1) === declaredScore && normalizeScore(duel.ocrScorePlayer2) === declaredScore;
  if (!ocrScoresMatch) return { approved: false, reason: 'OCR score does not match declared score' };

  const playerNames = [player1.username, player2.username];
  const bothScreenshotsContainPlayers = [duel.ocrPlayersDetectedPlayer1, duel.ocrPlayersDetectedPlayer2].every((detected) =>
    playerNames.every((name) => detected.includes(name))
  );
  if (!bothScreenshotsContainPlayers) return { approved: false, reason: 'OCR did not detect both player usernames' };

  const winnerMatchesOcr = [duel.ocrScorePlayer1, duel.ocrScorePlayer2].every((score) =>
    String(probableWinnerFromScore(score, [player1, player2])) === String(duel.resultPlayer1.declaredWinner)
  );
  if (!winnerMatchesOcr) return { approved: false, reason: 'OCR probable winner does not match declared winner' };

  return { approved: true, reason: 'Declared results and OCR match with high confidence' };
}

export function detectPlayersFromText(text, players = []) {
  return detectNamesFromText(text, players.map((player) => player.username));
}

export { OCR_MIN_CONFIDENCE, extractScoreCandidates, normalizeScore };
