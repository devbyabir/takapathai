import { friendsConfig } from './friends-config.js';
import { parseAmount } from './wallet.js';

const byId = (id) => document.getElementById(id);
const googleButton = byId('friends-google');
const pinForm = byId('friends-pin-form');
const sendForm = byId('friends-send-form');
const walletView = byId('friends-wallet');
const logout = byId('friends-logout');
const recipientInput = byId('friends-recipient');
const kindInput = byId('friends-kind');
const formatWhole = new Intl.NumberFormat('en-BD');
const formatDate = new Intl.DateTimeFormat('en-BD', { dateStyle: 'medium', timeStyle: 'short' });
let client;
let matchedHandle;
let pendingTransfer;
let busy = false;

function message(id, text) {
  const element = byId(id);
  element.textContent = text;
  element.hidden = !text;
}

function screen(visible) {
  for (const view of [googleButton, pinForm, walletView]) view.hidden = view !== visible;
}

function walletHandle(value) {
  const handle = value.trim().replace(/^@/, '').replace(/[\s-]/g, '').replace(/^\+880/, '0');
  if (!/^01[3-9][0-9]{8}$/.test(handle)) throw new Error('Enter an 11-digit wallet username, such as 01700000000.');
  return handle;
}

function money(amount) {
  const remainder = amount % 100;
  return `৳${formatWhole.format((amount - remainder) / 100)}.${String(remainder).padStart(2, '0')}`;
}

async function rpc(name, parameters) {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw error;
  return data;
}

async function loadWallet() {
  const wallet = await rpc('takapathai_wallet');
  if (!wallet) {
    screen(pinForm);
    return;
  }
  byId('friends-owner').textContent = `@${wallet.handle}`;
  byId('friends-balance').textContent = money(wallet.balance);
  const history = byId('friends-history');
  history.replaceChildren();
  if (!wallet.transfers.length) {
    const row = document.createElement('li');
    row.textContent = 'No transfers yet.';
    history.append(row);
  }
  for (const transfer of wallet.transfers) {
    const row = document.createElement('li');
    const details = document.createElement('div');
    const title = document.createElement('strong');
    const date = document.createElement('time');
    const direction = transfer.sent ? 'Sent to' : 'Received from';
    const label = transfer.kind === 'cashout' ? 'Demo Cash Out · ' : '';
    title.textContent = `${label}${direction} •••• ${transfer.handle_suffix}`;
    date.dateTime = transfer.created_at;
    date.textContent = formatDate.format(new Date(transfer.created_at));
    details.append(title, date);
    const amount = document.createElement('strong');
    amount.textContent = `${transfer.sent ? '−' : '+'}${money(transfer.amount)}`;
    row.append(details, amount);
    history.append(row);
  }
  screen(walletView);
}

async function run(button, action) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  message('friends-error', '');
  message('friends-status', '');
  try {
    await action();
  } catch (error) {
    if (error.status === 401 || error.code === 'PGRST301') {
      await client.auth.signOut({ scope: 'local' });
      logout.hidden = true;
      pinForm.reset();
      sendForm.reset();
      kindInput.dispatchEvent(new Event('change'));
      pendingTransfer = undefined;
      clearMatch();
      screen(googleButton);
      message('friends-error', 'Your session expired. Sign in with Google again.');
    } else {
      message('friends-error', error.message ?? 'Something went wrong. Try again.');
    }
  } finally {
    button.disabled = false;
    busy = false;
  }
}

function submit(form, action) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run(event.submitter ?? form.querySelector('button[type=submit]'), action);
  });
}

googleButton.addEventListener('click', () => run(googleButton, async () => {
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: new URL('friends.html', window.location.href).href },
  });
  if (error) throw error;
}));

submit(pinForm, async () => {
  const pin = byId('friends-new-pin').value;
  if (pin !== byId('friends-repeat-pin').value) throw new Error('The two PIN entries do not match.');
  await rpc('takapathai_create_wallet', { p_handle: walletHandle(byId('friends-handle').value), p_pin: pin });
  pinForm.reset();
  await loadWallet();
  message('friends-status', 'Your demo wallet is ready.');
});

