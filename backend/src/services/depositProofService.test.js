import test from 'node:test';
import assert from 'node:assert/strict';
import { detectReceiptAmount, detectReceiptSender, detectReceiptStatus } from './depositProofService.js';

test('detectReceiptAmount accepts close receipt amounts within tolerance', () => {
  assert.equal(detectReceiptAmount('Montant reçu 195 CFA', '200'), '195');
  assert.equal(detectReceiptAmount('Montant reçu 2 000 CFA', '2000'), '2000');
});

test('detectReceiptSender accepts sender tokens and transaction reference hints', () => {
  assert.equal(
    detectReceiptSender('À Mah M T 05 02 63 0909', 'Mah M T', 'T_TWA67YPDZWAKWQEV'),
    true
  );
  assert.equal(
    detectReceiptSender('En partenariat avec UBA', 'Mah M T', ''),
    false
  );
});

test('detectReceiptStatus identifies successful and unknown receipts', () => {
  assert.equal(detectReceiptStatus('Statut ✅ Effectué'), 'success');
  assert.equal(detectReceiptStatus('Aucune information de statut lisible'), 'unknown');
});
