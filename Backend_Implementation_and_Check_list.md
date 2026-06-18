# QuickSend Backend — Implementation & Checklist

## Overview
QuickSend Backend is an Express + TypeScript + Prisma API for the QuickSend platform. It covers auth, wallets, transfers, payouts, treasury, compliance, and admin — deployable on Railway with PostgreSQL.

## Architecture

```
QuickSend-Backend/
├── prisma/
│   └── schema.prisma              # 28 models
├── src/
│   ├── config/                    # env, database (Prisma singleton)
│   ├── middleware/                 # auth, errorHandler, rateLimiter
│   ├── utils/                     # token, logger, prisma.d.ts
│   ├── modules/
│   │   ├── auth/                  # Register, login, refresh, logout, me
│   │   ├── user/                  # Profile management
│   │   ├── wallet/                # Wallet CRUD, addresses, transactions
│   │   ├── ledger/                # Double-entry bookkeeping
│   │   ├── beneficiary/           # Beneficiary CRUD
│   │   ├── fx/                    # FX rate service
│   │   ├── fees/                  # Fee calculation engine
│   │   ├── quote/                 # Transfer quote generation
│   │   ├── transfer/              # Transfer orchestration + CRUD
│   │   ├── payout/                # Payout execution + tracking
│   │   ├── routing/               # Partner routing logic
│   │   ├── partners/              # Bank, Mobile Money, Cash adapters
│   │   ├── queue/                 # Async job queue (console stub)
│   │   ├── webhook/               # Partner webhook receiver
│   │   ├── treasury/              # Treasury management
│   │   ├── liquidity/             # Liquidity monitoring
│   │   ├── sweep/                 # Auto sweep engine
│   │   ├── risk/                  # Risk scoring engine
│   │   ├── kyc/                   # KYC profile + document management
│   │   ├── aml/                   # AML transaction monitoring
│   │   ├── sanctions/             # Sanctions screening
│   │   ├── compliance/            # Compliance orchestrator
│   │   ├── audit/                 # Audit logging (console stub)
│   │   ├── reconciliation/        # Settlement reconciliation
│   │   └── admin/                 # Admin control tower (11 endpoints)
│   ├── app.ts                     # Express app setup
│   └── server.ts                  # Server entry point
├── railway.json                   # Railway deployment config
├── tsconfig.json
└── package.json
```

## Tech Stack
- **Runtime:** Node.js, TypeScript 6
- **Framework:** Express 5
- **ORM:** Prisma 6 (PostgreSQL)
- **Auth:** JWT (jsonwebtoken)
- **Validation:** Zod 4
- **Security:** express-rate-limit, helmet, cors
- **Deploy:** Railway (Nixpacks)

---

## Checklist

### 1. Project Configuration
- [x] `package.json` with all dependencies (0 vulnerabilities)
- [x] `tsconfig.json` — strict mode, ES2023 target
- [x] `.env` — 7 env vars with development defaults
- [x] `.gitignore` — node_modules, dist, .env, *.log, .prisma/
- [x] `railway.json` — Nixpacks build, health check, restart policy
- [x] `README.md` — project docs, API reference, deploy guide

### 2. Config & Database
- [x] `src/config/env.ts` — typed ENV object (PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN, CORS_ORIGIN)
- [x] `src/config/database.ts` — PrismaClient singleton with dev logging
- [x] Prisma schema with 28 models (see § Schema)

### 3. Middleware
- [x] `auth.ts` — `authenticate` (JWT Bearer verification), `optionalAuth`, `requireRole(...roles)` factory, `AuthRequest` interface
- [x] `errorHandler.ts` — global handler, `AppError` class, ZodError 400, fallback 500
- [x] `rateLimiter.ts` — `apiLimiter` (100 req/15min), `authLimiter` (10 req/15min)

### 4. Utilities
- [x] `token.ts` — `generateToken()`, `generateRefreshToken()`, `verifyToken()`
- [x] `logger.ts` — structured console wrapper with levels (debug/info/warn/error)
- [x] `@types/prisma.d.ts` — TypeScript declaration for `@prisma/client`

### 5. App Entry
- [x] `src/app.ts` — Express app with:
  - Helmet, CORS, JSON parser, URL-encoded parser
  - Global API rate limiter
  - Auth rate limiter on `/auth` routes
  - 11 route module mounts under `/api/v1/*`
  - Health check at `GET /health`
  - Global error handler
- [x] `src/server.ts` — server start with port binding, startup log

### 6. Auth Module (`src/modules/auth/`)
- [x] Route: `POST /api/v1/auth/register` — user registration
- [x] Route: `POST /api/v1/auth/login` — login, returns JWT + refresh token
- [x] Route: `POST /api/v1/auth/refresh` — refresh token rotation
- [x] Route: `POST /api/v1/auth/logout` — invalidate session
- [x] Route: `GET /api/v1/auth/me` — current user profile

### 7. User Module (`src/modules/user/`)
- [x] Route: `PUT /api/v1/users/profile` — update profile

