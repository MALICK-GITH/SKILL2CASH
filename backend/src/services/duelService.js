import mongoose from 'mongoose';
import { Challenge } from '../models/Challenge.js';
import { Duel } from '../models/Duel.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { calculateCommission, getCommissionRate } from './commissionService.js';
import { notifyAdmins, notifyRoom, notifyUser } from './notificationService.js';
import { notifyDuelWon, notifyDuelLost } from '../bot/telegramBot.js';
import {
  notifyProofSubmitted,
  notifyProofReceived,
  notifyOcrProcessing,
  notifyDuelResult,
  notifyDispute
} from '../utils/telegramNotify.js';
import { analyzeMatchScreenshot, shouldAutoApproveWithOcr } from './ocrService.js';
import { badgeForUser, rankForUser } from './rankService.js';
import { lockStake, refundStake, settleDuelWallets, createTransaction } from './walletService.js';
import { logCriticalAction, logError } from './auditLogService.js';
import { enqueueDuelOcrJob } from '../queues/duelOcrQueue.js';
import { buildCanonicalDuelSubmission, compareCanonicalDuelScores } from './ocrMatchService.js';

function validateDuelProofPayload(result) {
  const screenshot = String(result?.screenshot || '');
  const score = String(result?.score || '').trim();

  // Validation simplifiée : un seul chiffre (0-99)
  if (!score) throw new AppError('Ton score est requis (ex: 3)', 422);
  if (!/^\d{1,2}$/.test(score)) {
    throw new AppError('Le score doit être un nombre entre 0 et 99 (ex: 3)', 422);
  }

  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(screenshot)) {
    throw new AppError('La preuve de match doit être une image PNG, JPEG ou WEBP', 422);
  }
}

async function runTransactionWithRetry(operation) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => operation(session));
  } finally {
    await session.endSession();
  }
}

// ============================================
// NOUVEAU: Système de validation robuste des scores
// ============================================

/**
 * Valide la cohérence des scores soumis par les deux joueurs
 * @param {Object} player1 - { myScore, opponentScore, winnerChoice, id }
 * @param {Object} player2 - { myScore, opponentScore, winnerChoice, id }
 * @returns {Object} Résultat de validation avec confiance et détection de fraude
 */
export function validateScoreSubmission(player1, player2) {
  const result = {
    isValid: false,
    confidence: 0,        // 0-100% niveau de confiance
    winnerId: null,       // ID du gagnant déterminé
    isDraw: false,        // Match nul ?
    fraudDetected: false, // Triche détectée ?
    fraudReason: null,    // Raison de la fraude
    badActor: null,       // Qui a triché ?
    details: {}           // Détails de l'analyse
  };

  // 1. EXTRACTION ET NORMALISATION DES SCORES
  const p1 = {
    id: player1.id,
    myScore: parseInt(player1.myScore, 10),
    oppScore: parseInt(player1.opponentScore, 10),
    declaredWinner: player1.winnerChoice
  };

  const p2 = {
    id: player2.id,
    myScore: parseInt(player2.myScore, 10),
    oppScore: parseInt(player2.opponentScore, 10),
    declaredWinner: player2.winnerChoice
  };

  // 2. VALIDATION DE BASE
  if (!isValidScore(p1.myScore) || !isValidScore(p2.myScore) ||
    !isValidScore(p1.oppScore) || !isValidScore(p2.oppScore)) {
    return {
      ...result,
      fraudDetected: true,
      fraudReason: 'Score invalide (doit être 0-99)',
      details: { p1, p2 }
    };
  }

  // 3. VALIDATION CROISÉE CRUCIALE
  // Player1.myScore doit == Player2.oppScore (ce que P2 voit)
  // Player1.oppScore doit == Player2.myScore (ce que P1 voit)

  const scoresAligned = (
    p1.myScore === p2.oppScore &&
    p1.oppScore === p2.myScore
  );

  if (!scoresAligned) {
    return {
      ...result,
      fraudDetected: true,
      fraudReason: 'Scores non cohérents entre joueurs',
      details: {
        player1Claims: `${p1.myScore}-${p1.oppScore}`,
        player2Claims: `${p2.myScore}-${p2.oppScore}`,
        conflict: 'Les scores déclarés ne correspondent pas',
        expectedP2OppScore: p1.myScore,
        actualP2OppScore: p2.oppScore,
        expectedP2MyScore: p1.oppScore,
        actualP2MyScore: p2.myScore
      }
    };
  }

  // 4. DÉTERMINATION DU GAGNANT BASÉE SUR LES SCORES
  const actualWinner = p1.myScore > p1.oppScore ? 'player1' :
    p1.myScore < p1.oppScore ? 'player2' :
      'draw';

  // 5. VÉRIFICATION COHÉRENCE DÉCLARATION DE VICTOIRE
  const p1DeclaredCorrectly = (
    (actualWinner === 'player1' && p1.declaredWinner === 'won') ||
    (actualWinner === 'player2' && p1.declaredWinner === 'lost') ||
    (actualWinner === 'draw' && p1.declaredWinner === 'draw')
  );

  const p2DeclaredCorrectly = (
    (actualWinner === 'player2' && p2.declaredWinner === 'won') ||
    (actualWinner === 'player1' && p2.declaredWinner === 'lost') ||
    (actualWinner === 'draw' && p2.declaredWinner === 'draw')
  );

  // 6. SYSTÈME DE CONFIANCE (0-100%)
  let confidence = 0;

  if (scoresAligned) confidence += 40;           // Scores cohérents
  if (p1DeclaredCorrectly) confidence += 30;     // P1 honnête
  if (p2DeclaredCorrectly) confidence += 30;     // P2 honnête

  // 7. DÉTECTION DE FRAUDE AVANCÉE
  if (!p1DeclaredCorrectly || !p2DeclaredCorrectly) {
    result.fraudDetected = true;
    result.fraudReason = 'Incohérence déclaration victoire/défaite';
    result.badActor = !p1DeclaredCorrectly ? p1.id : p2.id;

    // Réduction de confiance si fraude détectée
    confidence = Math.max(0, confidence - 50);
  }

  // 8. DÉTERMINATION DU WINNER ID
  let winnerId = null;
  if (actualWinner === 'player1') {
    winnerId = p1.id;
  } else if (actualWinner === 'player2') {
    winnerId = p2.id;
  }
  // Si draw, winnerId reste null

  // 9. RÉSULTAT FINAL
  return {
    isValid: confidence >= 70,        // Minimum 70% confiance pour validation auto
    confidence,
    winnerId,
    isDraw: actualWinner === 'draw',
    fraudDetected: result.fraudDetected,
    fraudReason: result.fraudReason,
    badActor: result.badActor,
    finalScore: `${p1.myScore}-${p1.oppScore}`,
    details: {
      scoresAligned,
      p1DeclarationCorrect: p1DeclaredCorrectly,
      p2DeclarationCorrect: p2DeclaredCorrectly,
      actualWinner,
      p1DeclaredWinner: p1.declaredWinner,
      p2DeclaredWinner: p2.declaredWinner
    }
  };
}

