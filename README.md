# SKILL2CASH

SKILL2CASH is a V1 full-stack platform for eFootball 1v1 money duels.

**NO SKILL. NO CASH.**

## Features

- JWT registration, login, and current-user session.
- Public player profiles, player search, ranks, badges, win rate, earnings, and availability.
- The SKILL2CASH username is the exact eFootball username. It is locked after registration and can only be changed through admin approval.
- Internal wallet with available, locked, deposited, withdrawn, won, and lost balances.
- Simulated deposits and manual withdrawal requests.
- Challenge flow with accept, decline, counter offer, cancel, and expiration fields.
- Automatic stake locking when a challenge is accepted.
- Duel rooms with Socket.io notifications and private chat.
- Result submission with screenshot URL, automatic settlement when both players agree, and disputes when they do not.
- OCR-assisted match validation with Tesseract.js. Automatic settlement now requires matching player declarations and OCR confirmation with at least 85% confidence.
- Dynamic commission settings: small 10%, medium 8%, high 5%, tournament default 12%.
- Admin dashboard endpoints for users, wallets, duels, disputes, withdrawals, balance adjustments, bans, and commission settings.
- Cyberpunk dark React UI for player and admin flows.

## Developer
by SOLITAIRE HACK

## Stack

- Backend: Node.js, Express, MongoDB, Mongoose, JWT, bcrypt, Socket.io.
- Frontend: React, Vite, lucide-react, Socket.io client.
- Payments: simulated V1 deposit and withdrawal architecture ready for Mobile Money, Stripe, crypto, bank, or manual processors.

## Setup

1. Provide a MongoDB Atlas URI or a MongoDB replica set URI.
2. Install dependencies:

```bash
npm run install:all
npm install
```

3. Create environment files:

```bash
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

4. Seed the commission settings for a persistent MongoDB/Atlas database:

```bash
npm run seed
```

Wallet operations use MongoDB transactions. `dev:mongo` is meant for MongoDB Atlas, a MongoDB replica set, or mongos. If you only have a standalone local MongoDB server in development, the app falls back to an in-memory replica set so the whole site still runs safely.

No replica set available locally? Start an in-memory replica set API for quick testing:

```bash
npm run start:memory --prefix backend
```

5. Start the app with the safe in-memory database:

```bash
npm run dev
```

Or start with your persistent MongoDB/Atlas URI:

```bash
npm run dev:mongo
```

Backend: `http://localhost:5000`

Frontend: `http://localhost:5173`

If you need an admin account for a fresh deployment, create one with `npm run create-admin --prefix backend`.
You can override the bootstrap admin identity with `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `backend/.env`.

## API Summary

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

Users:

- `GET /api/users`
- `GET /api/users/search`
- `GET /api/users/:id`
- `PATCH /api/users/profile`
- `POST /api/users/username-change-requests`
- `GET /api/users/username-change-requests/me`

Wallet:

- `GET /api/wallet`
- `GET /api/wallet/deposit-methods`
- `POST /api/wallet/deposit`
- `GET /api/wallet/deposits`
- `POST /api/wallet/withdraw`
- `GET /api/wallet/transactions`

Challenges:

- `POST /api/challenges`
- `GET /api/challenges/incoming`
- `GET /api/challenges/outgoing`
- `POST /api/challenges/:id/accept`
- `POST /api/challenges/:id/decline`
- `POST /api/challenges/:id/counter`
- `POST /api/challenges/:id/cancel`

Duels:

- `GET /api/duels`
- `GET /api/duels/:id`
- `POST /api/duels/:id/result`
- `POST /api/duels/:id/dispute`

Leaderboard:

- `GET /api/leaderboard`

Admin:

- `GET /api/admin/overview`
- `GET /api/admin/users`
- `GET /api/admin/deposits`
- `POST /api/admin/deposits/:id/approve`
- `POST /api/admin/deposits/:id/reject`
- `GET /api/admin/username-change-requests`
- `POST /api/admin/username-change-requests/:id/approve`
- `POST /api/admin/username-change-requests/:id/reject`
- `GET /api/admin/duels`
- `GET /api/admin/disputes`
- `POST /api/admin/disputes/:id/resolve`
- `POST /api/admin/withdrawals/:id/approve`
- `POST /api/admin/withdrawals/:id/reject`
- `POST /api/admin/users/:id/ban`
- `POST /api/admin/users/:id/adjust-balance`
- `GET /api/admin/commissions`
- `POST /api/admin/commissions`

## Business Rules

- Funds are locked only when a challenge is accepted.
- Both players must have enough available balance before a duel starts.
- Every wallet action writes a transaction.
- Duel settlement is calculated on the backend.
- Disputes keep funds locked until admin resolution.
- OCR is never allowed to pay on uncertainty. Low confidence, missing usernames, mismatched scores, or OCR failure sends the duel to admin dispute review.
- OCR validation requires the two detected names to match the two official SKILL2CASH usernames, which must be the users' exact eFootball names.
- Withdrawals are manual in V1.
- Users cannot challenge themselves.

## Manual Deposits

Wave and MTN deposits are manual in V1. A player submits the amount, sender name, sender phone, optional reference, and a screenshot proof. The wallet is not credited while the deposit is `pending`.

Only an admin approval credits the wallet and writes a successful `deposit` transaction. Rejections never change wallet balances.
