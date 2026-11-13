export const recipients = Object.freeze({ anika: 'Anika Rahman', rafi: 'Rafi Ahmed' });
export const transactionTypes = Object.freeze({
  send: 'Transfer Money', deposit: 'Add Money', cashout: 'Cash Out', bonus: 'Get Bonus', bill: 'Pay Bill',
});
export const bankNames = Object.freeze(['Demo City Bank', 'Demo Community Bank']);
export const billers = Object.freeze(['Electricity', 'Gas', 'Water', 'Internet', 'Mobile Recharge']);
export const bonus = Object.freeze({ code: 'TAKAPATHAI', amount: 10_000 });
export const isCredit = (type) => type === 'deposit' || type === 'bonus';
// Keep the original key so version-one wallets can be upgraded in place.
export const storageKey = 'takapathai-wallet:v1';
const legacyOpeningBalance = 500_000;
const demoOpeningBalance = 4_500_000;

export function newWallet() {
  const morning = new Date();
  morning.setHours(1, 44, 0, 0);
  const date = morning.toISOString();
  const entries = [
    { id: 'example-gas', type: 'bill', provider: 'Gas', accountSuffix: '0001', amount: 25_000, date },
    { id: 'example-recharge', type: 'bill', provider: 'Mobile Recharge', accountSuffix: '0002', amount: 10_000, date },
    { id: 'example-deposit', type: 'deposit', provider: bankNames[0], accountSuffix: '0003', amount: 50_000, date },
    { id: 'example-electricity', type: 'bill', provider: 'Electricity', accountSuffix: '0004', amount: 15_000, date },
  ];
  return { version: 3, openingBalance: demoOpeningBalance, entries };
}

export function balanceOf(wallet) {
  return wallet.entries.reduce((balance, entry) => balance + change(entry.type, entry.amount), wallet.openingBalance);
}

export function parseAmount(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1] + (match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function change(type, amount) {
  return isCredit(type) ? amount : -amount;
}

export function balanceAfter(balance, type, amount) {
  if (!Object.hasOwn(transactionTypes, type)) throw new Error('Unknown transaction type.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a valid amount.');
  const next = balance + change(type, amount);
  if (next < 0) throw new Error('Insufficient balance for this transaction.');
  if (!Number.isSafeInteger(next)) throw new Error('This amount would exceed the demo balance limit.');
  return next;
}

function validateEntry(entry, balance, ids, bonusClaimed) {
  if (typeof entry?.id !== 'string' || !entry.id || ids.has(entry.id)) {
    throw new Error('This transaction ID is invalid or already exists.');
  }
  if (typeof entry.date !== 'string' || !Number.isFinite(Date.parse(entry.date))) {
    throw new Error('The transaction date is invalid.');
  }
  const hasAccount = typeof entry.accountSuffix === 'string' && /^[0-9]{4}$/.test(entry.accountSuffix);
  if ((entry.accountSuffix !== undefined || entry.type === 'bill') && !hasAccount) {
    throw new Error('The demo account number is invalid.');
  }
  if (entry.type === 'send' && !hasAccount && !Object.hasOwn(recipients, entry.recipient)) {
    throw new Error('Choose a demo recipient or enter a demo account number.');
  }
  if ((entry.type === 'deposit' && hasAccount && !bankNames.includes(entry.provider)) ||
      (entry.type === 'bill' && !billers.includes(entry.provider))) {
    throw new Error('Choose a valid demo provider.');
  }
  if (entry.type === 'bonus') {
    if (entry.coupon !== bonus.code || entry.amount !== bonus.amount) throw new Error('The demo coupon is invalid.');
    if (bonusClaimed) throw new Error('This demo coupon has already been claimed.');
  }
  return balanceAfter(balance, entry.type, entry.amount);
}

export function addTransaction(wallet, entry) {
  validateEntry(entry, balanceOf(wallet), new Set(wallet.entries.map(({ id }) => id)), wallet.entries.some(({ type }) => type === 'bonus'));
  return { ...wallet, entries: [...wallet.entries, { ...entry }] };
}

export function decodeWallet(raw) {
  if (raw === null) return newWallet();
  const snapshot = JSON.parse(raw);
  let entries;
  let openingBalance = legacyOpeningBalance;
  if (snapshot?.version === 1 && Array.isArray(snapshot.transfers)) {
    entries = snapshot.transfers.map((transfer) => ({ ...transfer, type: 'send' }));
  } else if (snapshot?.version === 2 && Array.isArray(snapshot.entries)) {
    entries = snapshot.entries;
  } else if (snapshot?.version === 3 && Array.isArray(snapshot.entries) &&
      Number.isSafeInteger(snapshot.openingBalance) && snapshot.openingBalance >= 0) {
    entries = snapshot.entries;
    openingBalance = snapshot.openingBalance;
  } else {
    throw new Error('Invalid wallet data.');
  }
  const ids = new Set();
  let balance = openingBalance;
  let bonusClaimed = false;
  for (const entry of entries) {
    balance = validateEntry(entry, balance, ids, bonusClaimed);
    ids.add(entry.id);
    if (entry.type === 'bonus') bonusClaimed = true;
  }
  return { version: 3, openingBalance, entries };
}
