# TakaPathai

<img src="assets/logo-full.png" width="240" alt="TakaPathai">

A mobile wallet simulator for practicing transfers, deposits, cash outs, and bill payments. The public demo runs in your browser with sample data. Friends Wallet is an optional mode for sending demo taka between Google accounts.

[![Open live demo](https://img.shields.io/badge/Open-Live_demo-087F68?style=for-the-badge)](https://takapathai.vercel.app/)

## Try the standalone wallet

- **Login** with demo mobile number `01700000000` and PIN `1234`. The **Log Out** button returns to login.
- **Transfer Money** to an 11-digit demo account, **Add Money** from a demo bank, or **Cash Out** to a demo agent. These actions use PIN `1234`.
- **Get Bonus** with coupon `TAKAPATHAI` for a one-time $100 demo credit.
- **Pay Bill** to a demo biller using a biller account and PIN. Each successful transaction opens a confirmation with its details, the new balance, and a Back to Home button.
- **Transactions** opens history. **View All** expands the list, and the three-dot button opens the payment details.

The first visit shows the mockup’s $45000 balance and four sample payments. Transfer $350 to `01800000001`, add $1000 using bank account `01900000001`, and cash out $200 to `01600000001`. Claim the bonus and pay $150 to an Electricity biller account such as `100001`. The balance should be **$45400**. Open Transactions, choose View All, and refresh to verify the history. An earlier demo installation keeps its existing numeric balance and saved records.

## Run locally

Run the following from the project directory with Python 3.

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Keep the command running and open [the local demo](http://localhost:8000/). Use a current browser with JavaScript and browser storage enabled. The transaction flow uses Web Locks, so run it over localhost or HTTPS.

Run the unit tests with a current Node.js release.

```sh
npm test
```

## Friends Wallet

**Deployment status:** The public demo runs in standalone mode. Friends Wallet requires a hosted Supabase project, Google OAuth credentials, and the setup below before visitors can sign in or transfer demo taka across devices.

Open **Friends Wallet** and continue with Google. Choose a unique 11-digit username in Bangladesh mobile format and set a four-digit transfer PIN. The wallet starts with ৳50,000 once per Google-linked account. The digits are an alias that other signed-in wallet users can find by exact match. Google verifies the sign-in identity. The alias does not certify ownership of a mobile number.

Choose **Transfer Money** or **Demo Cash Out**, find the recipient’s wallet by username, enter the amount and PIN, then submit. Demo Cash Out credits the chosen wallet as the simulated agent. The recipient sees the credit after refreshing. Both actions use demo balances.

1. In Supabase SQL Editor, run `supabase/friends-wallet.sql`. For an existing Friends Wallet project, this also migrates previously registered digits to usernames and preserves balances, PINs, and history. Legacy wallets stay tied to their original Supabase user IDs. A Google identity must be linked to that same user ID to access a legacy wallet. A separate Google account does not acquire a legacy wallet by entering its digits.
2. Create a Google OAuth web client and register the Supabase Auth callback as its authorized redirect URI. Enable Google in Supabase Auth and enter that OAuth client ID and secret there. Use Google as the Friends Wallet sign-in provider. Disable the old phone provider if this project was using it only for Friends Wallet. [Google setup for Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
3. Add the exact local and deployed `friends.html` URLs to the Supabase redirect allow list, for example `http://localhost:8000/friends.html` and `https://takapathai.vercel.app/friends.html`. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
4. Put the Supabase HTTPS URL and **publishable** key in `friends-config.js`. Keep the Google client secret in Supabase Auth. Push the updated files to the production branch.
5. In two Google accounts, set up distinct wallet usernames. Send ৳100 from the first to the second and refresh both wallets. Their balances should become ৳49,900 and ৳50,100. Use Demo Cash Out to send it back and verify both history entries.

The PIN is stored as a salted hash on the server. The sender and recipient balances change in one database transaction, and a retry with the same transfer request ID returns the original transaction. Friends Wallet uses fictional balances and supports transfers within the app.

## Deployment

The repository is connected to Vercel. Vercel deploys the root of the main branch as a static site using the **Other** preset. The app does not need a build command. Open the live demo and use the standalone wallet steps above to verify a deployment.

## How it works

- `wallet.js` validates transactions and derives the balance from the opening amount and a ledger. Amounts are stored as integer cents.
- `app.js` handles the demo session, forms, payment details, and storage. It reads earlier demo data and retains only the final four digits of new transaction account numbers. Browser tabs serialize writes.
- `wallet.test.mjs` checks the ledger, amount parsing, legacy migration, balance limits, and invalid saved data.

The standalone demo stores its data in the current browser. Each site address has its own browser storage. The layout was inspired by the Programming Hero mobile wallet exercise. The release includes the TakaPathai logo and uses typographic action symbols.

Friends Wallet keeps PIN hashes and balances in a private database schema. Signed-in users can look up an exact wallet username up to 20 times per minute. The server checks the PIN and balance, and updates both wallets in one database transaction. The phone-shaped username is a chosen alias. Use fictional digits for demos.

The standalone login uses public sample credentials and browser storage. Use sample account numbers and PINs only. The project does not connect to banks or move real funds.
