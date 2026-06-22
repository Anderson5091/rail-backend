import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

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
      { walletType: "COMMISSION", balance: 5000 },
    ],
  },
  {
    email: "internal@quicksend.com",
    password: "internal123",
    fullName: "Jane Internal",
    type: "INTERNAL",
    wallets: [
      { walletType: "COMMISSION", balance: 2500 },
    ],
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
