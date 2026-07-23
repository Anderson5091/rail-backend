import { prisma } from "../../config/database";
import { liquidityEnforcer } from "../liquidity/liquidity-enforcer.service";

export class LedgerService {
  async credit(walletId: string, amount: number, reference?: string, comment?: string) {
    return prisma.$transaction(async (tx: any) => {
      const entry = await tx.ledgerEntry.create({
        data: {
          walletId,
          type: "CREDIT",
          amount,
          reference,
          comment,
          uniqueKey: reference ? `credit_${reference}` : undefined,
        },
      });

      await tx.systemObligation.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          userLedgerObligation: amount,
          agentLedgerObligation: 0,
          pendingObligation: 0,
        },
        update: {
          userLedgerObligation: { increment: amount },
        },
      });

      return entry;
    });
  }

  async debit(walletId: string, amount: number, reference?: string, comment?: string) {
    return prisma.$transaction(async (tx: any) => {
      const entry = await tx.ledgerEntry.create({
        data: {
          walletId,
          type: "DEBIT",
          amount,
          reference,
          comment,
          uniqueKey: reference ? `debit_${reference}` : undefined,
        },
      });

      await tx.systemObligation.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          userLedgerObligation: -amount,
          agentLedgerObligation: 0,
          pendingObligation: 0,
        },
        update: {
          userLedgerObligation: { decrement: amount },
        },
      });

      return entry;
    });
  }

  async getBalance(walletId: string): Promise<number> {
    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId },
    });

    return entries.reduce((balance: number, entry: { type: string; amount: { toString: () => string } }) => {
      return entry.type === "CREDIT" ? balance + Number(entry.amount) : balance - Number(entry.amount);
    }, 0);
  }
}

export const ledgerService = new LedgerService();
