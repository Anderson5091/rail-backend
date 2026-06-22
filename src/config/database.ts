import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL || "");

const prismaRaw = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

export interface ExtendedPrismaClient extends PrismaClient {
  depositRequest: any;
  depositWallet: any;
  withdrawal: any;
  otpCode: any;
  agent: any;
  agentWallet: any;
  agentTransaction: any;
  agentKpi: any;
}

export const prisma = prismaRaw as ExtendedPrismaClient;
