import { prisma } from "../../config/database";
import { lockService } from "../../services/lock.service";
import { ledgerService } from "../ledger/ledger.service";
import { liquidityEnforcer } from "../liquidity/liquidity-enforcer.service";
import { eventEmitter } from "../events/event.emitter";
import { logger } from "../../utils/logger";
import { generateTransactionNumber, generateReferenceNumber } from "../../utils/id-generator";
import { feeService } from "../fees/fee.service";

interface CreateTransferInput {
  beneficiaryId?: string;
  beneficiary?: {
    fullName: string;
    country: string;
    bankName?: string;
    accountNumber?: string;
    accountCurrency?: string;
    mobileWalletNumber?: string;
    mobileProvider?: string;
    cashPickupLocation?: string;
  };
  amount: number;
  payoutMethod: string;
  currency?: string;
  referenceId?: string;
  userId?: string;
  skipWalletDebit?: boolean;
  country?: string;
  fee?: number;
  feeTransactionType?: string;
}

export class TransferOrchestrator {
  async createTransfer(input: CreateTransferInput) {
    let beneficiaryId = input.beneficiaryId;

    if (!beneficiaryId && input.beneficiary) {
      const ben = await prisma.beneficiary.create({
        data: {
      userId: input.userId || undefined,
          fullName: input.beneficiary.fullName,
          country: input.beneficiary.country,
          payoutMethod: input.payoutMethod,
          bankName: input.beneficiary.bankName || null,
          accountNumber: input.beneficiary.accountNumber || null,
          accountCurrency: input.beneficiary.accountCurrency || null,
          mobileWalletNumber: input.beneficiary.mobileWalletNumber || null,
          mobileProvider: input.beneficiary.mobileProvider || null,
          cashPickupLocation: input.beneficiary.cashPickupLocation || null,
        },
      });
      beneficiaryId = ben.id;
    }

    if (!beneficiaryId) throw new Error("Beneficiary ID or inline beneficiary details are required");

    const country = input.country || (input.beneficiary?.country) || "";
    let fee: number;
    if (input.fee !== undefined) {
      fee = input.fee;
    } else {
      const feeConfigResult = await feeService.calculateByTransactionType(
        input.feeTransactionType || "WEB_TRANSFER",
        input.amount
      );
      if (feeConfigResult.totalFee > 0) {
        fee = feeConfigResult.totalFee;
      } else {
        const legacyFee = await feeService.calculate(country, input.payoutMethod, input.amount);
        fee = legacyFee.fee;
      }
    }
    const destinationAmount = input.amount - fee;

    const currency = input.currency || "USD";
    const referenceId = input.referenceId || generateReferenceNumber();

    const transfer = await prisma.transfer.create({
      data: {
      userId: input.userId,
        beneficiaryId,
        amount: input.amount,
        fee,
        destinationAmount,
        payoutMethod: input.payoutMethod,
        currency,
        status: "PENDING_PAYOUT",
        referenceId,
      },
    });

    const payoutOrder = await prisma.payoutOrder.create({
      data: {
        transferId: transfer.id,
        payoutMethod: input.payoutMethod,
        currency,
        status: "PENDING",
      },
    });

    await prisma.transfer.update({
      where: { id: transfer.id },
      data: { payoutOrderId: payoutOrder.id },
    });

    if (input.userId && !input.skipWalletDebit) {
      const wallet = await prisma.wallet.findFirst({ where: { userId: input.userId } });
      if (!wallet) throw new Error("Wallet not found");

      const transactionNumber = generateTransactionNumber();

      await lockService.withLock(`wallet:${wallet.id}`, async () => {
        const balance = await ledgerService.getBalance(wallet.id);
        if (Number(balance) < input.amount) {
          throw new Error("Insufficient balance");
        }

        await ledgerService.debit(wallet.id, input.amount, transactionNumber);

        await prisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "TRANSFER",
            amount: input.amount,
            status: "PENDING",
            transactionNumber,
            payoutOrderId: payoutOrder.id,
          },
        });
      });
    }

    await liquidityEnforcer.updateObligation(0, 0, input.amount);

    await eventEmitter.emit("TRANSFER_CREATED", {
      eventType: "TRANSFER_CREATED",
      entity: "Transfer",
      entityId: transfer.id,
      userId: input.userId as string | undefined,
      metadata: { amount: input.amount, payoutMethod: input.payoutMethod, referenceId },
    });

    return { ...transfer, payoutOrderId: payoutOrder.id, referenceId };
  }
}

export type { CreateTransferInput };
