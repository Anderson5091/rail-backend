# Backend Project for Railway Deployment

This document outlines the Express + TypeScript backend project created for QuickSend, deployable on Railway with PostgreSQL.

## Project Structure

```
QuickSend-Backend/
├── prisma/
│   └── schema.prisma          # Full schema (25 models, all sprints)
├── src/
│   ├── config/
│   │   ├── env.ts             # Environment variable config
│   │   └── database.ts        # Prisma client singleton
│   ├── middleware/
│   │   ├── auth.ts            # JWT auth + role-based guards
│   │   ├── errorHandler.ts    # Global error handler
│   │   └── rateLimiter.ts     # Rate limiting
│   ├── utils/
│   │   ├── token.ts           # JWT token generation/verification
│   │   └── logger.ts          # Structured logging
│   ├── modules/
│   │   ├── auth/              # Register, login, refresh, me
│   │   ├── user/              # Profile management
│   │   ├── wallet/            # Wallet CRUD, addresses, transactions
│   │   ├── ledger/            # Double-entry bookkeeping
│   │   ├── beneficiary/       # Beneficiary CRUD
│   │   ├── fx/                # FX rate service
│   │   ├── fees/              # Fee calculation engine
│   │   ├── quote/             # Transfer quote generation
│   │   ├── transfer/          # Transfer orchestration + CRUD
│   │   ├── payout/            # Payout execution + tracking
│   │   ├── routing/           # Partner routing logic
│   │   ├── partners/          # Bank, Mobile Money, Cash adapters
│   │   ├── queue/             # Async job queue
│   │   ├── webhook/           # Partner webhook receiver
│   │   ├── treasury/          # Treasury management
│   │   ├── liquidity/         # Liquidity monitoring
│   │   ├── sweep/             # Auto sweep engine
│   │   ├── risk/              # Risk scoring engine
│   │   ├── kyc/               # KYC profile + document management
│   │   ├── aml/               # AML transaction monitoring
│   │   ├── sanctions/         # Sanctions screening
│   │   ├── compliance/        # Compliance orchestrator
│   │   ├── audit/             # Audit logging
│   │   ├── reconciliation/    # Settlement reconciliation
│   │   └── admin/             # Admin control tower (8 endpoints)
│   ├── app.ts                 # Express app setup
│   └── server.ts              # Server entry point
├── railway.json               # Railway deployment config
├── package.json
├── tsconfig.json
├── .env
└── .gitignore
```

## API Endpoints

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |

### Auth (Sprint 1)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | No | User registration |
| POST | `/api/v1/auth/login` | No | User login |
| POST | `/api/v1/auth/refresh` | No | Refresh token |
| POST | `/api/v1/auth/logout` | No | Logout |
| GET | `/api/v1/auth/me` | Yes | Get current user |

### Users
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | `/api/v1/users/profile` | Yes | Update profile |

### Wallet (Sprint 2)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/wallet` | Yes | Get wallet |
| GET | `/api/v1/wallet/addresses` | Yes | Get deposit addresses |
| GET | `/api/v1/wallet/transactions` | Yes | Get transaction history |
| POST | `/api/v1/wallet/withdraw` | Yes | Request withdrawal |

### Beneficiaries (Sprint 3)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/beneficiaries` | Yes | List beneficiaries |
| POST | `/api/v1/beneficiaries` | Yes | Create beneficiary |
| PUT | `/api/v1/beneficiaries/:id` | Yes | Update beneficiary |
| DELETE | `/api/v1/beneficiaries/:id` | Yes | Delete beneficiary |

### Transfers (Sprint 3)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/transfers/quote` | Yes | Get transfer quote |
| POST | `/api/v1/transfers` | Yes | Create transfer |
| GET | `/api/v1/transfers` | Yes | List transfers |
| GET | `/api/v1/transfers/:id` | Yes | Get transfer details |

### Payouts (Sprint 4)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/payout/execute` | Yes | Execute payout |
| GET | `/api/v1/payout/:id` | Yes | Get payout status |
| POST | `/api/v1/payout/:id/retry` | Yes | Retry failed payout |

### Treasury (Sprint 5)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/treasury/overview` | Yes | Treasury overview |
| GET | `/api/v1/treasury/liquidity` | Yes | Liquidity snapshots |
| POST | `/api/v1/treasury/rebalance` | Admin | Trigger rebalance |

### KYC / Compliance (Sprint 6)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/kyc/status` | Yes | KYC status |
| POST | `/api/v1/kyc/upload` | Yes | Upload document |
| POST | `/api/v1/kyc/upgrade-tier` | Yes | Request tier upgrade |

### Admin (Sprint 7)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/admin/dashboard` | Admin | Dashboard KPIs |
| GET | `/api/v1/admin/users` | Admin | User list |
| POST | `/api/v1/admin/users/:id/toggle-status` | Super | Freeze/activate user |
| GET | `/api/v1/admin/kyc/pending` | Admin | Pending KYC list |
| POST | `/api/v1/admin/kyc/:id/approve` | Admin | Approve KYC |
| POST | `/api/v1/admin/kyc/:id/reject` | Admin | Reject KYC |
| GET | `/api/v1/admin/compliance-cases` | Admin | Compliance cases |
| POST | `/api/v1/admin/compliance-cases/:id/escalate` | Admin | Escalate case |
| GET | `/api/v1/admin/payouts/failed` | Admin | Failed payouts |
| POST | `/api/v1/admin/payouts/:id/retry` | Admin | Retry payout |
| GET | `/api/v1/admin/fraud/analyze/:userId` | Admin | Fraud analysis |

### Webhooks
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/webhook/payout-update` | No | Partner payout callback |

## Database Schema (25 Models)
- User, Wallet, WalletAddress, WalletTransaction, LedgerEntry
- Beneficiary, FxRate, FeeRule, Transfer
- PayoutOrder, PayoutEvent, PartnerLog
- TreasuryWallet, TreasuryMovement, LiquiditySnapshot
- KycProfile, KycDocument, AmlCheck, SanctionsHit, ComplianceCase, RiskScore
- IdempotencyKey, Event
- Notification, NotificationDelivery
- AdminUser, AdminActionLog, SystemAlert

## Sprint Coverage
- Sprint 1: Auth system, User management ✅
- Sprint 2: Wallet, Ledger ✅
- Sprint 3: Beneficiaries, FX, Fees, Quotes, Transfers ✅
- Sprint 4: Payout orchestrator, Partners, Queue, Webhooks, Reconciliation ✅
- Sprint 5: Treasury, Liquidity, Sweep ✅
- Sprint 6: KYC, AML, Sanctions, Risk, Compliance, Audit ✅
- Sprint 7: Admin Control Tower (11 endpoints) ✅

## Deployment (Railway)

### Prerequisites
1. Railway account with PostgreSQL plugin
2. Set environment variables in Railway dashboard:
   - `DATABASE_URL` - PostgreSQL connection string
   - `JWT_SECRET` - Strong random string (min 32 chars)
   - `CORS_ORIGIN` - Frontend URL

### Deploy Steps
1. Push to GitHub repository
2. Connect repository to Railway
3. Railway auto-detects `railway.json` config
4. Build: `npm install && npx prisma generate && npm run build`
5. Start: `npm run start`
6. Run migrations: `npx prisma db push`

### Commands
```bash
npm run dev          # Development with hot reload
npm run build        # TypeScript compilation
npm run start        # Production start
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database
npm run db:migrate   # Create migration
```
