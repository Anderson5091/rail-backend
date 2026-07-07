import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateModelId } from "../utils/id-generator";

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
  agentLedgerEntry: any;
  feeConfig: any;
  kycEvent: any;
}

const xprisma = (prismaRaw as any).$extends({
  query: {
    $allModels: {
      async create({ model, args, query }: any) {
        const id = generateModelId(model, args.data);
        if (id && !args.data.id) {
          args.data.id = id;
        }
        return query(args);
      },
      async createMany({ model, args, query }: any) {
        if (Array.isArray(args.data)) {
          for (const record of args.data) {
            if (!record.id) {
              const id = generateModelId(model, record);
              if (id) record.id = id;
            }
          }
        }
        return query(args);
      },
    },
  },
}) as any;

export const prisma = xprisma as unknown as ExtendedPrismaClient;
