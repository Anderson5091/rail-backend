import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { generateModelId } from "../src/utils/id-generator";

dotenv.config();

const adapter = new PrismaPg(process.env.DATABASE_URL || "");
const prisma = new PrismaClient({ adapter });

const ADMINS = [
  { email: "admin@quicksend.com", password: "admin123", role: "SUPER_ADMIN" },
  { email: "compliance@quicksend.com", password: "compliance123", role: "COMPLIANCE" },
  { email: "ops@quicksend.com", password: "ops123", role: "OPS" },
  { email: "treasury@quicksend.com", password: "treasury123", role: "TREASURY" },
];

const TREASURY_WALLETS = [
  { walletType: "HOT", chain: "base-sepolia", network: "BASE", address: "0x68C2DC7147B87d49b2cf683b9dD63F3F97e461b8" },
  { walletType: "WARM", chain: "base-sepolia", network: "BASE", address: "0xea7a7B9C85965c4ce7CeB3B4e2b978F0F2EAB195" },
  { walletType: "COLD", chain: "base-sepolia", network: "BASE", address: "0xFE7Be3090Da132C32367555365E5b80B71ac3C00" },
  { walletType: "HOT", chain: "ethereum-sepolia", network: "ETHEREUM", address: "0x0ec5aD4038FA8233a45Bd90574725aBe464E0dDd" },
  { walletType: "WARM", chain: "ethereum-sepolia", network: "ETHEREUM", address: "0xB6344a9bD24c9F9299DF038086944c063a007a2A" },
  { walletType: "COLD", chain: "ethereum-sepolia", network: "ETHEREUM", address: "0x1Ec833d9AE8b44d9d4B10baf201A607024032eF3" },
  { walletType: "HOT", chain: "solana", network: "SOLANA", address: "8G8sdgViXMJa42FLRQSuta7qqa5Semk2fAEggYDZBbeN" },
  { walletType: "WARM", chain: "solana", network: "SOLANA", address: "CjkH41rHXbbrTJb3bMKVMu5ELG7TuHtu4E11HnHYNnxg" },
  { walletType: "COLD", chain: "solana", network: "SOLANA", address: "GVQ41fgiLeWsXBcQ1myEZKcQJUngZzrBcUYXLiqpkC9T" },
  { walletType: "HOT", chain: "polygon-amoy", network: "POLYGON", address: "0xe6fb5d72925aBb5550e1d5c038e6a8dB9D195bcc" },
  { walletType: "WARM", chain: "polygon-amoy", network: "POLYGON", address: "0xee2Ad0F05B8A9C6B8e362505727BF9a6B04BbCA9" },
  { walletType: "COLD", chain: "polygon-amoy", network: "POLYGON", address: "0x70bdD4d570f5A988E255A23e26Aba8C2A534C8d9" },
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
    await prisma.adminUser.create({
      data: {
        id: generateModelId("AdminUser", admin) || crypto.randomUUID(),
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
    const agent = await prisma.agent.create({
      data: {
        id: generateModelId("Agent", agentData) || crypto.randomUUID(),
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
          agentId: agent.id,
          walletType: wallet.walletType,
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
        id: generateModelId("TreasuryWallet", tw) || crypto.randomUUID(),
        walletType: tw.walletType,
        chain: tw.chain,
        network: tw.network,
        address: tw.address,
        status: "ACTIVE",
      },
    });
    console.log(`Created ${tw.walletType} treasury wallet on ${tw.network}: ${tw.address}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
