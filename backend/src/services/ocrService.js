const OCR_MIN_CONFIDENCE = 85;

function foldText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeText(value) {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

export function normalizeScore(value) {
  const match = String(value || '').match(/\b(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : '';
}

export function extractScoreCandidates(text) {
  const candidates = [];
  const seen = new Set();
  const variants = [foldText(text), normalizeText(text)];
  const patterns = [
    /\b(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/g,
    /\bscore\s*(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/g,
    /\bresult(?:at)?\s*(?:final)?\s*(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/g,
    /\b(?:ft|full time|final)\s*(\d{1,2})\s*[-:\/]\s*(\d{1,2})\b/g
  ];

  for (const variant of variants) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of variant.matchAll(pattern)) {
        const score = `${Number(match[1])}-${Number(match[2])}`;
        if (!seen.has(score)) {
          seen.add(score);
          candidates.push(score);
        }
      }
    }
  }

  return candidates;
}

function detectScore(text) {
  return extractScoreCandidates(text)[0] || '';
}

export function detectPlayersFromText(text, players = []) {
  const normalizedText = normalizeText(text);
  const compact = compactText(text);

  return players
    .filter((player) => {
      const username = String(player?.username || '');
      const normalizedUsername = normalizeText(username);
      if (normalizedUsername.length < 3) return false;

      const compactUsername = compactText(username);
      if (compact.includes(compactUsername)) return true;
      if (normalizedText.includes(normalizedUsername)) return true;

      const usernameTokens = normalizedUsername.split(/\s+/).filter((token) => token.length >= 3);
      return usernameTokens.length > 0 && usernameTokens.every((token) => normalizedText.includes(token));
    })
    .map((player) => player.username);
}

function probableWinnerFromScore(score, players) {
  const normalized = normalizeScore(score);
  const match = normalized.match(/^(\d+)-(\d+)$/);
  if (!match || !players?.[0] || !players?.[1]) return null;

  const player1Score = Number(match[1]);
  const player2Score = Number(match[2]);
  if (player1Score === player2Score) return null;
  return player1Score > player2Score ? players[0]._id : players[1]._id;
}

function getValidImageBuffer(screenshot) {
  const match = String(screenshot || '').match(/^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (buffer.length < 10 * 1024) return null;

  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return isPng || isJpeg || isWebp ? buffer : null;
}

async function recognizePass(worker, imageBuffer, parameters = {}) {
  if (worker.setParameters) {
    await worker.setParameters(parameters).catch(() => {});
  }

  const result = await worker.recognize(imageBuffer);
  return {
    text: result.data?.text || '',
    confidence: Math.round(result.data?.confidence || 0)
  };
}

export async function analyzeMatchScreenshot(screenshot, players) {
  const imageBuffer = getValidImageBuffer(screenshot);
  if (!imageBuffer) {
    return {
      text: '',
      score: '',
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

    const generalPass = await recognizePass(worker, imageBuffer, {
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: '6'
    });
    const digitsPass = await recognizePass(worker, imageBuffer, {
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: '0123456789-:/scoreresultfinalft '
    });

    const combinedText = [generalPass.text, digitsPass.text].filter(Boolean).join('\n').trim();
    const scoreCandidates = extractScoreCandidates([digitsPass.text, generalPass.text].join('\n'));
    const score = scoreCandidates[0] || detectScore(combinedText);
    const playersDetected = detectPlayersFromText(combinedText, players);
    const confidence = Math.max(generalPass.confidence, digitsPass.confidence);

    return {
      text: combinedText,
      score,
      scoreCandidates,
      playersDetected,
      confidence,
      passes: {
        general: generalPass,
        digits: digitsPass
      },
      probableWinner: probableWinnerFromScore(score, players),
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

export { OCR_MIN_CONFIDENCE };
