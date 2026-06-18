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

export class DepositService {
  async createDepositRequest(userId: string, chain: string, token: string = "USDT") {
    const chainType = CHAIN_MAP[chain.toUpperCase()];
    if (!chainType) {
      throw new Error(`Unsupported chain: ${chain}`);
    }

    const depositRequest = await prisma.depositRequest.create({
      data: {
        userId,
        chain: chain.toUpperCase(),
        token,
        status: "PENDING",
      },
    });

    try {
      const wallet = await crossmintService.createWallet(chainType, "DEPOSIT");

      await prisma.depositWallet.create({
        data: {
          depositRequestId: depositRequest.id,
          crossmintWalletId: wallet.crossmintWalletId,
          walletLocator: wallet.walletLocator,
          address: wallet.address,
          chain: chainType,
          status: "CREATED",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      await prisma.depositRequest.update({
        where: { id: depositRequest.id },
        data: { status: "WALLET_CREATED" },
      });

      logger.info(`[Deposit] Created deposit wallet for request ${depositRequest.id}: ${wallet.address}`);

      return {
        depositId: depositRequest.id,
        network: chain.toUpperCase(),
        address: wallet.address,
      };
    } catch (error) {
      await prisma.depositRequest.update({
        where: { id: depositRequest.id },
        data: { status: "FAILED" },
      });
      logger.error(`[Deposit] Failed to create wallet for request ${depositRequest.id}:`, error);
      throw error;
    }
  }

  async handleDepositDetected(
    crossmintWalletId: string,
    txHash: string,
    amount: number,
    chain: string
  ) {
    const depositWallet = await prisma.depositWallet.findUnique({
      where: { crossmintWalletId },
      include: { depositRequest: true },
    });

    if (!depositWallet) {
      logger.warn(`[Deposit] Unknown deposit wallet: ${crossmintWalletId}`);
      return;
    }

    await prisma.depositWallet.update({
      where: { id: depositWallet.id },
      data: { status: "FUNDED" },
    });

    await prisma.depositRequest.update({
      where: { id: depositWallet.depositRequestId },
      data: {
        amount,
        status: "DETECTED",
      },
    });

    logger.info(`[Deposit] Deposit detected for request ${depositWallet.depositRequestId}: ${amount} ${chain}`);
  }

  async approveDeposit(depositRequestId: string) {
    const depositRequest = await prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
      include: { depositWallet: true },
    });

    if (!depositRequest || !depositRequest.depositWallet) {
      throw new Error("Deposit request or wallet not found");
    }

    const fee = Number(depositRequest.amount) * 0.01;
    const netAmount = Number(depositRequest.amount) - fee;

    await prisma.depositRequest.update({
      where: { id: depositRequestId },
      data: {
        fee,
        netAmount,
        status: "APPROVED",
      },
    });

    logger.info(`[Deposit] Deposit ${depositRequestId} approved: fee=${fee}, net=${netAmount}`);
  }

  async sweepToHotTreasury(depositRequestId: string) {
    const depositRequest = await prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
      include: { depositWallet: true },
    });

    if (!depositRequest?.depositWallet) {
      throw new Error("Deposit request or wallet not found");
    }

    const hotWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType: "HOT", chain: depositRequest.chain.toLowerCase() },
    });

    if (!hotWallet?.walletLocator) {
      throw new Error("Hot treasury wallet not configured for this chain");
    }

    const depositWallet = depositRequest.depositWallet;
    const chainType = CHAIN_MAP[depositRequest.chain.toUpperCase()];
    if (!chainType) throw new Error(`Unsupported chain: ${depositRequest.chain}`);

    try {
      const result = await crossmintService.sendTransfer(
        depositWallet.walletLocator,
        hotWallet.address,
        depositRequest.token.toLowerCase(),
        depositRequest.amount?.toString() || "0",
        chainType
      );

      await prisma.depositWallet.update({
        where: { id: depositWallet.id },
        data: { status: "SWEPT" },
      });

      await prisma.depositRequest.update({
        where: { id: depositRequestId },
        data: { status: "SWEPT" },
      });

      logger.info(`[Deposit] Swept ${depositRequestId} to hot treasury: tx=${result.txHash}`);
    } catch (error) {
      logger.error(`[Deposit] Sweep failed for ${depositRequestId}:`, error);
      throw error;
    }
  }

  async creditUserBalance(depositRequestId: string) {
    const depositRequest = await prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
      include: { depositWallet: true },
    });

    if (!depositRequest || !depositRequest.netAmount) {
      throw new Error("Deposit request not found or net amount not calculated");
    }

    const wallet = await prisma.wallet.findFirst({
      where: { userId: depositRequest.userId },
    });

    if (!wallet) {
      throw new Error("User wallet not found");
    }

    await ledgerService.credit(wallet.id, Number(depositRequest.netAmount), `deposit_${depositRequestId}`);

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "DEPOSIT",
        amount: depositRequest.netAmount,
        network: depositRequest.chain,
        status: "COMPLETED",
      },
    });

    await prisma.depositRequest.update({
      where: { id: depositRequestId },
      data: { status: "COMPLETED" },
    });

    if (depositRequest.depositWallet) {
      await prisma.depositWallet.update({
        where: { id: depositRequest.depositWallet.id },
        data: { status: "ARCHIVED" },
      });
    }

    logger.info(`[Deposit] Credited user ${depositRequest.userId} with ${depositRequest.netAmount} for deposit ${depositRequestId}`);
  }

  async getDepositAddress(depositRequestId: string) {
    const depositWallet = await prisma.depositWallet.findUnique({
      where: { depositRequestId },
      include: { depositRequest: true },
    });

    if (!depositWallet) return null;

    return {
      depositId: depositWallet.depositRequestId,
      network: depositWallet.chain.toUpperCase(),
      address: depositWallet.address,
      status: depositWallet.status,
    };
  }
}

export const depositService = new DepositService();