function isValidScore(score) {
  return Number.isInteger(score) && score >= 0 && score <= 99;
}

function validateDuelProofPayloadV2(result) {
  // Validation simplifiée : capture optionnelle, scores requis
  const myScore = String(result?.myScore ?? '').trim();
  const opponentScore = String(result?.opponentScore ?? '').trim();
  const winnerChoice = String(result?.winnerChoice ?? result?.iWon ?? '').trim().toLowerCase();

  if (!myScore) {
    throw new AppError('Ton score est requis (ex: 3)', 422);
  }
  if (!/^\d{1,2}$/.test(myScore)) {
    throw new AppError('Ton score doit être un nombre entre 0 et 99 (ex: 3)', 422);
  }

  if (!opponentScore) {
    throw new AppError('Le score de ton adversaire est requis (ex: 1)', 422);
  }
  if (!/^\d{1,2}$/.test(opponentScore)) {
    throw new AppError('Le score adversaire doit être un nombre entre 0 et 99', 422);
  }

  // Validation du choix victoire/défaite
  const validChoices = ['won', 'win', 'victory', 'victoire', 'gagne', 'true', '1',
    'lost', 'lose', 'defeat', 'defaite', 'perdu', 'false', '0'];
  if (!winnerChoice || !validChoices.includes(winnerChoice)) {
    throw new AppError('Tu dois indiquer si tu as gagné ou perdu', 422);
  }
}

function isDrawWinnerId(winnerId) {
  return winnerId === null || winnerId === undefined || String(winnerId).toLowerCase() === 'draw';
}

function resolveDeclaredWinnerFromValue(duel, winnerValue) {
  if (isDrawWinnerId(winnerValue)) {
    return { declaredWinner: 'draw', declaredWinnerUserId: null };
  }
  const normalized = winnerValue ? String(winnerValue) : '';
  if (normalized && String(duel?.player1) === normalized) {
    return { declaredWinner: 'player1', declaredWinnerUserId: normalized };
  }
  if (normalized && String(duel?.player2) === normalized) {
    return { declaredWinner: 'player2', declaredWinnerUserId: normalized };
  }
  return { declaredWinner: 'unknown', declaredWinnerUserId: null };
}

function buildDuelEventPayload(duel, extra = {}) {
  const bothProofsSubmitted = Boolean(duel?.resultPlayer1 && duel?.resultPlayer2);
  const winner = duel?.winner ? String(duel.winner) : null;
  const winnerShape = duel?.isDraw
    ? { declaredWinner: 'draw', declaredWinnerUserId: null }
    : winner
      ? resolveDeclaredWinnerFromValue(duel, winner)
      : { declaredWinner: 'unknown', declaredWinnerUserId: null };

  return {
    duelId: duel?._id,
    roomId: duel?.roomId,
    bothProofsSubmitted,
    declaredWinner: winnerShape.declaredWinner,
    declaredWinnerUserId: winnerShape.declaredWinnerUserId,
    ...extra
  };
}

async function dispatchEvents(events = []) {
  for (const event of events) {
    if (event.target === 'user') {
      await notifyUser(event.userId, event.name, event.payload);
    } else if (event.target === 'room') {
      await notifyRoom(event.roomId, event.name, event.payload);
    } else if (event.target === 'admin') {
      await notifyAdmins(event.name, event.payload);
    }
  }
}

async function queueDuelOcrProcessing(duelId) {
  // Vérifier si Redis est disponible
  const redisAvailable = process.env.REDIS_URL && !process.env.DISABLE_REDIS;

  if (redisAvailable) {
    try {
      await enqueueDuelOcrJob(duelId);
      console.log(`[OCR] Job queued for duel ${duelId}`);
    } catch (error) {
      console.error(`[OCR] Queue failed, processing synchronously:`, error.message);
      // Fallback synchrone immédiat
      await processDuelOcrInBackground(duelId).catch(async (fallbackError) => {
        console.error(`[OCR] Synchronous processing failed:`, fallbackError.message);
        await logError('duel:ocr_sync_failed', null, fallbackError.message, { duelId });
      });
    }
  } else {
    // Pas de Redis, traitement synchrone immédiat
    console.log(`[OCR] Redis unavailable, processing duel ${duelId} synchronously`);
    await processDuelOcrInBackground(duelId).catch(async (error) => {
      console.error(`[OCR] Synchronous processing failed:`, error.message);
      await logError('duel:ocr_sync_failed', null, error.message, { duelId });
    });
  }
}

const DUEL_OCR_TIMEOUT_MS_NORMAL = 1 * 60 * 1000;  // 1 minute max
const DUEL_OCR_TIMEOUT_MS_HEAVY = 2 * 60 * 1000;  // 2 minutes max pour images lourdes
const HEAVY_IMAGE_THRESHOLD = 500 * 1024; // 500 KB

async function runOcrWithTimeout(screenshot, players, playerLabel) {
  // Déterminer le timeout selon la taille approximative de l'image base64
  const approximateBytes = (screenshot.length * 3) / 4;
  const timeoutMs = approximateBytes > HEAVY_IMAGE_THRESHOLD ? DUEL_OCR_TIMEOUT_MS_HEAVY : DUEL_OCR_TIMEOUT_MS_NORMAL;
  const timeoutMinutes = timeoutMs / 60000;

  const timeoutError = new AppError(`Timeout OCR: la capture ${playerLabel} dépasse ${timeoutMinutes} minutes`, 504);
  timeoutError.code = 'DUEL_OCR_TIMEOUT';
  timeoutError.playerLabel = playerLabel;

  return Promise.race([
    analyzeMatchScreenshot(screenshot, players),
    new Promise((_, reject) => {
      setTimeout(() => reject(timeoutError), timeoutMs);
    })
  ]);
}

