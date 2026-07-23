import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

function genId(prefix: string): string {
  const bytes = crypto.randomBytes(14);
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let r = "";
  for (let i = 0; i < 14; i++) r += chars[bytes[i] % chars.length];
  return prefix + r;
}

dotenv.config();

const adapter = new PrismaPg(process.env.DATABASE_URL || "");
const prisma = new PrismaClient({ adapter });

const ADMINS = [
  { email: "admin@quicksend.com", password: "admin123", role: "SUPER_ADMIN" },
  { email: "compliance@quicksend.com", password: "compliance123", role: "COMPLIANCE" },
  { email: "ops@quicksend.com", password: "ops123", role: "OPS" },
  { email: "treasury@quicksend.com", password: "treasury123", role: "TREASURY" },
];


const AGENTS = [
  {
    email: "partner@quicksend.com",
    password: "partner123",
    fullName: "John Partner",
    type: "PARTNER",
    wallets: [
      { walletType: "BASE_TREASURY", balance: 100000 },
    ],
  },
  {
    email: "internal@quicksend.com",
    password: "internal123",
    fullName: "Jane Internal",
    type: "INTERNAL",
    wallets: [],
  },
];

async function main() {
  for (const admin of ADMINS) {
    const existing = await prisma.adminUser.findUnique({ where: { email: admin.email } });
    if (existing) {
      console.log(`Admin ${admin.email} already exists — skipping`);
      continue;
    }

    const passwordHash = await bcrypt.hash(admin.password, 12);
    const rolePrefix: Record<string, string> = { SUPER_ADMIN: "QS-SAD", OPS: "QS-OPS", TREASURY: "QS-TRE", COMPLIANCE: "QS-COM" };
    await prisma.adminUser.create({
      data: {
        id: genId(rolePrefix[admin.role] || "QS-ADM"),
        email: admin.email,
        passwordHash,
        role: admin.role,
        status: "ACTIVE",
      },
    });
    console.log(`Created admin ${admin.email} with role ${admin.role}`);
  }

  for (const agentData of AGENTS) {
    const existing = await prisma.agent.findUnique({ where: { email: agentData.email } });
    if (existing) {
      console.log(`Agent ${agentData.email} already exists — skipping`);
      continue;
    }

    const passwordHash = await bcrypt.hash(agentData.password, 12);
    const aPrefix = agentData.type === "INTERNAL" ? "QSIA" : agentData.type === "PARTNER" ? "QSPA" : "QSA";
    const agent = await prisma.agent.create({
      data: {
        id: genId(aPrefix),
        email: agentData.email,
        passwordHash,
        fullName: agentData.fullName,
        type: agentData.type,
        status: "ACTIVE",
      },
    });

    for (const wallet of agentData.wallets) {
      await prisma.agentWallet.create({
        data: {
          id: genId("QSAW"),
          agentId: agent.id,
          network: "BASE",
          chain: "base",
          address: `seed_${agentData.type}_${wallet.walletType}_${agent.id}`,
          balance: wallet.balance,
        },
      });
    }

    console.log(`Created agent ${agentData.email} (${agentData.type}) with wallet(s)`);
  }

  const FEE_CONFIGS = [
    { transactionType: "AGENT_TRANSFER", label: "Agent Transfer", description: "Transfer initiated by agent (cash-in)", systemFeeEnabled: true, systemFeeMode: "BOTH", systemFixedFee: 2, systemPercentFee: 1, processingFeeEnabled: true, processingFeeMode: "FIXED", processingFixedFee: 1, processingPercentFee: 0, superAdminOnly: false },
    { transactionType: "WEB_TRANSFER", label: "Web Transfer", description: "Transfer initiated via web app", systemFeeEnabled: true, systemFeeMode: "BOTH", systemFixedFee: 2, systemPercentFee: 1, processingFeeEnabled: false, processingFeeMode: "FIXED", processingFixedFee: 0, processingPercentFee: 0, superAdminOnly: false },
    { transactionType: "WEB_DEPOSIT", label: "Web Deposit", description: "USDT deposit via web app", systemFeeEnabled: true, systemFeeMode: "FIXED", systemFixedFee: 1, systemPercentFee: 0, processingFeeEnabled: false, processingFeeMode: "FIXED", processingFixedFee: 0, processingPercentFee: 0, superAdminOnly: false },
    { transactionType: "AGENT_DEPOSIT", label: "Agent Deposit", description: "USDT deposit processed by agent", systemFeeEnabled: true, systemFeeMode: "FIXED", systemFixedFee: 1, systemPercentFee: 0, processingFeeEnabled: true, processingFeeMode: "FIXED", processingFixedFee: 0.5, processingPercentFee: 0, superAdminOnly: false },
    { transactionType: "WEB_WITHDRAW", label: "Web Withdraw", description: "USDT withdrawal via web app", systemFeeEnabled: true, systemFeeMode: "FIXED", systemFixedFee: 2, systemPercentFee: 0, processingFeeEnabled: false, processingFeeMode: "FIXED", processingFixedFee: 0, processingPercentFee: 0, superAdminOnly: false },
    { transactionType: "AGENT_CASH_WITHDRAW", label: "Agent Cash Withdraw", description: "Cash withdrawal processed by agent", systemFeeEnabled: true, systemFeeMode: "FIXED", systemFixedFee: 1, systemPercentFee: 0.5, processingFeeEnabled: true, processingFeeMode: "FIXED", processingFixedFee: 1, processingPercentFee: 0, superAdminOnly: false },
    { transactionType: "PAYOUT", label: "Payout", description: "Payout to beneficiary (bank/mobile/cash)", systemFeeEnabled: false, systemFeeMode: "FIXED", systemFixedFee: 0, systemPercentFee: 0, processingFeeEnabled: true, processingFeeMode: "PERCENTAGE", processingFixedFee: 0, processingPercentFee: 0.5, superAdminOnly: false },
    { transactionType: "P2P", label: "Peer to Peer", description: "Internal P2P transfer between users", systemFeeEnabled: true, systemFeeMode: "FIXED", systemFixedFee: 0, systemPercentFee: 0, processingFeeEnabled: false, processingFeeMode: "FIXED", processingFixedFee: 0, processingPercentFee: 0, superAdminOnly: true },
    { transactionType: "AGENT_TOPUP", label: "Agent Topup", description: "Agent-to-agent topup fee", systemFeeEnabled: true, systemFeeMode: "FIXED", systemFixedFee: 1, systemPercentFee: 0, processingFeeEnabled: false, processingFeeMode: "FIXED", processingFixedFee: 0, processingPercentFee: 0, superAdminOnly: false },
  ];

  for (const fc of FEE_CONFIGS) {
    const existing = await prisma.feeConfig.findUnique({ where: { transactionType: fc.transactionType } });
    if (existing) {
      console.log(`Fee config ${fc.transactionType} already exists — skipping`);
      continue;
    }
    await prisma.feeConfig.create({
      data: {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`,
        ...fc,
      },
    });
    console.log(`Created fee config for ${fc.transactionType}`);
  }

  for (const tw of TREASURY_WALLETS) {
    const existing = await prisma.treasuryWallet.findUnique({ where: { address: tw.address } });
    if (existing) {
      console.log(`Treasury wallet ${tw.address} already exists — skipping`);
      continue;
    }

    await prisma.treasuryWallet.create({
      data: {
        id: genId("QSTW"),
        walletType: tw.walletType,
        chain: tw.chain,
        network: tw.network,
        address: tw.address,
        status: "ACTIVE",
      },
    });
    console.log(`Created ${tw.walletType} treasury wallet on ${tw.network}: ${tw.address}`);
  }

  // Seed SystemObligation (idempotent)
  const existingObligation = await prisma.systemObligation.findUnique({ where: { id: "singleton" } });
  if (!existingObligation) {
    await prisma.systemObligation.create({
      data: {
        id: "singleton",
        userLedgerObligation: 0,
        agentLedgerObligation: 0,
        pendingObligation: 0,
      },
    });
    console.log("SystemObligation row created");
  } else {
    console.log("SystemObligation row already exists — skipping");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
