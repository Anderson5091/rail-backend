import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADMINS = [
  { email: "admin@quicksend.com", password: "admin123", role: "SUPER_ADMIN" },
  { email: "compliance@quicksend.com", password: "compliance123", role: "COMPLIANCE" },
  { email: "ops@quicksend.com", password: "ops123", role: "OPS" },
  { email: "treasury@quicksend.com", password: "treasury123", role: "TREASURY" },
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