function clearMatch() {
  matchedHandle = undefined;
  message('friends-match', '');
}

recipientInput.addEventListener('input', clearMatch);
kindInput.addEventListener('change', () => {
  byId('friends-cashout-help').hidden = kindInput.value !== 'cashout';
  sendForm.querySelector('button[type=submit]').textContent = kindInput.value === 'cashout' ? 'Cash out demo taka' : 'Send demo taka';
});

const findButton = byId('friends-find');
findButton.addEventListener('click', () => run(findButton, async () => {
  clearMatch();
  const input = recipientInput.value;
  const handle = walletHandle(input);
  const found = await rpc('takapathai_find_wallet', { p_handle: handle });
  if (recipientInput.value !== input) return;
  if (!found) throw new Error('No other wallet found for this username.');
  matchedHandle = handle;
  message('friends-match', `Wallet found: @${handle}`);
}));

submit(sendForm, async () => {
  const recipient = walletHandle(recipientInput.value);
  if (matchedHandle !== recipient) throw new Error('Find the recipient’s wallet first.');
  const kind = kindInput.value;
  const amount = parseAmount(byId('friends-amount').value);
  if (amount === null) throw new Error('Enter a positive amount with up to two decimal places.');
  if (pendingTransfer?.recipient !== recipient || pendingTransfer.amount !== amount || pendingTransfer.kind !== kind) {
    pendingTransfer = { recipient, amount, kind, id: crypto.randomUUID() };
  }
  const { id, error } = await rpc('takapathai_send', {
    p_handle: recipient, p_amount: amount, p_pin: byId('friends-send-pin').value, p_request_id: pendingTransfer.id, p_kind: kind,
  });
  pendingTransfer = undefined;
  if (error) throw new Error(error);
  sendForm.reset();
  kindInput.dispatchEvent(new Event('change'));
  clearMatch();
  const action = kind === 'cashout' ? 'Demo Cash Out' : 'Transfer';
  message('friends-status', `${action} completed. ${money(amount)} sent to @${recipient}. ID: ${id}`);
  await loadWallet();
});

byId('friends-refresh').addEventListener('click', (event) => run(event.currentTarget, loadWallet));
logout.addEventListener('click', () => run(logout, async () => {
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw error;
  pinForm.reset();
  sendForm.reset();
  kindInput.dispatchEvent(new Event('change'));
  clearMatch();
  pendingTransfer = undefined;
  logout.hidden = true;
  screen(googleButton);
}));

async function initialize() {
  if (!friendsConfig.url || !friendsConfig.publishableKey) {
    message('friends-status', 'Friends Wallet will be available after the operator connects Google sign-in.');
    return;
  }
  if (new URL(friendsConfig.url).protocol !== 'https:' || !friendsConfig.publishableKey.startsWith('sb_publishable_')) {
    throw new Error('Friends Wallet needs a Supabase HTTPS URL and publishable key.');
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
  client = createClient(friendsConfig.url, friendsConfig.publishableKey, { auth: { flowType: 'pkce' } });
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  googleButton.disabled = false;
  const callback = new URL(window.location.href);
  if (callback.searchParams.has('error') || new URLSearchParams(callback.hash.slice(1)).has('error')) {
    window.history.replaceState(null, '', callback.pathname);
    message('friends-error', 'Google sign-in did not finish. Try again.');
  }
  if (data.session) {
    if (!data.session.user.identities?.some((identity) => identity.provider === 'google')) {
      await client.auth.signOut({ scope: 'local' });
      screen(googleButton);
      message('friends-status', 'Continue with Google to open Friends Wallet.');
      return;
    }
    logout.hidden = false;
    await loadWallet();
  } else {
    screen(googleButton);
  }
  message('friends-status', '');
}

initialize().catch((error) => {
  message('friends-status', '');
  message('friends-error', error.message ?? 'Friends Wallet could not load.');
  if (client && logout.hidden) googleButton.disabled = false;
});
