import { addTransaction, balanceOf, bankNames, billers, bonus, decodeWallet, isCredit, newWallet, parseAmount, recipients, storageKey, transactionTypes } from './wallet.js';

const byId = (id) => document.getElementById(id);
const app = byId('wallet-app');
const form = byId('transfer-form');
const account = byId('account');
const provider = byId('provider');
const submit = byId('submit-action');
const receipt = byId('receipt');
const receiptAction = byId('receipt-action');
const viewAll = byId('view-all');
const demoPin = '1234';
const sessionKey = 'takapathai-demo-session';
const actions = {
  deposit: {
    account: 'Bank Account Number', placeholder: 'Enter 11 digit account number', providers: bankNames,
    providerLabel: 'Select A Bank', amount: 'Amount to Add', amountHint: 'Enter amount to add',
    button: 'Add Money', hint: 'Try demo bank account 01900000001 and PIN 1234.',
  },
  cashout: {
    account: 'Agent Number', placeholder: 'Enter 11 digit number', amountHint: 'Enter amount to withdraw',
    button: 'Withdraw Money', hint: 'Try demo agent 01600000001 and PIN 1234.',
  },
  send: {
    account: 'User Account Number', placeholder: 'Enter 11 digit number', amountHint: 'Enter amount to transfer',
    button: 'Send Now', hint: 'Try demo account 01800000001 and PIN 1234.',
  },
  bonus: { button: 'Get Bonus', hint: 'Use coupon TAKAPATHAI once to add $100.' },
  bill: {
    account: 'Biller Account Number', placeholder: 'Enter account number', providers: billers,
    providerLabel: 'Select To Pay', amount: 'Amount to Pay', amountHint: 'Enter amount to pay',
    button: 'Pay Now', hint: 'Try demo biller account 100001 and PIN 1234.',
  },
};
const clock = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
const calendar = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
let wallet = newWallet();
let signedIn = false;
let pending = false;
let expandedHistory = false;
let type = 'send';

refreshWallet();
try {
  signedIn = sessionStorage.getItem(sessionKey) === 'active';
} catch {
  // The demo also works for the current page without session storage.
}
show(signedIn ? 'dashboard' : 'welcome');

byId('login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (byId('mobile').value !== '01700000000' || byId('login-pin').value !== demoPin) {
    message('login-error', 'Use demo mobile 01700000000 and PIN 1234.');
    return;
  }
  setSession(true);
  event.currentTarget.reset();
  message('login-error', '');
  show('dashboard');
});

byId('logout').addEventListener('click', () => {
  if (pending) return;
  setSession(false);
  form.reset();
  show('welcome');
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !signedIn || pending) return;
  if (button.dataset.transaction) {
    configureForm(button.dataset.transaction);
    show('transfer');
  } else if (button.dataset.view === 'history') {
    expandedHistory = button.classList.contains('text-button');
    show('history');
  }
});

viewAll.addEventListener('click', () => {
  expandedHistory = !expandedHistory;
  renderHistory();
});

receipt.addEventListener('close', () => {
  if (receiptAction.value === 'home') show('dashboard');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!signedIn || pending) return;
  message('transaction-error', '');
  const isBonus = type === 'bonus';
  const amount = isBonus ? bonus.amount : parseAmount(byId('amount').value);
  const coupon = byId('coupon').value.trim().toUpperCase();
  if (isBonus ? coupon !== bonus.code : byId('transaction-pin').value !== demoPin) {
    message('transaction-error', isBonus ? 'Enter the demo coupon TAKAPATHAI.' : 'Enter demo PIN 1234.');
    return;
  }
  if (amount === null) {
    message('transaction-error', 'Enter a positive amount with up to two decimal places.');
    return;
  }
  pending = true;
  submit.disabled = true;
  let entry;
  try {
    if (!navigator.locks) throw new Error('Open the demo in a current browser on localhost or HTTPS.');
    entry = { type, amount, id: crypto.randomUUID(), date: new Date().toISOString() };
    if (isBonus) entry.coupon = coupon;
    else entry.accountSuffix = account.value.slice(-4);
    if (actions[type].providers) entry.provider = provider.value;
    await navigator.locks.request(storageKey, () => {
      const next = addTransaction(decodeWallet(localStorage.getItem(storageKey)), entry);
      localStorage.setItem(storageKey, JSON.stringify(next));
      wallet = next;
    });
  } catch (error) {
    refreshWallet();
    renderDashboard();
    message('transaction-error', error.message);
    return;
  } finally {
    pending = false;
    submit.disabled = false;
  }
  form.reset();
  message('storage-notice', '');
  renderDashboard();
  showReceipt(entry, balanceOf(wallet));
});

window.addEventListener('storage', (event) => {
  if (event.key !== storageKey && event.key !== null) return;
  refreshWallet();
  if (!signedIn) return;
  renderDashboard();
  if (!byId('history').hidden) renderHistory();
});

function setSession(active) {
  signedIn = active;
  try {
    if (active) sessionStorage.setItem(sessionKey, 'active');
    else sessionStorage.removeItem(sessionKey);
  } catch {
    // Session changes still apply to the current page.
  }
}

function refreshWallet() {
  try {
    wallet = decodeWallet(localStorage.getItem(storageKey));
    message('storage-notice', '');
  } catch {
    message('storage-notice', 'The saved demo wallet could not be opened.');
  }
}

