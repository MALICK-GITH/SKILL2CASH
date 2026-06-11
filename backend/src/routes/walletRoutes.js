import express from 'express';
import { manualPaymentAccounts } from '../config/payments.js';
import { Deposit } from '../models/Deposit.js';
import { Transaction } from '../models/Transaction.js';
import { Withdrawal } from '../models/Withdrawal.js';
import { protect } from '../middleware/auth.js';
import { requireFields } from '../middleware/validate.js';
import { createManualDeposit, previewDepositPrefill } from '../services/depositService.js';
import { listPaymentMethods, listPaymentProviders } from '../services/paymentProviders/index.js';
import { ensureWallet, requestWithdrawal, sendWithdrawalRequestNotifications } from '../services/walletService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPagination } from '../utils/pagination.js';

export const walletRouter = express.Router();
walletRouter.use(protect);

walletRouter.get('/', asyncHandler(async (req, res) => {
  const wallet = await ensureWallet(req.user._id);
  const withdrawals = await Withdrawal.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(10);
  const deposits = await Deposit.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(10);
  res.json({ wallet, withdrawals, deposits, paymentAccounts: manualPaymentAccounts });
}));

walletRouter.get('/deposit-methods', asyncHandler(async (_req, res) => {
  res.json({ methods: manualPaymentAccounts, providers: listPaymentProviders(), catalog: listPaymentMethods() });
}));

walletRouter.post('/deposit', requireFields(['method', 'amount', 'senderName', 'senderPhone', 'screenshotUrl']), asyncHandler(async (req, res) => {
  const deposit = await createManualDeposit(req.user._id, req.body);
  res.status(201).json({
    deposit,
    message: 'Votre dépôt sera vérifié manuellement. Aucun solde ne sera crédité avant validation admin.'
  });
}));

walletRouter.post('/deposit/ocr-prefill', requireFields(['screenshotUrl']), asyncHandler(async (req, res) => {
  const preview = await previewDepositPrefill(req.user._id, req.body);
  res.json(preview);
}));

walletRouter.get('/deposits', asyncHandler(async (req, res) => {
  const deposits = await Deposit.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ deposits });
}));

walletRouter.get('/withdrawals', asyncHandler(async (req, res) => {
  const withdrawals = await Withdrawal.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ withdrawals });
}));

walletRouter.post('/withdraw', requireFields(['amount', 'method', 'phoneOrWallet']), asyncHandler(async (req, res) => {
  const withdrawal = await requestWithdrawal(req.user._id, {
    amount: Number(req.body.amount),
    method: req.body.method,
    phoneOrWallet: req.body.phoneOrWallet
  });
  await sendWithdrawalRequestNotifications(withdrawal);
  res.status(201).json({ withdrawal });
}));

walletRouter.get('/transactions', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const transactions = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit);
  res.json({ transactions, page, limit });
}));
