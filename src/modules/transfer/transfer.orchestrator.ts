import { prisma } from "../../config/database";
import { lockService } from "../../services/lock.service";
import { ledgerService } from "../ledger/ledger.service";
import { eventEmitter } from "../events/event.emitter";
import crypto from "crypto";

function generateTransactionNumber(): string {
  const digits = crypto.randomInt(1000000000, 9999999999).toString();
  return `QS-${digits}`;
}

export class TransferOrchestrator {
  async createTransfer(data: { beneficiaryId: string; amount: number; payoutMethod: string }, userId: string) {
    const beneficiary = await prisma.beneficiary.findFirst({
      where: { id: data.beneficiaryId, userId },
    });
    if (!beneficiary) throw new Error("Beneficiary not found");

    const wallet = await prisma.wallet.findFirst({ where: { userId } });
    if (!wallet) throw new Error("Wallet not found");

    const transactionNumber = generateTransactionNumber();

    const transfer = await lockService.withLock(`wallet:${wallet.id}`, async () => {
      const balance = await ledgerService.getBalance(wallet.id);
      if (Number(balance) < data.amount) {
        throw new Error("Insufficient balance");
      }

      await ledgerService.debit(wallet.id, data.amount, transactionNumber);

      const t = await prisma.transfer.create({
        data: {
          userId,
          beneficiaryId: data.beneficiaryId,
          amount: data.amount,
          payoutMethod: data.payoutMethod,
          status: "COMPLETED",
          referenceId: transactionNumber,
        },
      });

      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "TRANSFER",
          amount: data.amount,
          status: "COMPLETED",
          transactionNumber,
        },
      });

      await eventEmitter.emit("TRANSFER_CREATED", {
        eventType: "TRANSFER_CREATED",
        entity: "Transfer",
        entityId: t.id,
        userId,
        metadata: { amount: data.amount, payoutMethod: data.payoutMethod, transactionNumber },
      });

      return { ...t, transactionNumber };
    });

    return transfer;
  }
}
