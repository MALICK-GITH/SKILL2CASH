import { CommissionSetting } from '../models/CommissionSetting.js';

const fallbackRates = [
  { minAmount: 0, maxAmount: 4999, rate: 0.09 },
  { minAmount: 5000, maxAmount: 19999, rate: 0.08 },
  { minAmount: 20000, maxAmount: null, rate: 0.05 }
];

export async function seedDefaultCommissions() {
  const count = await CommissionSetting.countDocuments();
  if (count > 0) return;

  await CommissionSetting.create([
    { name: 'Small stake', minAmount: 0, maxAmount: 4999, rate: 0.09 },
    { name: 'Medium stake', minAmount: 5000, maxAmount: 19999, rate: 0.08 },
    { name: 'High stake', minAmount: 20000, maxAmount: null, rate: 0.05 },
    { name: 'Tournament default', minAmount: 0, maxAmount: null, rate: 0.12, type: 'tournament' }
  ]);
}

export async function getCommissionRate(amount, type = 'duel') {
  const setting = await CommissionSetting.findOne({
    active: true,
    type,
    minAmount: { $lte: amount },
    $or: [{ maxAmount: null }, { maxAmount: { $gte: amount } }]
  }).sort({ minAmount: -1 });

  if (setting) return setting.rate;

  const fallback = fallbackRates.find((item) => amount >= item.minAmount && (item.maxAmount === null || amount <= item.maxAmount));
  return fallback?.rate || 0.1;
}

export function calculateCommission(potTotal, rate) {
  const commissionAmount = Math.round(potTotal * rate);
  return {
    commissionAmount,
    winnerAmount: potTotal - commissionAmount
  };
}