export async function processDuelOcrInBackground(duelId) {
  const session = await mongoose.startSession();
  let postCommitEvents = [];
  try {
    await session.withTransaction(async () => {
      const duel = await Duel.findById(duelId).session(session);
      if (!duel) {
        console.log(`[OCR] Duel ${duelId} not found`);
        return;
      }
      if (!duel.resultPlayer1 || !duel.resultPlayer2) {
        console.log(`[OCR] Missing results for duel ${duelId}`);
        return;
      }
      if (['finished', 'cancelled'].includes(duel.status)) {
        console.log(`[OCR] Duel ${duelId} already finished/cancelled`);
        return;
      }

      duel.status = 'analyzing';
      await duel.save({ session });

      const [player1, player2] = await Promise.all([
        User.findById(duel.player1).select('username efootballUsername').session(session),
        User.findById(duel.player2).select('username efootballUsername').session(session)
      ]);
      if (!player1 || !player2) {
        throw new AppError('Joueurs du duel introuvables pour analyse OCR', 422);
      }

      // Simplification : utiliser les scores soumis par les joueurs directement
      // L'OCR est optionnel et utilisé uniquement pour la détection de fraude
      const skipOcr = process.env.DISABLE_OCR === '1' || process.env.NODE_ENV === 'production';
      let ocrPlayer1 = { text: '', score: '', scoreCandidates: [], playersDetected: [], confidence: 0, status: 'ok' };
      let ocrPlayer2 = { text: '', score: '', scoreCandidates: [], playersDetected: [], confidence: 0, status: 'ok' };

      if (!skipOcr) {
        try {
          [ocrPlayer1, ocrPlayer2] = await Promise.all([
            runOcrWithTimeout(duel.resultPlayer1.screenshot, [player1, player2], 'joueur 1'),
            runOcrWithTimeout(duel.resultPlayer2.screenshot, [player1, player2], 'joueur 2')
          ]);
        } catch (error) {
          console.error(`[OCR] Error processing duel ${duelId}:`, error.message);
          // En cas d'erreur OCR, on continue avec les scores soumis par les joueurs
          // Pas de blocage, pas de timeout de plusieurs jours
          ocrPlayer1.status = 'failed';
          ocrPlayer2.status = 'failed';
        }
      }

      duel.ocrTextPlayer1 = ocrPlayer1.text;
      duel.ocrScorePlayer1 = ocrPlayer1.score;
      duel.ocrScoreCandidatesPlayer1 = ocrPlayer1.scoreCandidates || [];
      duel.ocrPlayersDetectedPlayer1 = ocrPlayer1.playersDetected;
      duel.ocrConfidencePlayer1 = ocrPlayer1.confidence;

      duel.ocrTextPlayer2 = ocrPlayer2.text;
      duel.ocrScorePlayer2 = ocrPlayer2.score;
      duel.ocrScoreCandidatesPlayer2 = ocrPlayer2.scoreCandidates || [];
      duel.ocrPlayersDetectedPlayer2 = ocrPlayer2.playersDetected;
      duel.ocrConfidencePlayer2 = ocrPlayer2.confidence;

      if (ocrPlayer1.imageHash) duel.resultPlayer1.imageHash = ocrPlayer1.imageHash;
      if (ocrPlayer1.imageFingerprint) duel.resultPlayer1.imageFingerprint = ocrPlayer1.imageFingerprint;
      if (ocrPlayer2.imageHash) duel.resultPlayer2.imageHash = ocrPlayer2.imageHash;
      if (ocrPlayer2.imageFingerprint) duel.resultPlayer2.imageFingerprint = ocrPlayer2.imageFingerprint;

      // Validation simplifiée : comparer les scores soumis par les joueurs
      const score1 = parseInt(duel.resultPlayer1?.myScore || duel.resultPlayer1?.score || '0', 10);
      const score2 = parseInt(duel.resultPlayer2?.myScore || duel.resultPlayer2?.score || '0', 10);

      // Vérifier si les scores sont cohérents (le gagnant de chaque joueur doit correspondre)
      const declaredWinner1 = duel.resultPlayer1?.declaredWinner;
      const declaredWinner2 = duel.resultPlayer2?.declaredWinner;
      const scoresMatch = score1 !== score2; // Un gagnant nécessite des scores différents

      // Vérification de fraude : images identiques
      const sameImage = ocrPlayer1.imageHash && ocrPlayer2.imageHash &&
        ocrPlayer1.imageHash === ocrPlayer2.imageHash;

      if (sameImage) {
        // Fraude détectée - images identiques
        duel.status = 'dispute';
        duel.autoValidationStatus = 'failed';
        duel.autoValidationReason = 'FRAUDE : Les deux captures sont identiques';
        duel.disputeReason = duel.autoValidationReason;
        await duel.save({ session });

        const fraudPayload = buildDuelEventPayload(duel, {
          reason: duel.disputeReason,
          resolutionRequired: true,
          resolutionActions: ['cancel'],
          proofImages: {
            player1: duel.resultPlayer1?.screenshot || '',
            player2: duel.resultPlayer2?.screenshot || ''
          }
        });
        postCommitEvents.push(
          { target: 'admin', name: 'admin:dispute_pending', payload: fraudPayload },
          { target: 'user', userId: duel.player1, name: 'duel:review_required', payload: fraudPayload },
          { target: 'user', userId: duel.player2, name: 'duel:review_required', payload: fraudPayload },
          { target: 'room', roomId: duel.roomId, name: 'duel:dispute_opened', payload: fraudPayload }
        );
        return;
      }

      if (scoresMatch && declaredWinner1 && declaredWinner1 === declaredWinner2) {
        // Scores cohérents et même gagnant déclaré - auto-valider
        duel.autoValidationStatus = 'auto_approved';
        duel.autoValidationReason = `Validation auto: Score ${score1}-${score2}`;
        await duel.save({ session });

        const finished = await finishDuel(duel._id, declaredWinner1, session, postCommitEvents);
        const duelResultPayload = {
          duelId: finished._id,
          winner: finished.winner,
          loser: finished.loser
        };
        postCommitEvents.push(
          {
            target: 'room',
            roomId: finished.roomId,
            name: 'duel:result_submitted',
            payload: buildDuelEventPayload(finished, { status: finished.status })
          },
          { target: 'room', roomId: finished.roomId, name: 'duel_result', payload: duelResultPayload }
        );
        return;
      }

      // Scores incohérents ou pas de gagnant clair - litige
      duel.status = 'dispute';
      duel.autoValidationStatus = 'manual_review';
      duel.autoValidationReason = scoresMatch
        ? 'Gagnants déclarés différents'
        : 'Scores identiques (match nul non supporté)';
      duel.disputeReason = duel.autoValidationReason;
      duel.manualReviewRequestedAt = new Date();
      duel.manualReviewDueAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min pour review
      await duel.save({ session });

      const reviewPayload = buildDuelEventPayload(duel, {
        reason: duel.disputeReason,
        resolutionRequired: true,
        resolutionActions: ['winner', 'cancel'],
        proofImages: {
          player1: duel.resultPlayer1?.screenshot || '',
          player2: duel.resultPlayer2?.screenshot || ''
        }
      });
      postCommitEvents.push(
        { target: 'admin', name: 'admin:dispute_pending', payload: reviewPayload },
        { target: 'user', userId: duel.player1, name: 'duel:review_required', payload: reviewPayload },
        { target: 'user', userId: duel.player2, name: 'duel:review_required', payload: reviewPayload },
        { target: 'room', roomId: duel.roomId, name: 'duel:dispute_opened', payload: reviewPayload }
      );
    });
  } finally {
    await session.endSession();
  }
  await dispatchEvents(postCommitEvents);
}

