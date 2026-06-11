const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const TRUST_TIERS = [
  { min: 90, key: 'reference', label: 'Référence' },
  { min: 75, key: 'elite', label: 'Elite' },
  { min: 60, key: 'solid', label: 'Solide' },
  { min: 40, key: 'reliable', label: 'Fiable' },
  { min: 0, key: 'watch', label: 'Sous surveillance' }
];

const RISK_LEVELS = [
  { min: 90, key: 'very_low', label: 'Risque très faible' },
  { min: 70, key: 'low', label: 'Risque faible' },
  { min: 50, key: 'moderate', label: 'Risque modéré' },
  { min: 30, key: 'high', label: 'Risque élevé' },
  { min: 0, key: 'critical', label: 'Risque critique' }
];

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function orderedBounds(minValue, maxValue) {
  const lower = Number.isFinite(minValue) ? minValue : 0;
  const upper = Number.isFinite(maxValue) ? maxValue : lower;
  return lower <= upper ? [lower, upper] : [upper, lower];
}

export function trustTierForScore(score) {
  return TRUST_TIERS.find((entry) => score >= entry.min) || TRUST_TIERS[TRUST_TIERS.length - 1];
}

export function riskLevelForScore(score) {
  return RISK_LEVELS.find((entry) => score >= entry.min) || RISK_LEVELS[RISK_LEVELS.length - 1];
}

export function calculateTrustScore(source = {}) {
  const wins = toNumber(source.wins);
  const losses = toNumber(source.losses);
  const games = wins + losses;
  const winRate = games > 0 ? (wins / games) * 100 : 0;
  const reputation = clamp(toNumber(source.reputation), 0, 100);
  const reportsCount = clamp(toNumber(source.reportsCount), 0, 100);
  const currentStreak = clamp(toNumber(source.currentStreak), 0, 100);
  const maxStreak = clamp(toNumber(source.maxStreak), 0, 100);
  const totalEarnings = Math.max(toNumber(source.totalEarnings), 0);
  const totalEarningsScore = clamp(Math.log10(totalEarnings + 1) * 12, 0, 18);
  const streakScore = clamp(currentStreak * 2 + maxStreak * 0.5, 0, 14);
  const identityBonus = source.usernameLocked === true ? 4 : source.usernameLocked === false ? -4 : 0;
  const behaviorPenalty = reportsCount * 6;
  const lossPenalty = games > 0 ? clamp((losses / games) * 14, 0, 14) : 0;
  const baseScore = 40;

  const score = baseScore
    + (winRate * 0.24)
    + (reputation - 50) * 0.35
    + totalEarningsScore
    + streakScore
    + identityBonus
    - behaviorPenalty
    - lossPenalty;

  return clamp(Math.round(score), 0, 100);
}

export function buildTrustProfile(source = {}) {
  const score = calculateTrustScore(source);
  const tier = trustTierForScore(score);
  const risk = riskLevelForScore(score);
  const minStake = toNumber(source.minStake);
  const maxStake = toNumber(source.maxStake);
  const totalEarnings = Math.max(toNumber(source.totalEarnings), 0);
  const [stakeFloor, stakeCeiling] = orderedBounds(minStake, maxStake);
  const rawRecommendedStakeCap = Math.round(1000 + score * 250);
  const recommendedStakeCap = clamp(rawRecommendedStakeCap, stakeFloor, Math.max(stakeCeiling, stakeFloor || rawRecommendedStakeCap));

  const signals = [];
  const wins = toNumber(source.wins);
  const losses = toNumber(source.losses);
  const games = wins + losses;
  const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;
  const reportsCount = toNumber(source.reportsCount);
  const currentStreak = toNumber(source.currentStreak);

  if (winRate >= 60) {
    signals.push({ label: 'Win rate solide', tone: 'positive' });
  } else if (winRate < 40 && games >= 5) {
    signals.push({ label: 'Win rate à surveiller', tone: 'warning' });
  }

  if (currentStreak >= 3) {
    signals.push({ label: `Série en cours: ${currentStreak}`, tone: 'positive' });
  }

  if (reportsCount === 0) {
    signals.push({ label: 'Aucun signal négatif', tone: 'positive' });
  } else {
    signals.push({ label: `${reportsCount} signal${reportsCount > 1 ? 's' : ''} de risque`, tone: 'danger' });
  }

  if (toNumber(source.reputation) >= 80) {
    signals.push({ label: 'Réputation élevée', tone: 'positive' });
  }

  if (source.usernameLocked === true) {
    signals.push({ label: 'Identité eFootball verrouillée', tone: 'positive' });
  } else if (source.usernameLocked === false) {
    signals.push({ label: 'Identité eFootball à confirmer', tone: 'warning' });
  }

  const earningsSignal = totalEarningsToSignal(totalEarnings);
  if (earningsSignal) {
    signals.push({ label: `Historique de gains ${earningsSignal}`, tone: 'neutral' });
  }

  const summary = score >= 90
    ? 'Profil de référence pour les gros enjeux.'
    : score >= 75
      ? 'Profil très fiable pour les duels réguliers.'
      : score >= 60
        ? 'Profil solide avec peu de friction.'
        : score >= 40
          ? 'Profil correct mais encore en construction.'
          : 'Profil à surveiller avant d’augmenter les mises.';

  return {
    score,
    tier: tier.key,
    tierLabel: tier.label,
    riskLevel: risk.key,
    riskLabel: risk.label,
    recommendedStakeCap,
    summary,
    signals
  };
}

function totalEarningsToSignal(totalEarnings) {
  if (totalEarnings >= 250000) return 'très fort';
  if (totalEarnings >= 100000) return 'fort';
  if (totalEarnings >= 25000) return 'sérieux';
  if (totalEarnings > 0) return 'en progression';
  return '';
}
