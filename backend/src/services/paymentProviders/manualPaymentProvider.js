import { manualPaymentAccounts } from '../../config/payments.js';

export const manualPaymentProvider = {
  id: 'manual',
  label: 'Manual review',
  supports: {
    deposit: true,
    withdrawal: true,
    webhook: false,
    verification: true
  },
  listMethods() {
    return Object.values(manualPaymentAccounts).map((account) => ({
      provider: 'manual',
      providerLabel: 'Manual review',
      method: account.method,
      label: account.label,
      accountName: account.accountName,
      paymentNumber: account.paymentNumber,
      instructions: account.instructions,
      estimatedDelay: account.estimatedDelay,
      capabilities: {
        deposit: true,
        withdrawal: true,
        autoVerification: false
      }
    }));
  },
  async createDepositIntent({ method, amount, userId }) {
    const account = manualPaymentAccounts[String(method || '').toLowerCase()];
    if (!account) {
      throw new Error('Méthode de paiement manuel inconnue');
    }

    return {
      provider: 'manual',
      method: account.method,
      amount,
      userId,
      status: 'awaiting_proof',
      instructions: account.instructions,
      destination: {
        accountName: account.accountName,
        paymentNumber: account.paymentNumber
      }
    };
  },
  async createWithdrawalIntent({ method, amount, userId, destination }) {
    return {
      provider: 'manual',
      method,
      amount,
      userId,
      destination,
      status: 'pending_admin_review'
    };
  }
};