export async function acceptChallenge(challengeId, userId) {
  try {
    const result = await runTransactionWithRetry(async (session) => {
      const now = new Date();
      const challenge = await Challenge.findById(challengeId).session(session);
      if (!challenge) throw new AppError('Défi non trouvé', 404);
      if (String(challenge.challenged) !== String(userId)) throw new AppError('Seul le joueur défié peut accepter', 403);
      if (challenge.status !== 'pending' && challenge.status !== 'counter_offer') throw new AppError('Le défi n\'est pas ouvert', 422);
      if (!challenge.expiresAt || new Date(challenge.expiresAt) <= now) {
        if (Number(challenge.reservedAmount || 0) > 0) {
          await refundStake(challenge.challenger, challenge.reservedAmount, challenge._id, session);
        }
        challenge.status = 'expired';
        await challenge.save({ session });
        return {
          expired: true,
          challengeId: challenge._id,
          challengerId: challenge.challenger,
          challengedId: challenge.challenged
        };
      }

      const acceptedAmount = challenge.status === 'counter_offer' && Number.isFinite(Number(challenge.counterAmount))
        ? Number(challenge.counterAmount)
        : Number(challenge.amount);
      if (!Number.isFinite(acceptedAmount) || acceptedAmount <= 0) {
        throw new AppError('Le montant du défi est invalide', 422);
      }

      challenge.amount = acceptedAmount;

      const reservedAmount = Number(challenge.reservedAmount || 0);
      if (reservedAmount > 0) {
        if (acceptedAmount > reservedAmount) {
          await lockStake(challenge.challenger, acceptedAmount - reservedAmount, challenge._id, session);
        } else if (acceptedAmount < reservedAmount) {
          await refundStake(challenge.challenger, reservedAmount - acceptedAmount, challenge._id, session);
        }
      } else {
        await lockStake(challenge.challenger, acceptedAmount, challenge._id, session);
      }
      await lockStake(challenge.challenged, acceptedAmount, challenge._id, session);

      const potTotal = acceptedAmount * 2;
      const commissionRate = await getCommissionRate(acceptedAmount);
      const { commissionAmount, winnerAmount } = calculateCommission(potTotal, commissionRate);
      const roomId = `s2c-${challenge._id.toString().slice(-8)}-${Date.now().toString(36)}`;

      const duel = await Duel.create(
        [
          {
            challenge: challenge._id,
            player1: challenge.challenger,
            player2: challenge.challenged,
            amount: acceptedAmount,
            potTotal,
            commissionRate,
            commissionAmount,
            winnerAmount,
            rules: challenge.rules,
            matchType: challenge.matchType,
            roomId
          }
        ],
        { session }
      ).then((docs) => docs[0]);

      challenge.status = 'accepted';
      await challenge.save({ session });

      await logCriticalAction('duel:challenge_accepted', userId, {
        challengeId: challenge._id,
        duelId: duel._id,
        amount: acceptedAmount
      });

      return {
        duel,
        challengeId: challenge._id,
        challengerId: challenge.challenger,
        challengedId: challenge.challenged,
        acceptedAmount,
        roomId
      };
    });

    if (result?.expired) {
      const payload = { challengeId: result.challengeId };
      await dispatchEvents([
        { target: 'user', userId: result.challengerId, name: 'challenge:expired', payload },
        { target: 'user', userId: result.challengedId, name: 'challenge:expired', payload }
      ]);
      throw new AppError('Défi expiré', 422);
    }

    const duelPayload = buildDuelEventPayload(result.duel);
    await dispatchEvents([
      {
        target: 'user',
        userId: result.challengerId,
        name: 'duel:stake_locked',
        payload: { ...duelPayload, amount: result.acceptedAmount }
      },
      {
        target: 'user',
        userId: result.challengedId,
        name: 'duel:stake_locked',
        payload: { ...duelPayload, amount: result.acceptedAmount }
      },
      {
        target: 'user',
        userId: result.challengerId,
        name: 'challenge:accepted',
        payload: { ...duelPayload, challengeId: result.challengeId }
      },
      {
        target: 'user',
        userId: result.challengerId,
        name: 'duel:room_created',
        payload: { ...duelPayload, link: `/duels/${result.duel._id}` }
      },
      {
        target: 'user',
        userId: result.challengedId,
        name: 'duel:room_created',
        payload: { ...duelPayload, link: `/duels/${result.duel._id}` }
      },
      {
        target: 'admin',
        name: 'admin:duel_room_created',
        payload: {
          ...duelPayload,
          challengeId: result.challengeId,
          amount: result.acceptedAmount
        }
      }
    ]);
    return result.duel;
  } catch (error) {
    await logError('duel:challenge_accepted', userId, error.message, { challengeId });
    throw error;
  }
}

export async function cancelDuel(duelId, reason = 'Duel cancelled by admin') {
  const session = await mongoose.startSession();
  try {
    const duel = await session.withTransaction(async () => {
      const duel = await Duel.findById(duelId).session(session);
      if (!duel) throw new AppError('Duel non trouvé', 404);
      if (duel.status === 'finished' || duel.status === 'cancelled') throw new AppError('Duel déjà terminé', 422);

      await refundStake(duel.player1, duel.amount, duel._id, session);
      await refundStake(duel.player2, duel.amount, duel._id, session);
      duel.status = 'cancelled';
      duel.disputeReason = reason;
      duel.finishedAt = new Date();
      await duel.save({ session });
      return duel;
    });
    await dispatchEvents([
      {
        target: 'room',
        roomId: duel.roomId,
        name: 'duel:cancelled',
        payload: buildDuelEventPayload(duel, { reason })
      }
    ]);
    return duel;
  } finally {
    await session.endSession();
  }
}