### 8. Wallet Module (`src/modules/wallet/`)
- [x] Route: `GET /api/v1/wallet` — get wallet balance
- [x] Route: `GET /api/v1/wallet/addresses` — list deposit addresses
- [x] Route: `GET /api/v1/wallet/transactions` — transaction history
- [x] Route: `POST /api/v1/wallet/withdraw` — request withdrawal

### 9. Beneficiary Module (`src/modules/beneficiary/`)
- [x] Route: `GET /api/v1/beneficiaries` — list beneficiaries
- [x] Route: `POST /api/v1/beneficiaries` — create beneficiary
- [x] Route: `PUT /api/v1/beneficiaries/:id` — update beneficiary
- [x] Route: `DELETE /api/v1/beneficiaries/:id` — delete beneficiary

### 10. Ledger Service (`src/modules/ledger/`)
- [x] `LedgerService` class — `credit()`, `debit()`, `getBalance()`
- [x] Double-entry bookkeeping (CREDIT / DEBIT entries)

### 11. FX Service (`src/modules/fx/`)
- [x] `FxService` class — `getRate(from, to)` → mock rate or DB lookup

### 12. Fee Service (`src/modules/fees/`)
- [x] `FeeService` class — `calculate(country, method, amount)` → `{fee, fixedFee, percentFee}`

### 13. Quote Module (`src/modules/quote/`)
- [x] Route: `POST /api/v1/transfers/quote` — generates transfer quote with FX + fees

### 14. Transfer Module (`src/modules/transfer/`)
- [x] `TransferOrchestrator` class — `createTransfer()` with validation
- [x] Route: `POST /api/v1/transfers` — create transfer
- [x] Route: `GET /api/v1/transfers` — list transfers
- [x] Route: `GET /api/v1/transfers/:id` — get transfer details

### 15. Payout Module (`src/modules/payout/`)
- [x] `PayoutOrchestrator` class — `execute(transfer)` → creates PayoutOrder
- [x] Route: `POST /api/v1/payout/execute` — execute payout
- [x] Route: `GET /api/v1/payout/:id` — get payout status
- [x] Route: `POST /api/v1/payout/:id/retry` — retry failed payout

### 16. Partner Adapters (`src/modules/partners/`)
- [x] `BankAdapter` — `sendPayout()` → mock success
- [x] `MobileMoneyAdapter` — `sendPayout()` → mock success
- [x] `CashPickupAdapter` — `sendPayout()` → mock success

### 17. Routing Service (`src/modules/routing/`)
- [x] `RoutingService` class — `resolve(transfer)` → selects partner adapter

### 18. Queue Service (`src/modules/queue/`)
- [x] `QueueService` class — `publish(queue, message)`, `processPayouts()` (console-only stub)

### 19. Webhook Module (`src/modules/webhook/`)
- [x] Route: `POST /api/v1/webhook/payout-update` — partner callback
- [x] No auth (partner callbacks)

### 20. Treasury Module (`src/modules/treasury/`)
- [x] `TreasuryOrchestrator` class — `rebalance(network)`
- [x] Route: `GET /api/v1/treasury/overview` — treasury summary
- [x] Route: `GET /api/v1/treasury/liquidity` — liquidity snapshots
- [x] Route: `POST /api/v1/treasury/rebalance` — trigger rebalance (SUPER_ADMIN, TREASURY)

### 21. Liquidity Service (`src/modules/liquidity/`)
- [x] `LiquidityService` class — `snapshot()` → computes HOT/WARM/COLD balances per network

### 22. Sweep Service (`src/modules/sweep/`)
- [x] `SweepService` class — `execute()` → moves HOT → WARM → COLD

### 23. KYC Module (`src/modules/kyc/`)
- [x] Route: `GET /api/v1/kyc/status` — get KYC profile status
- [x] Route: `POST /api/v1/kyc/upload` — upload document
- [x] Route: `POST /api/v1/kyc/upgrade-tier` — request tier upgrade

### 24. AML Service (`src/modules/aml/`)
- [x] `AmlService` class — `analyze(transaction)` → `{riskLevel, flags}`

### 25. Sanctions Service (`src/modules/sanctions/`)
- [x] `SanctionsService` class — `check(name)` → `{match, source}` (mock)

### 26. Risk Engine (`src/modules/risk/`)
- [x] `RiskEngine` class — `calculate(userId, transaction)` → `{score, level, factors}`

### 27. Compliance Orchestrator (`src/modules/compliance/`)
- [x] `ComplianceOrchestrator` class — `evaluate(user, transaction)` → combines risk + AML + sanctions

### 28. Audit Service (`src/modules/audit/`)
- [x] `AuditService` class — `log(data)` → console output (stub)

### 29. Reconciliation Service (`src/modules/reconciliation/`)
- [x] `ReconciliationService` class — `verify()` → `{total, verified, failed}` (mock)

