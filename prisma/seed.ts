import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvFile } from "process";
import bcrypt from "bcryptjs";

loadEnvFile(".env");

const adapter = new PrismaPg(process.env.DATABASE_URL || "");
const prisma = new PrismaClient({ adapter });

const ADMINS = [
  { email: "admin@quicksend.com", password: "admin123", role: "SUPER_ADMIN" },
  { email: "compliance@quicksend.com", password: "compliance123", role: "COMPLIANCE" },
  { email: "ops@quicksend.com", password: "ops123", role: "OPS" },
  { email: "treasury@quicksend.com", password: "treasury123", role: "TREASURY" },
];

async function main() {
  console.log("Clearing all data...");

  // Delete in FK-safe order
  await prisma.notificationDelivery.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.event.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.partnerSlaMetric.deleteMany();
  await prisma.partnerWebhook.deleteMany();
  await prisma.partnerTransaction.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.riskScore.deleteMany();
  await prisma.complianceCase.deleteMany();
  await prisma.sanctionsHit.deleteMany();
  await prisma.amlCheck.deleteMany();
  await prisma.kycDocument.deleteMany();
  await prisma.kycProfile.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.depositAddress.deleteMany();
  await prisma.depositRequest.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.walletAddress.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.userCryptoWallet.deleteMany();
  await prisma.otpCode.deleteMany();
  await prisma.payoutEvent.deleteMany();
  await prisma.partnerLog.deleteMany();
  await prisma.payoutOrder.deleteMany();
  await prisma.transfer.deleteMany();
  await prisma.beneficiary.deleteMany();
  await prisma.fxRate.deleteMany();
  await prisma.feeRule.deleteMany();
  await prisma.treasuryMovement.deleteMany();
  await prisma.treasuryWallet.deleteMany();
  await prisma.liquiditySnapshot.deleteMany();
  await prisma.adminActionLog.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.user.deleteMany();

  console.log("All data cleared.");

  // Seed admins
  for (const admin of ADMINS) {
    const passwordHash = await bcrypt.hash(admin.password, 12);
    await prisma.adminUser.create({
      data: {
        email: admin.email,
        passwordHash,
        role: admin.role,
        status: "ACTIVE",
      },
    });
    console.log(`Created admin ${admin.email} (${admin.role})`);
  }

  // Seed user
  const passwordHash = await bcrypt.hash("12345678", 12);
  await prisma.user.create({
    data: {
      email: "anderson5091@gmail.com",
      phone: "+50934552439",
      phoneVerified: true,
      password: passwordHash,
      fullName: "Anderson Nazaire",
    },
  });
  console.log("Created user: Anderson Nazaire (anderson5091@gmail.com)");

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
