import {
  detectNamesFromText,
  extractAmountCandidates,
  extractScoreCandidates,
  normalizeScore
} from './imageProcessing.js';

function levenshteinDistance(a, b) {
  if (!a || !b) return a?.length || b?.length || 0;
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  return matrix[b.length][a.length];
}

export function fuzzyMatchPlayerNames(text, playerNames, threshold = 0.7) {
  const normalizedText = String(text || '').toLowerCase();
  const matched = [];
  for (const playerName of playerNames) {
    const normalizedPlayer = String(playerName || '').toLowerCase();
    if (!normalizedPlayer) continue;
    if (normalizedText.includes(normalizedPlayer)) {
      matched.push(playerName);
      continue;
    }
    const words = normalizedText.split(/\s+/);
    for (const word of words) {
      if (word.length < 3) continue;
      const distance = levenshteinDistance(normalizedPlayer, word);
      const similarity = 1 - distance / Math.max(normalizedPlayer.length, word.length);
      if (similarity >= threshold) {
        matched.push(playerName);
        break;
      }
    }
  }
  return matched;
}

export function probableWinnerFromScore(score, players) {
  const normalized = normalizeScore(score);
  const match = normalized.match(/^(\d+)-(\d+)$/);
  if (!match || !players?.[0] || !players?.[1]) return null;

  const player1Score = Number(match[1]);
  const player2Score = Number(match[2]);
  if (player1Score === player2Score) return null;
  return player1Score > player2Score ? players[0]._id : players[1]._id;
}

export function pickConsensusScoreCandidate(results) {
  const votes = new Map();
  for (const result of results) {
    for (const score of result.scoreCandidates || []) {
      const normalized = normalizeScore(score);
      if (!normalized) continue;
      const current = votes.get(normalized) || { count: 0, confidence: 0 };
      votes.set(normalized, {
        count: current.count + 1,
        confidence: Math.max(current.confidence, result.confidence || 0)
      });
    }
  }

  let score = '';
  let count = 0;
  let confidence = 0;
  for (const [candidate, vote] of votes.entries()) {
    if (vote.count > count || (vote.count === count && vote.confidence > confidence)) {
      score = candidate;
      count = vote.count;
      confidence = vote.confidence;
    }
  }

  return { score, count, confidence };
}

export function buildParsedMatchOcrResult({ generalResults, bestGeneral, players }) {
  const combinedText = generalResults.map((item) => item.text).filter(Boolean).join('\n').trim();
  const consensus = pickConsensusScoreCandidate(generalResults);
  const combinedScoreCandidates = Array.from(new Set(generalResults.flatMap((result) => result.scoreCandidates || [])));
  const score = consensus.score || combinedScoreCandidates[0] || extractScoreCandidates(combinedText)[0] || '';
  const confidence = Math.max(bestGeneral.confidence, consensus.confidence);
  const playerNames = players.map((player) => player.efootballUsername || player.username);
  const strictDetected = detectNamesFromText(combinedText, playerNames);
  const fuzzyDetected = fuzzyMatchPlayerNames(combinedText, playerNames);
  const playersDetected = strictDetected.length > 0 ? strictDetected : fuzzyDetected;

  return {
    text: combinedText,
    score,
    scoreCandidates: combinedScoreCandidates,
    confidence,
    playersDetected,
    probableWinner: probableWinnerFromScore(score, players),
    scoreConsensusCount: consensus.count,
    amountCandidates: extractAmountCandidates(combinedText),
    fuzzyMatchedPlayers: fuzzyDetected
  };
}

export function detectPlayersFromText(text, players = []) {
  const playerNames = players.map((player) => player.username);
  const strictDetected = detectNamesFromText(text, playerNames);
  if (strictDetected.length > 0) return strictDetected;
  return fuzzyMatchPlayerNames(text, playerNames);
}
