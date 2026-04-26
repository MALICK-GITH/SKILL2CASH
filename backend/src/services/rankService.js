export function rankForUser({ wins = 0, totalEarnings = 0 }) {
  if (wins >= 100 || totalEarnings >= 500000) return 'Legend';
  if (wins >= 50 || totalEarnings >= 200000) return 'Elite';
  if (wins >= 20 || totalEarnings >= 75000) return 'Gold';
  if (wins >= 5 || totalEarnings >= 15000) return 'Silver';
  return 'Bronze';
}

export function badgeForUser({ wins = 0, losses = 0 }) {
  if (wins >= 25 && wins >= losses * 2) return 'Cash Reaper';
  if (wins >= 10) return 'Verified Skill';
  if (losses > wins + 10) return 'Needs Revenge';
  return 'New Blood';
}