### 30. Admin Module (`src/modules/admin/`)
- [x] Route: `GET /api/v1/admin/dashboard` — dashboard KPIs
- [x] Route: `GET /api/v1/admin/users` — list users
- [x] Route: `POST /api/v1/admin/users/:id/toggle-status` — freeze/activate (SUPER_ADMIN)
- [x] Route: `GET /api/v1/admin/kyc/pending` — pending KYC list
- [x] Route: `POST /api/v1/admin/kyc/:id/approve` — approve KYC
- [x] Route: `POST /api/v1/admin/kyc/:id/reject` — reject KYC
- [x] Route: `GET /api/v1/admin/compliance-cases` — compliance cases
- [x] Route: `POST /api/v1/admin/compliance-cases/:id/escalate` — escalate case
- [x] Route: `GET /api/v1/admin/payouts/failed` — failed payouts
- [x] Route: `POST /api/v1/admin/payouts/:id/retry` — retry payout
- [x] Route: `GET /api/v1/admin/fraud/analyze/:userId` — fraud analysis

### 31. Prisma Schema (28 Models)
#### User & Auth
- [x] `User` — id, email, password, name, status, role, timestamps
- [x] `AdminUser` — admin-specific profile
- [x] `AdminActionLog` — audit trail for admin actions
- [x] `SystemAlert` — system-level alerts

#### Wallet & Ledger
- [x] `Wallet` — user wallet, available/ledger/pending balances
- [x] `WalletAddress` — deposit addresses per network
- [x] `WalletTransaction` — transaction history
- [x] `LedgerEntry` — double-entry accounting records

#### Transfers & Payouts
- [x] `Beneficiary` — saved beneficiaries
- [x] `FxRate` — exchange rate records
- [x] `FeeRule` — fee configuration rules
- [x] `Transfer` — transfer orders
- [x] `PayoutOrder` — payout execution records
- [x] `PayoutEvent` — payout lifecycle events
- [x] `PartnerLog` — partner integration logs

#### Treasury
- [x] `TreasuryWallet` — operational wallets (HOT/WARM/COLD per network)
- [x] `TreasuryMovement` — fund movements between wallets
- [x] `LiquiditySnapshot` — periodic liquidity snapshots

#### Compliance
- [x] `KycProfile` — KYC tier and verification status
- [x] `KycDocument` — uploaded documents
- [x] `AmlCheck` — AML screening records
- [x] `SanctionsHit` — sanctions screening results
- [x] `ComplianceCase` — compliance case management
- [x] `RiskScore` — risk scoring records

#### Infrastructure
- [x] `IdempotencyKey` — idempotency for retries
- [x] `Event` — event log
- [x] `Notification` — notification records
- [x] `NotificationDelivery` — delivery tracking

### 32. Build & Quality
- [x] TypeScript compilation: 0 errors (`tsc --noEmit`)
- [x] Full build: 0 errors (`tsc` → `dist/`)
- [x] npm install: 0 vulnerabilities
- [x] Prisma client generation: successful

### 33. Deployment (Railway)
- [x] `railway.json` — Nixpacks builder config
- [x] Build command: `npm install && npx prisma generate && npm run build`
- [x] Start command: `npm run start` (node dist/server.js)
- [x] Health check: `GET /health` (10s timeout)
- [x] Restart policy: on failure, 5 max retries

---

## API Endpoints Summary (42 endpoints)

| Module | Mount | Endpoints |
|--------|-------|-----------|
| Health | `/health` | 1 |
| Auth | `/api/v1/auth` | 5 |
| User | `/api/v1/users` | 1 |
| Wallet | `/api/v1/wallet` | 4 |
| Beneficiary | `/api/v1/beneficiaries` | 4 |
| Quote | `/api/v1/transfers/quote` | 1 |
| Transfer | `/api/v1/transfers` | 3 |
| Payout | `/api/v1/payout` | 3 |
| Treasury | `/api/v1/treasury` | 3 |
| KYC | `/api/v1/kyc` | 3 |
| Admin | `/api/v1/admin` | 11 |
| Webhook | `/api/v1/webhook` | 1 |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | Environment |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/quicksend` | PostgreSQL connection |
| `JWT_SECRET` | `change-this-in-production-min-32-chars-long` | JWT signing secret |
| `JWT_EXPIRES_IN` | `15m` | Access token TTL |
| `REFRESH_TOKEN_EXPIRES_IN` | `7d` | Refresh token TTL |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |

---

## Future Enhancements
- [ ] Create `prisma/seed.ts` — referenced by `db:seed` script but missing
- [ ] Add unit tests (Jest + Supertest)
- [ ] Replace console queue with real message broker (RabbitMQ / Redis)
- [ ] Replace console audit with database-persisted audit log
- [ ] Add pagination to list endpoints (users, transfers, transactions)
- [ ] Add OpenAPI / Swagger documentation
- [ ] Add request validation schemas (Zod) to all route handlers
- [ ] Add database migration workflow (instead of `prisma db push`)
- [ ] Fix duplicate `/quote` route (one in `quote.routes.ts`, one in `transfer.routes.ts`)
- [ ] Add `authenticate` middleware to `transfer.routes.ts` POST `/quote`