export async function cancelDuelNoRefund(duelId, reason = 'Duel cancelled by admin - stakes retained') {
  const session = await mongoose.startSession();
  try {
    const duel = await session.withTransaction(async () => {
      const duel = await Duel.findById(duelId).session(session);
      if (!duel) throw new AppError('Duel non trouvé', 404);
      if (duel.status === 'finished' || duel.status === 'cancelled') throw new AppError('Duel déjà terminé', 422);

      // Get platform wallet to receive stakes
      const platformWallet = await Wallet.findOne({ user: 'platform' }).session(session);
      if (!platformWallet) throw new AppError('Portefeuille plateforme non trouvé', 500);

      // Release locked stakes from both players (but don't refund to available)
      const player1Wallet = await Wallet.findOne({ user: duel.player1 }).session(session);
      const player2Wallet = await Wallet.findOne({ user: duel.player2 }).session(session);

      if (player1Wallet) {
        player1Wallet.balanceLocked = Math.max(player1Wallet.balanceLocked - duel.amount, 0);
        player1Wallet.balanceTotal = player1Wallet.balanceAvailable + player1Wallet.balanceLocked;
        await player1Wallet.save({ session });
      }

      if (player2Wallet) {
        player2Wallet.balanceLocked = Math.max(player2Wallet.balanceLocked - duel.amount, 0);
        player2Wallet.balanceTotal = player2Wallet.balanceAvailable + player2Wallet.balanceLocked;
        await player2Wallet.save({ session });
      }

      // Add stakes to platform wallet
      const totalStakes = duel.amount * 2;
      platformWallet.balanceAvailable += totalStakes;
      platformWallet.balanceTotal = platformWallet.balanceAvailable + platformWallet.balanceLocked;
      await platformWallet.save({ session });

      // Create transaction records for the stakes transfer
      await createTransaction(
        { user: duel.player1, type: 'duel_loss', amount: duel.amount, referenceId: duel._id, description: 'Mise perdue - duel annulé sans remboursement' },
        session
      );
      await createTransaction(
        { user: duel.player2, type: 'duel_loss', amount: duel.amount, referenceId: duel._id, description: 'Mise perdue - duel annulé sans remboursement' },
        session
      );
      await createTransaction(
        { type: 'platform_revenue', amount: totalStakes, referenceId: duel._id, description: `Mises retenues - duel annulé (${reason})` },
        session
      );

      duel.status = 'cancelled';
      duel.disputeReason = reason;
      duel.finishedAt = new Date();
      await duel.save({ session });
      return duel;
    });
    await dispatchEvents([
      {
        target: 'room',
        roomId: duel.roomId,
        name: 'duel:cancelled',
        payload: buildDuelEventPayload(duel, { reason, stakesRetained: true })
      },
      {
        target: 'user',
        userId: duel.player1,
        name: 'duel:cancelled_no_refund',
        payload: buildDuelEventPayload(duel, { reason, stakesRetained: true, amountLost: duel.amount })
      },
      {
        target: 'user',
        userId: duel.player2,
        name: 'duel:cancelled_no_refund',
        payload: buildDuelEventPayload(duel, { reason, stakesRetained: true, amountLost: duel.amount })
      }
    ]);
    return duel;
  } finally {
    await session.endSession();
  }
}

export async function submitResult(duelId, userId, result) {
  const session = await mongoose.startSession();
  try {
    let triggerBackgroundOcr = false;
    const outcome = await session.withTransaction(async () => {
      validateDuelProofPayload(result);
      const duel = await Duel.findById(duelId).session(session);
      if (!duel) throw new AppError('Duel non trouvé', 404);
      if (!['active', 'waiting_player1_proof', 'waiting_player2_proof', 'analyzing', 'waiting_result', 'under_review', 'dispute'].includes(duel.status)) {
        throw new AppError('Duel fermé', 422);
      }

      const isPlayer1 = String(duel.player1) === String(userId);
      const isPlayer2 = String(duel.player2) === String(userId);
      if (!isPlayer1 && !isPlayer2) throw new AppError('Vous ne faites pas partie de ce duel', 403);

      const payload = {
        score: result.score,
        declaredWinner: result.declaredWinner,
        screenshot: result.screenshot,
        comment: result.comment || ''
      };

      if ((isPlayer1 && duel.resultPlayer1) || (isPlayer2 && duel.resultPlayer2)) {
        throw new AppError('Votre preuve a déjà été soumise', 422);
      }

      if (isPlayer1) duel.resultPlayer1 = payload;
      if (isPlayer2) duel.resultPlayer2 = payload;
      duel.status = duel.resultPlayer1 && duel.resultPlayer2
        ? 'analyzing'
        : isPlayer1
          ? 'waiting_player2_proof'
          : 'waiting_player1_proof';
      duel.autoValidationStatus = 'pending';
      duel.autoValidationReason = '';
      const postCommitEvents = [];

      if (duel.resultPlayer1 && !duel.resultPlayer2) {
        const declaredShape = resolveDeclaredWinnerFromValue(duel, duel.resultPlayer1?.declaredWinner);
        const payloadBase = buildDuelEventPayload(duel, {
          proofBy: duel.player1,
          proofRole: 'player1',
          ...declaredShape
        });
        postCommitEvents.push(
          { target: 'user', userId: duel.player1, name: 'duel:proof_submitted', payload: payloadBase },
          { target: 'user', userId: duel.player1, name: 'duel:processing', payload: payloadBase },
          { target: 'user', userId: duel.player2, name: 'duel:proof_received', payload: payloadBase },
          { target: 'user', userId: duel.player1, name: 'duel:result_pending', payload: payloadBase }
        );
        // Notification Telegram
        const [player1, player2] = await Promise.all([
          User.findById(duel.player1),
          User.findById(duel.player2)
        ]);
        if (player1 && player2) {
          await notifyProofSubmitted(duel.player1, duel, player2);
          await notifyProofReceived(duel.player2, duel, player1);
        }
      }
      if (duel.resultPlayer2 && !duel.resultPlayer1) {
        const declaredShape = resolveDeclaredWinnerFromValue(duel, duel.resultPlayer2?.declaredWinner);
        const payloadBase = buildDuelEventPayload(duel, {
          proofBy: duel.player2,
          proofRole: 'player2',
          ...declaredShape
        });
        postCommitEvents.push(
          { target: 'user', userId: duel.player2, name: 'duel:proof_submitted', payload: payloadBase },
          { target: 'user', userId: duel.player2, name: 'duel:processing', payload: payloadBase },
          { target: 'user', userId: duel.player1, name: 'duel:proof_received', payload: payloadBase },
          { target: 'user', userId: duel.player2, name: 'duel:result_pending', payload: payloadBase }
        );
        // Notification Telegram
        const [player1, player2] = await Promise.all([
          User.findById(duel.player1),
          User.findById(duel.player2)
        ]);
        if (player1 && player2) {
          await notifyProofSubmitted(duel.player2, duel, player1);
          await notifyProofReceived(duel.player1, duel, player2);
        }
      }

      if (duel.resultPlayer1 && duel.resultPlayer2) {
        const declaredShape = resolveDeclaredWinnerFromValue(duel, duel.resultPlayer1?.declaredWinner);
        const payloadBase = buildDuelEventPayload(duel, {
          ...declaredShape,
          reason: 'Les 2 preuves sont reçues. Validation manuelle admin disponible.',
          resolutionRequired: true,
          resolutionActions: ['winner', 'cancel'],
          proofImages: {
            player1: duel.resultPlayer1?.screenshot || '',
            player2: duel.resultPlayer2?.screenshot || ''
          }
        });
        postCommitEvents.push(
          { target: 'user', userId: duel.player1, name: 'duel:processing', payload: payloadBase },
          { target: 'user', userId: duel.player2, name: 'duel:processing', payload: payloadBase },
          { target: 'user', userId: duel.player1, name: 'duel:analysis_started', payload: payloadBase },
          { target: 'user', userId: duel.player2, name: 'duel:analysis_started', payload: payloadBase },
          { target: 'room', roomId: duel.roomId, name: 'proof_submitted', payload: { userId } }
        );
        triggerBackgroundOcr = true;

        // Notification Telegram OCR en cours
        await notifyOcrProcessing([duel.player1, duel.player2], duel);
      }

      await duel.save({ session });
      postCommitEvents.push({
        target: 'room',
        roomId: duel.roomId,
        name: 'duel:result_submitted',
        payload: buildDuelEventPayload(duel, { status: duel.status })
      });
      if (duel.status === 'dispute') {
        postCommitEvents.push({
          target: 'room',
          roomId: duel.roomId,
          name: 'duel:dispute_opened',
          payload: buildDuelEventPayload(duel)
        });
      }
      return { duel, postCommitEvents };
    });
    await dispatchEvents(outcome.postCommitEvents);
    if (triggerBackgroundOcr) {
      await queueDuelOcrProcessing(outcome.duel._id);
    }
    return outcome.duel;
  } finally {
    await session.endSession();
  }
}