function configureForm(actionType) {
  type = actionType;
  const action = actions[type];
  form.reset();
  message('transaction-error', '');
  byId('transfer-heading').textContent = transactionTypes[type];
  byId('transaction-intro').textContent = action.hint;
  byId('account-label').textContent = action.account ?? '';
  account.pattern = type === 'bill' ? '[0-9]{6,16}' : '[0-9]{11}';
  account.placeholder = action.placeholder ?? '';
  byId('amount-label').textContent = action.amount ?? 'Amount';
  byId('amount').placeholder = action.amountHint ?? '';
  byId('provider-label').textContent = action.providerLabel ?? '';
  provider.replaceChildren(new Option(action.providerLabel ?? 'Select a provider', ''));
  for (const name of action.providers ?? []) provider.add(new Option(name));
  for (const [field, visible] of [
    ['provider', Boolean(action.providers)], ['account', Boolean(action.account)],
    ['amount', type !== 'bonus'], ['pin', type !== 'bonus'], ['coupon', type === 'bonus'],
  ]) {
    const fieldset = byId(`${field}-field`);
    fieldset.hidden = !visible;
    fieldset.disabled = !visible;
  }
  submit.textContent = action.button;
}

function show(view) {
  byId('welcome').hidden = signedIn;
  byId('dashboard').hidden = !signedIn;
  byId('activity').hidden = view !== 'dashboard';
  byId('transfer').hidden = view !== 'transfer';
  byId('history').hidden = view !== 'history';
  if (signedIn) renderDashboard();
  if (view === 'history') renderHistory();
  for (const button of byId('dashboard').querySelectorAll('.shortcut')) {
    const active = button.dataset.view === 'history' ? view === 'history' :
      view === 'transfer' && button.dataset.transaction === type;
    button.setAttribute('aria-pressed', String(active));
  }
  if (view === 'dashboard' || view === 'welcome') window.scrollTo(0, 0);
  byId(`${view}-heading`)?.focus({ preventScroll: true });
}

function renderDashboard() {
  byId('balance').textContent = money(balanceOf(wallet));
  renderActivity('recent-activity', wallet.entries.slice(-4));
}

function renderHistory() {
  renderActivity('history-list', expandedHistory ? wallet.entries : wallet.entries.slice(-4));
  viewAll.setAttribute('aria-expanded', String(expandedHistory));
  viewAll.textContent = expandedHistory ? 'View Less' : 'View All';
}

function money(amount) {
  const remainder = amount % 100;
  const whole = (amount - remainder) / 100;
  return `$${whole}${remainder ? `.${String(remainder).padStart(2, '0')}` : ''}`;
}

function entryTitle(entry) {
  if (entry.type === 'bill') return entry.provider === 'Mobile Recharge' ? entry.provider : `${entry.provider} Bill`;
  if (entry.type === 'deposit') return 'Bank Deposit';
  if (entry.type === 'send') return 'Transfer Money';
  return transactionTypes[entry.type];
}

function message(id, text) {
  const element = byId(id);
  element.textContent = text;
  element.hidden = !text;
}

function showReceipt(entry, newBalance) {
  const completed = newBalance !== undefined;
  const rows = [
    ['Amount', `${isCredit(entry.type) ? '+' : '−'}${money(entry.amount)}`],
    ['Date', `${calendar.format(new Date(entry.date))} ${clock.format(new Date(entry.date))}`],
    ['Transaction ID', entry.id],
  ];
  if (entry.provider) rows.push(['Provider', entry.provider]);
  if (entry.accountSuffix) rows.push(['Account', `•••• ${entry.accountSuffix}`]);
  else if (entry.recipient) rows.push(['Recipient', recipients[entry.recipient]]);
  if (entry.coupon) rows.push(['Coupon', entry.coupon]);
  if (completed) rows.push(['New Balance', money(newBalance)]);
  const list = byId('receipt-details');
  list.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    list.append(term, detail);
  }
  byId('receipt-heading').textContent = completed ? 'Transaction completed' : entryTitle(entry);
  byId('receipt-success-mark').hidden = !completed;
  message('receipt-type', completed ? entryTitle(entry) : '');
  receiptAction.textContent = completed ? 'Back to Home' : 'Close';
  receiptAction.value = completed ? 'home' : 'close';
  receipt.returnValue = '';
  receipt.showModal();
}

function renderActivity(id, entries) {
  const list = byId(id);
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No transactions yet.';
    list.append(empty);
    return;
  }
  const today = calendar.format(new Date());
  for (const entry of entries.toReversed()) {
    const item = document.createElement('li');
    const icon = document.createElement('span');
    const summary = document.createElement('div');
    const title = document.createElement('strong');
    const timestamp = document.createElement('time');
    const menu = document.createElement('button');
    const date = new Date(entry.date);
    const day = calendar.format(date);
    icon.className = 'wallet-symbol';
    icon.textContent = '▤';
    icon.setAttribute('aria-hidden', 'true');
    title.textContent = entryTitle(entry);
    timestamp.dateTime = entry.date;
    timestamp.textContent = `${day === today ? 'Today' : day} ${clock.format(date)}`;
    menu.type = 'button';
    menu.className = 'entry-menu';
    menu.textContent = '⋮';
    menu.setAttribute('aria-label', `Details for ${entryTitle(entry)}`);
    menu.addEventListener('click', () => showReceipt(entry));
    summary.append(title, timestamp);
    item.append(icon, summary, menu);
    list.append(item);
  }
}
