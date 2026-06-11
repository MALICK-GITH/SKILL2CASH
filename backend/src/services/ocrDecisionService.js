import { normalizeScore } from './imageProcessing.js';

export function decideMatchOcrOutcome({
  duel,
  player1,
  player2,
  confidence1,
  confidence2,
  visualSimilarity,
  probableWinnerFromScore
}, thresholds) {
  const score1 = normalizeScore(duel.resultPlayer1?.score);
  const score2 = normalizeScore(duel.resultPlayer2?.score);
  const sameScore = Boolean(score1) && score1 === score2;
  const playerNames = [player1.efootballUsername || player1.username, player2.efootballUsername || player2.username];
  const detections = [duel.ocrPlayersDetectedPlayer1, duel.ocrPlayersDetectedPlayer2].map((detected) => new Set(detected || []));
  const anyPlayerDetected = playerNames.some((name) => detections.some((detected) => detected.has(name)));
  const sameTeamsLikely = detections.every((detected) => playerNames.some((name) => detected.has(name)));

  if (duel.resultPlayer1?.imageHash && duel.resultPlayer2?.imageHash && duel.resultPlayer1.imageHash === duel.resultPlayer2.imageHash) {
    return { approved: false, reason: 'FRAUDE POTENTIELLE : les deux captures sont strictement identiques.' };
  }

  if (!sameScore) {
    return { approved: false, reason: 'OCR différent : les deux captures ne donnent pas le même score.' };
  }

  if (confidence1 >= thresholds.strongConfidence && confidence2 >= thresholds.strongConfidence) {
    if (!sameTeamsLikely && visualSimilarity < thresholds.visualSimilarityMin) {
      return { approved: false, reason: 'Les deux captures ne montrent pas assez clairement les mêmes joueurs.' };
    }

    const winnerMatchesOcr = String(probableWinnerFromScore(score1, [player1, player2])) === String(duel.resultPlayer1?.declaredWinner);
    if (!winnerMatchesOcr) {
      return { approved: false, reason: 'Le vainqueur probable détecté par l’OCR ne correspond pas au vainqueur déclaré.' };
    }
    return {
      approved: true,
      reason: `Auto-validation: score identique sur 2 captures, confiance OCR forte (${Math.max(confidence1, confidence2)} %) et comparaison visuelle cohérente.`
    };
  }

  if (visualSimilarity >= thresholds.visualSimilarityMin || anyPlayerDetected) {
    return {
      approved: false,
      reason: 'OCR faible + images similaires : envoyer en revue admin rapide.'
    };
  }

  return { approved: false, reason: 'Confiance OCR insuffisante pour valider automatiquement.' };
}