export async function submitRelativeResult(duelId, userId, result) {
  const session = await mongoose.startSession();
  try {
    let triggerBackgroundOcr = false;
    const outcome = await session.withTransaction(async () => {
      validateDuelProofPayloadV2(result);
      const duel = await Duel.findById(duelId).session(session);
      if (!duel) throw new AppError('Duel non trouvé', 404);
      if (!['active', 'waiting_player1_proof', 'waiting_player2_proof', 'analyzing', 'waiting_result', 'under_review', 'dispute'].includes(duel.status)) {
        throw new AppError('Duel fermé', 422);
      }

      const isPlayer1 = String(duel.player1) === String(userId);
      const isPlayer2 = String(duel.player2) === String(userId);
      if (!isPlayer1 && !isPlayer2) throw new AppError('Vous ne faites pas partie de ce duel', 403);

      if ((isPlayer1 && duel.resultPlayer1) || (isPlayer2 && duel.resultPlayer2)) {
        throw new AppError('Votre preuve a déjà été soumise', 422);
      }

      const canonicalSubmission = buildCanonicalDuelSubmission(duel, userId, result);
      const payload = {
        score: canonicalSubmission.score,
        myScore: canonicalSubmission.myScore,
        opponentScore: canonicalSubmission.opponentScore,
        submittedBy: userId,
        submittedFor: canonicalSubmission.submittedForPlayerId,
        declaredWinner: canonicalSubmission.declaredWinner,
        screenshot: result.screenshot,
        comment: result.comment || ''
      };

      if (isPlayer1) duel.resultPlayer1 = payload;
      if (isPlayer2) duel.resultPlayer2 = payload;

      const postCommitEvents = [];

      if (duel.resultPlayer1 && !duel.resultPlayer2) {
        const payloadBase = buildDuelEventPayload(duel, {
          proofBy: duel.player1,
          proofRole: 'player1',
          submittedScore: duel.resultPlayer1.score,
          submittedBy: userId
        });
        postCommitEvents.push(
          { target: 'user', userId: duel.player1, name: 'duel:proof_submitted', payload: payloadBase },
          { target: 'user', userId: duel.player1, name: 'duel:processing', payload: payloadBase },
          { target: 'user', userId: duel.player2, name: 'duel:proof_received', payload: payloadBase },
          { target: 'user', userId: duel.player1, name: 'duel:result_pending', payload: payloadBase }
        );
        duel.status = 'waiting_player2_proof';
        duel.autoValidationStatus = 'pending';
        duel.autoValidationReason = '';
      }

      if (duel.resultPlayer2 && !duel.resultPlayer1) {
        const payloadBase = buildDuelEventPayload(duel, {
          proofBy: duel.player2,
          proofRole: 'player2',
          submittedScore: duel.resultPlayer2.score,
          submittedBy: userId
        });
        postCommitEvents.push(
          { target: 'user', userId: duel.player2, name: 'duel:proof_submitted', payload: payloadBase },
          { target: 'user', userId: duel.player2, name: 'duel:processing', payload: payloadBase },
          { target: 'user', userId: duel.player1, name: 'duel:proof_received', payload: payloadBase },
          { target: 'user', userId: duel.player2, name: 'duel:result_pending', payload: payloadBase }
        );
        duel.status = 'waiting_player1_proof';
        duel.autoValidationStatus = 'pending';
        duel.autoValidationReason = '';
      }

      if (duel.resultPlayer1 && duel.resultPlayer2) {
        // NOUVEAU: Validation robuste des scores
        const validation = validateScoreSubmission(
          {
            id: duel.player1,
            myScore: duel.resultPlayer1.myScore,
            opponentScore: duel.resultPlayer1.opponentScore,
            winnerChoice: duel.resultPlayer1.declaredWinner
          },
          {
            id: duel.player2,
            myScore: duel.resultPlayer2.myScore,
            opponentScore: duel.resultPlayer2.opponentScore,
            winnerChoice: duel.resultPlayer2.declaredWinner
          }
        );

        console.log('[duel:result] score validation', {
          duelId: duel._id,
          isValid: validation.isValid,
          confidence: validation.confidence,
          fraudDetected: validation.fraudDetected,
          fraudReason: validation.fraudReason,
          finalScore: validation.finalScore,
          winnerId: validation.winnerId
        });
        const payloadBase = buildDuelEventPayload(duel, {
          proofImages: {
            player1: duel.resultPlayer1?.screenshot || '',
            player2: duel.resultPlayer2?.screenshot || ''
          },
          submittedScorePlayer1: duel.resultPlayer1.score,
          submittedScorePlayer2: duel.resultPlayer2.score
        });

        if (!validation.isValid || validation.fraudDetected) {
          duel.status = 'dispute';
          duel.autoValidationStatus = 'failed';
          duel.autoValidationReason = validation.fraudReason || 'Scores non valides';
          duel.disputeReason = validation.fraudReason || 'Incohérence des scores';
          duel.fraudDetected = validation.fraudDetected;
          duel.fraudDetails = validation.details;
          duel.manualReviewRequestedAt = new Date();
          duel.manualReviewDueAt = new Date(Date.now() + 5 * 60 * 1000);
          console.log('[duel:result] dispute opened', {
            duelId: duel._id,
            isValid: validation.isValid,
            fraudDetected: validation.fraudDetected,
            fraudReason: validation.fraudReason,
            badActor: validation.badActor,
            details: validation.details
          });
          postCommitEvents.push(
            {
              target: 'admin',
              name: 'admin:dispute_pending',
              payload: {
                ...payloadBase,
                reason: validation.fraudReason || 'Incohérence des scores',
                fraudDetected: validation.fraudDetected,
                badActor: validation.badActor,
                confidence: validation.confidence,
                resolutionRequired: true,
                resolutionActions: ['winner', 'cancel']
              }
            },
            {
              target: 'room',
              roomId: duel.roomId,
              name: 'duel:dispute_opened',
              payload: {
                ...payloadBase,
                reason: validation.fraudReason || 'Incohérence des scores',
                resolutionRequired: true
              }
            },
            {
              target: 'user',
              userId: duel.player1,
              name: 'duel:review_required',
              payload: {
                ...payloadBase,
                reason: validation.fraudReason || 'Incohérence des scores'
              }
            },
            {
              target: 'user',
              userId: duel.player2,
              name: 'duel:review_required',
              payload: {
                ...payloadBase,
                reason: validation.fraudReason || 'Incohérence des scores'
              }
            }
          );
          duel.autoValidationStatus = 'auto_approved';
          duel.autoValidationReason = `Validation auto: Scores cohérents (${duel.resultPlayer1.score})`;

          // Sauvegarder avant de finir
          await duel.save({ session });

          // Terminer le duel avec le gagnant déterminé
          if (comparison.winnerId) {
            const finishedDuel = await finishDuel(duel._id, comparison.winnerId, session, postCommitEvents);

            // Notification de fin aux deux joueurs
            const finishPayload = buildDuelEventPayload(finishedDuel, {
              message: 'Duel terminé - Verdict prononcé',
              winner: finishedDuel.winner,
              amount: finishedDuel.winnerAmount
            });

            postCommitEvents.push(
              { target: 'user', userId: duel.player1, name: 'duel:finished', payload: finishPayload },
              { target: 'user', userId: duel.player2, name: 'duel:finished', payload: finishPayload },
              {
                target: 'user', userId: duel.player1, name: 'duel:verdict_pronounced', payload: {
                  ...finishPayload,
                  notification: 'La salle est fermée. Le verdict a été prononcé.'
                }
              },
              {
                target: 'user', userId: duel.player2, name: 'duel:verdict_pronounced', payload: {
                  ...finishPayload,
                  notification: 'La salle est fermée. Le verdict a été prononcé.'
                }
              },
              { target: 'room', roomId: duel.roomId, name: 'duel:closed', payload: finishPayload }
            );
          }

          return { duel, postCommitEvents, autoFinished: true };
        }
      }

      await duel.save({ session });
      postCommitEvents.push({
        target: 'room',
        roomId: duel.roomId,
        name: 'duel:result_submitted',
        payload: buildDuelEventPayload(duel, {
          status: duel.status,
          submittedScorePlayer1: duel.resultPlayer1?.score || '',
          submittedScorePlayer2: duel.resultPlayer2?.score || ''
        })
      });
      return { duel, postCommitEvents };
    });

    await dispatchEvents(outcome.postCommitEvents);
    if (triggerBackgroundOcr) {
      await queueDuelOcrProcessing(outcome.duel._id);
    }
    return outcome.duel;
  } finally {
    await session.endSession();
  }
}

