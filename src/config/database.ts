import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL || "");

const prismaRaw = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

export interface ExtendedPrismaClient extends PrismaClient {
  depositRequest: any;
  depositAddress: any;
  withdrawal: any;
  userCryptoWallet: any;
  otpCode: any;
}

export const prisma = prismaRaw as ExtendedPrismaClient;
