import { prisma } from "../../config/database";

export class LedgerService {
  async credit(walletId: string, amount: number, reference?: string) {
    return prisma.ledgerEntry.create({
      data: {
        walletId,
        type: "CREDIT",
        amount,
        reference,
        uniqueKey: reference ? `credit_${reference}` : undefined,
      },
    });
  }

  async debit(walletId: string, amount: number, reference?: string) {
    return prisma.ledgerEntry.create({
      data: {
        walletId,
        type: "DEBIT",
        amount,
        reference,
        uniqueKey: reference ? `debit_${reference}` : undefined,
      },
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
