import { AppError } from '../utils/AppError.js';
import { normalizeScore } from './ocrService.js';

function parseScoreComponent(value, fieldName) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new AppError(`Le champ ${fieldName} est requis`, 422);
  }

  if (!/^\d+$/.test(normalized)) {
    throw new AppError(`Le champ ${fieldName} doit être un nombre entier`, 422);
  }

  return Number.parseInt(normalized, 10);
}

function resolveDuelParticipantIds(duel, userId) {
  const player1Id = String(duel?.player1 || '');
  const player2Id = String(duel?.player2 || '');
  const userIdText = String(userId || '');

  if (userIdText === player1Id) {
    return {
      role: 'player1',
      submittedForPlayerId: player1Id,
      opponentPlayerId: player2Id
    };
  }

  if (userIdText === player2Id) {
    return {
      role: 'player2',
      submittedForPlayerId: player2Id,
      opponentPlayerId: player1Id
    };
  }

  throw new AppError('Vous ne faites pas partie de ce duel', 403);
}

export function buildCanonicalDuelSubmission(duel, userId, result = {}) {
  const { role, submittedForPlayerId, opponentPlayerId } = resolveDuelParticipantIds(duel, userId);
  const hasRelativeScores = result.myScore !== undefined && result.opponentScore !== undefined;
  const hasLegacyScore = String(result.score || '').trim();

  let myScore;
  let opponentScore;
  let globalScore;

  if (hasRelativeScores) {
    myScore = parseScoreComponent(result.myScore, 'mon score');
    opponentScore = parseScoreComponent(result.opponentScore, "score de l'adversaire");
    globalScore = role === 'player1'
      ? `${myScore}-${opponentScore}`
      : `${opponentScore}-${myScore}`;
  } else if (hasLegacyScore) {
    globalScore = normalizeScore(result.score);
    if (!globalScore) {
      throw new AppError('Le score du match est requis', 422);
    }
    const [leftText = '0', rightText = '0'] = globalScore.split('-');
    myScore = role === 'player1' ? Number.parseInt(leftText, 10) : Number.parseInt(rightText, 10);
    opponentScore = role === 'player1' ? Number.parseInt(rightText, 10) : Number.parseInt(leftText, 10);
  } else {
    throw new AppError('Le score du match est requis', 422);
  }

  const score = normalizeScore(globalScore);
  const [leftText = '0', rightText = '0'] = score.split('-');
  const leftScore = Number.parseInt(leftText, 10);
  const rightScore = Number.parseInt(rightText, 10);
  const isDraw = leftScore === rightScore;
  const declaredWinner = isDraw
    ? null
    : (leftScore > rightScore ? String(duel.player1) : String(duel.player2));

  return {
    role,
    score,
    myScore,
    opponentScore,
    homePlayerId: String(duel.player1),
    awayPlayerId: String(duel.player2),
    submittedForPlayerId,
    opponentPlayerId,
    declaredWinner,
    declaredWinnerType: isDraw ? 'draw' : role === 'player1' ? 'player1' : 'player2',
    isDraw
  };
}

export function compareCanonicalDuelScores(leftSubmission, rightSubmission) {
  const leftScore = normalizeScore(leftSubmission?.score || '');
  const rightScore = normalizeScore(rightSubmission?.score || '');

  if (!leftScore || !rightScore) {
    return {
      sameScore: false,
      reason: 'Score manquant'
    };
  }

  if (leftScore !== rightScore) {
    return {
      sameScore: false,
      reason: 'Scores déclarés incompatibles'
    };
  }

  const [homeText = '0', awayText = '0'] = leftScore.split('-');
  const homeScore = Number.parseInt(homeText, 10);
  const awayScore = Number.parseInt(awayText, 10);

  return {
    sameScore: true,
    reason: '',
    winnerId: homeScore === awayScore
      ? null
      : (homeScore > awayScore ? String(leftSubmission?.homePlayerId || '') : String(leftSubmission?.awayPlayerId || '')),
    isDraw: homeScore === awayScore
  };
}