export async function finishDuel(duelId, winnerId, session = null, eventCollector = null) {
  const useSession = session || (await mongoose.startSession());
  const shouldEndSession = !session;
  let postCommitEvents = [];

  try {
    const execute = async () => {
      const duel = await Duel.findById(duelId).session(useSession);
      if (!duel) throw new AppError('Duel non trouvé', 404);
      if (duel.status === 'finished') throw new AppError('Duel déjà terminé', 422);
      if (duel.status === 'cancelled') throw new AppError('Duel déjà annulé', 422);

      const isDraw = isDrawWinnerId(winnerId);
      const winner = isDraw
        ? null
        : (String(duel.player1) === String(winnerId) ? duel.player1 : String(duel.player2) === String(winnerId) ? duel.player2 : null);
      if (!isDraw && !winner) throw new AppError('Le gagnant doit être l\'un des joueurs du duel', 422);

      if (isDraw) {
        await refundStake(duel.player1, duel.amount, duel._id, useSession);
        await refundStake(duel.player2, duel.amount, duel._id, useSession);
        duel.isDraw = true;
        duel.winner = null;
        duel.loser = null;
      } else {
        const loser = String(winner) === String(duel.player1) ? duel.player2 : duel.player1;
        // Debug logging for admin dispute resolution
        console.log('[finishDuel] Settling wallets:', {
          duelId: duel._id,
          winnerId: winner,
          loserId: loser,
          stake: duel.amount,
          winnerAmount: duel.winnerAmount,
          commissionAmount: duel.commissionAmount
        });
        await settleDuelWallets({
          winnerId: winner,
          loserId: loser,
          stake: duel.amount,
          winnerAmount: duel.winnerAmount,
          commissionAmount: duel.commissionAmount,
          duelId: duel._id
        }, useSession);
        console.log('[finishDuel] Wallet settlement completed for duel:', duel._id);

        const winnerUser = await User.findById(winner).session(useSession);
        const loserUser = await User.findById(loser).session(useSession);

        winnerUser.wins += 1;
        winnerUser.totalEarnings += duel.winnerAmount;
        winnerUser.currentStreak += 1;
        if (winnerUser.currentStreak > winnerUser.maxStreak) {
          winnerUser.maxStreak = winnerUser.currentStreak;
        }
        winnerUser.rank = rankForUser(winnerUser);
        winnerUser.badge = badgeForUser(winnerUser);

        loserUser.losses += 1;
        loserUser.currentStreak = 0;
        loserUser.rank = rankForUser(loserUser);
        loserUser.badge = badgeForUser(loserUser);

        await winnerUser.save({ session: useSession });
        await loserUser.save({ session: useSession });

        duel.isDraw = false;
        duel.winner = winner;
        duel.loser = loser;

        // Notifications Telegram pour victoire/défaite
        if (winnerUser?.telegramId && winnerUser.notificationPreferences?.telegram?.results !== false) {
          await notifyDuelWon(
            winnerUser.telegramId,
            loserUser?.efootballUsername || loserUser?.username || 'Adversaire',
            duel.winnerAmount,
            duel._id
          );
        }
        if (loserUser?.telegramId && loserUser.notificationPreferences?.telegram?.results !== false) {
          await notifyDuelLost(
            loserUser.telegramId,
            winnerUser?.efootballUsername || winnerUser?.username || 'Adversaire',
            duel.amount,
            duel._id
          );
        }
      }
      duel.status = 'finished';
      duel.finishedAt = new Date();
      await duel.save({ session: useSession });

      if (isDraw) {
        const drawPayload = buildDuelEventPayload(duel, { result: 'draw', message: 'Match nul' });
        postCommitEvents = [
          { target: 'room', roomId: duel.roomId, name: 'duel:finished', payload: drawPayload },
          { target: 'user', userId: duel.player1, name: 'duel:finished', payload: drawPayload },
          { target: 'user', userId: duel.player2, name: 'duel:finished', payload: drawPayload }
        ];
      } else {
        const winnerName = winnerUser?.efootballUsername || winnerUser?.username || '';
        const finishedPayload = buildDuelEventPayload(duel, { winnerUsername: winnerName });
        postCommitEvents = [
          { target: 'user', userId: duel.winner, name: 'duel:payment_released', payload: { ...finishedPayload, amount: duel.winnerAmount } },
          { target: 'room', roomId: duel.roomId, name: 'duel:finished', payload: finishedPayload },
          { target: 'user', userId: duel.winner, name: 'duel:finished', payload: finishedPayload },
          { target: 'user', userId: duel.loser, name: 'duel:finished', payload: finishedPayload }
        ];
      }
      return duel;
    };

    let duel;
    if (shouldEndSession) {
      duel = await useSession.withTransaction(execute);
      await dispatchEvents(postCommitEvents);
      return duel;
    }
    duel = await execute();
    if (Array.isArray(eventCollector)) {
      eventCollector.push(...postCommitEvents);
    }
    return duel;
  } finally {
    if (shouldEndSession) await useSession.endSession();
  }
}

