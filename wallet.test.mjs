import assert from 'node:assert/strict';
import test from 'node:test';
import { addTransaction, balanceAfter, balanceOf, decodeWallet, newWallet, parseAmount } from './wallet.js';

const date = '2026-11-07T12:00:00Z';
const send = { recipient: 'anika', amount: 35_000, id: 'send-1', type: 'send', date };
const deposit = { amount: 100_000, id: 'deposit-1', type: 'deposit', date };
const cashout = { amount: 20_000, id: 'cashout-1', type: 'cashout', date };
const legacyWallet = () => decodeWallet('{"version":2,"entries":[]}');

test('parses amounts exactly as integer cents', () => {
  assert.equal(parseAmount(' 350 '), 35_000);
  assert.equal(parseAmount('0.01'), 1);
  assert.equal(parseAmount('3.4'), 340);
  assert.equal(parseAmount('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  for (const value of ['', '0', '-1', '3.001', '1e2', '3,000', '90071992547409.92']) {
    assert.equal(parseAmount(value), null);
  }
});

test('a mixed ledger maintains the correct balance and can be restored', () => {
  const wallet = [send, deposit, cashout].reduce(addTransaction, legacyWallet());
  assert.equal(balanceOf(wallet), 545_000);
  assert.deepEqual(wallet.entries, [send, deposit, cashout]);
  assert.deepEqual(decodeWallet(JSON.stringify(wallet)), wallet);
});

test('rejects an overdraft for sends and cash outs, while allowing an exact debit', () => {
  const wallet = legacyWallet();
  for (const entry of [send, cashout]) {
    assert.throws(() => addTransaction(wallet, { ...entry, amount: 500_001 }), /balance/);
    assert.equal(balanceOf(addTransaction(wallet, { ...entry, amount: 500_000 })), 0);
  }
  assert.deepEqual(wallet.entries, []);
});

test('rejects invalid recipients, amounts, and operation types without mutating the wallet', () => {
  const wallet = newWallet();
  assert.throws(() => addTransaction(wallet, { ...send, recipient: 'toString' }), /recipient/);
  assert.throws(() => addTransaction(wallet, { ...deposit, amount: -10 }), /amount/);
  assert.throws(() => addTransaction(wallet, { ...deposit, type: 'toString' }), /type/);
  assert.throws(() => balanceAfter(Number.MAX_SAFE_INTEGER, 'deposit', 1), /limit/);
  assert.deepEqual(wallet, newWallet());
});

test('prevents duplicate transaction IDs and rejects inconsistent saved data', () => {
  const wallet = addTransaction(newWallet(), send);
  assert.throws(() => addTransaction(wallet, { ...deposit, id: send.id }), /already exists/);
  assert.throws(() => decodeWallet('broken'));
  assert.throws(() => decodeWallet('{"version":3,"entries":[]}'));
  assert.throws(() => decodeWallet(JSON.stringify({ version: 2, entries: [send, send] })), /already exists/);
  assert.throws(() => decodeWallet(JSON.stringify({ version: 2, entries: [null] })), /transaction ID/);
});

test('upgrades legacy send-only data without losing IDs, timestamps, or balance', () => {
  const { type, ...legacySend } = send;
  const wallet = decodeWallet(JSON.stringify({ version: 1, transfers: [legacySend] }));
  assert.equal(wallet.version, 3);
  assert.equal(balanceOf(wallet), 465_000);
  assert.deepEqual(wallet.entries, [send]);
  assert.equal(balanceOf(addTransaction(wallet, deposit)), 565_000);
});

test('a fresh wallet matches the reference opening balance and four sample payments', () => {
  const wallet = decodeWallet(null);
  assert.equal(balanceOf(wallet), 4_500_000);
  assert.equal(wallet.entries.length, 4);
  assert.deepEqual(decodeWallet(JSON.stringify(wallet)), wallet);
});
test('credits the demo bonus once and debits bill payments without losing earlier history', () => {
  const reward = { id: 'bonus-1', type: 'bonus', amount: 10_000, coupon: 'TAKAPATHAI', date };
  const bill = { id: 'bill-1', type: 'bill', amount: 15_000, provider: 'Electricity', accountSuffix: '0001', date };
  const wallet = [send, deposit, cashout, reward, bill].reduce(addTransaction, legacyWallet());
  assert.equal(balanceOf(wallet), 540_000);
  assert.deepEqual(decodeWallet(JSON.stringify(wallet)), wallet);
  assert.throws(() => addTransaction(wallet, { ...reward, id: 'bonus-2' }), /already been claimed/);
  assert.throws(() => addTransaction(newWallet(), { ...reward, amount: 20_000 }), /coupon is invalid/);
  assert.throws(() => addTransaction(wallet, { ...bill, id: 'bill-2', amount: 540_001 }), /Insufficient/);
});
