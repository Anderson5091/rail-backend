import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { crossmintService, type ChainType } from "../../services/crossmint.service";
import { ledgerService } from "../ledger/ledger.service";
import { logger } from "../../utils/logger";

const CHAIN_MAP: Record<string, ChainType> = {
  BASE: "base",
  ETHEREUM: "ethereum",
  POLYGON: "polygon",
  SOLANA: "solana",
};

interface WithdrawalParams {
  userId: string;
  walletId: string;
  chain: string;
  destinationAddress: string;
  amount: number;
  fee: number;
}

export class WithdrawalService {
  async createWithdrawal(params: WithdrawalParams) {
    const chainType = CHAIN_MAP[params.chain.toUpperCase()];
    if (!chainType) {
      throw new Error(`Unsupported chain: ${params.chain}`);
    }

    const balance = await ledgerService.getBalance(params.walletId);
    if (balance < params.amount) {
      throw new Error("Insufficient funds");
    }

    const netAmount = params.amount - params.fee;

    await ledgerService.debit(
      params.walletId,
      params.amount,
      `withdrawal_${Date.now()}`
    );

    const withdrawal = await prisma.withdrawal.create({
      data: {
        userId: params.userId,
        walletId: params.walletId,
        amount: params.amount,
        fee: params.fee,
        netAmount,
        chain: params.chain.toUpperCase(),
        destinationAddress: params.destinationAddress,
        status: "PENDING",
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: params.walletId,
        type: "WITHDRAWAL",
        amount: params.amount,
        network: params.chain.toUpperCase(),
        status: "PENDING",
        txHash: withdrawal.id,
      },
    });

    logger.info(`[Withdrawal] Created withdrawal ${withdrawal.id} for user ${params.userId}`);

    return withdrawal;
  }

  async executeWithdrawal(withdrawalId: string) {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new Error("Withdrawal not found");
    }

    if (withdrawal.status !== "PENDING") {
      throw new Error(`Withdrawal ${withdrawalId} is already ${withdrawal.status}`);
    }

    const hotWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType: "HOT", chain: withdrawal.chain.toLowerCase() },
    });

    if (!hotWallet?.walletLocator) {
      throw new Error("Hot treasury wallet not configured for this chain");
    }

    const chainType = CHAIN_MAP[withdrawal.chain.toUpperCase()];
    if (!chainType) throw new Error(`Unsupported chain: ${withdrawal.chain}`);

    try {
      const result = await crossmintService.sendTransfer(
        hotWallet.walletLocator,
        withdrawal.destinationAddress,
        ENV.APP_CURRENCY_TOKEN.toLowerCase(),
        withdrawal.netAmount.toString(),
        chainType
      );

      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          txHash: result.txHash,
          explorerLink: result.explorerLink,
          status: "SENT",
        },
      });

      await prisma.walletTransaction.updateMany({
        where: {
          walletId: withdrawal.walletId!,
          type: "WITHDRAWAL",
          status: "PENDING",
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
        data: {
          status: "COMPLETED",
        },
      });

      logger.info(`[Withdrawal] Executed withdrawal ${withdrawalId}: tx=${result.txHash}`);

      return result;
    } catch (error) {
      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: "FAILED" },
      });

      await ledgerService.credit(
        withdrawal.walletId!,
        Number(withdrawal.amount),
        `withdrawal_rollback_${withdrawalId}`
      );

      logger.error(`[Withdrawal] Failed to execute withdrawal ${withdrawalId}:`, error);
      throw error;
    }
  }
}

export const withdrawalService = new WithdrawalService();
