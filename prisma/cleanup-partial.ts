import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
dotenv.config();
const adapter = new PrismaPg(process.env.DATABASE_URL || "");
const prisma = new PrismaClient({ adapter });
async function main() {
  await prisma.agentWallet.deleteMany({ where: { agent: { email: { contains: "quicksend.com" } } } });
  await prisma.agent.deleteMany({ where: { email: { contains: "quicksend.com" } } });
  console.log("Cleaned up");
}
main().finally(() => prisma.$disconnect());
