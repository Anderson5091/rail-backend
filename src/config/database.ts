import { PrismaClient } from "@prisma/client";

const prismaRaw = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

export interface ExtendedPrismaClient extends PrismaClient {
  depositRequest: any;
  depositWallet: any;
  withdrawal: any;
  userCryptoWallet: any;
}

export const prisma = prismaRaw as ExtendedPrismaClient;