const STALE_ANALYZING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (was 15)
const ANALYZING_WARNING_MS = 5 * 60 * 1000; // 5 minutes warning

export async function notifySlowAnalyzingDuels() {
  // Proactive notification for duels in analyzing since 5 minutes
  const warningTime = new Date(Date.now() - ANALYZING_WARNING_MS);
  const stuckTime = new Date(Date.now() - STALE_ANALYZING_TIMEOUT_MS);

  const slowDuels = await Duel.find({
    status: 'analyzing',
    updatedAt: { $lt: warningTime, $gte: stuckTime },
    'notifiedSlow': { $ne: true } // Not yet notified
  });

  for (const duel of slowDuels) {
    try {
      await dispatchEvents([
        {
          target: 'room',
          roomId: duel.roomId,
          name: 'duel:analysis_delayed',
          payload: {
            duelId: duel._id,
            message: 'L\'analyse prend plus de temps que prévu...',
            eta: '5 minutes restantes'
          }
        },
        {
          target: 'admin',
          name: 'admin:analysis_slow',
          payload: {
            duelId: duel._id,
            duration: '5+ minutes',
            action: 'monitor'
          }
        }
      ]);

      // Mark as notified
      await Duel.updateOne({ _id: duel._id }, { $set: { notifiedSlow: true } });
    } catch (error) {
      await logError('duel:slow_analysis_notify', null, error.message, { duelId: duel._id });
    }
  }
}

export async function recoverStuckAnalyzingDuels() {
  const session = await mongoose.startSession();
  let recoveredCount = 0;
  try {
    // First notify slow duels (5 min threshold)
    await notifySlowAnalyzingDuels();

    // Then recover stuck duels (10 min threshold)
    const stuckDuels = await Duel.find({
      status: 'analyzing',
      updatedAt: { $lt: new Date(Date.now() - STALE_ANALYZING_TIMEOUT_MS) }
    }).session(session);

    for (const duel of stuckDuels) {
      let pendingEvents = [];
      try {
        await session.withTransaction(async () => {
          const freshDuel = await Duel.findById(duel._id).session(session);
          if (!freshDuel || freshDuel.status !== 'analyzing') return;

          freshDuel.status = 'dispute';
          freshDuel.autoValidationStatus = 'failed';
          freshDuel.autoValidationReason = 'Timeout OCR watchdog : analyse bloquée depuis plus de 10 minutes.';
          freshDuel.disputeReason = freshDuel.autoValidationReason;
          await freshDuel.save({ session });

          const payloadBase = buildDuelEventPayload(freshDuel, {
            reason: freshDuel.disputeReason,
            resolutionRequired: true,
            resolutionActions: ['winner', 'cancel'],
            proofImages: {
              player1: freshDuel.resultPlayer1?.screenshot || '',
              player2: freshDuel.resultPlayer2?.screenshot || ''
            }
          });

          // Collect events inside transaction, dispatch after commit
          pendingEvents = [
            { target: 'admin', name: 'admin:dispute_pending', payload: payloadBase },
            { target: 'room', roomId: freshDuel.roomId, name: 'duel:dispute_opened', payload: payloadBase },
            { target: 'user', userId: freshDuel.player1, name: 'duel:review_required', payload: payloadBase },
            { target: 'user', userId: freshDuel.player2, name: 'duel:review_required', payload: payloadBase }
          ];
          recoveredCount += 1;
        });

        // Dispatch events after successful transaction commit
        if (pendingEvents.length > 0) {
          await dispatchEvents(pendingEvents);
        }
      } catch (error) {
        await logError('duel:ocr_watchdog', null, error.message, { duelId: duel._id });
      }
    }
  } finally {
    await session.endSession();
  }
  if (recoveredCount > 0) {
    console.log(`[OCR Watchdog] Recovered ${recoveredCount} stuck analyzing duel(s)`);
  }
  return { recovered: recoveredCount };
}
