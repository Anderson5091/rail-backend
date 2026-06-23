import { prisma } from "../../config/database";
import { crossmintService, type ChainType } from "../../services/crossmint.service";
import { ENV } from "../../config/env";
import { ledgerService } from "../ledger/ledger.service";
import { logger } from "../../utils/logger";

const CHAIN_MAP: Record<string, { chain: ChainType; alias: string }> = {
  BASE: { chain: "base", alias: "evm" },
  ETHEREUM: { chain: "ethereum", alias: "evm" },
  POLYGON: { chain: "polygon", alias: "evm" },
  SOLANA: { chain: "solana", alias: "solana" },
};

const REQUIRED_CONFIRMATIONS = 5;

export class DepositService {
  async createDepositRequest(userId: string, chain: string, token: string = "USDT") {
    const mapping = CHAIN_MAP[chain.toUpperCase()];
    if (!mapping) {
      throw new Error(`Unsupported chain: ${chain}`);
    }

    const alias = mapping.alias;

    let depositWallet = await prisma.depositWallet.findUnique({
      where: { userId_alias: { userId, alias } },
    });

    if (!depositWallet) {
      try {
        const wallet = await crossmintService.createWallet(
          mapping.chain,
          "DEPOSIT",
          userId,
          alias
        );
        depositWallet = await prisma.depositWallet.create({
          data: {
            userId,
            alias,
            crossmintWalletId: wallet.crossmintWalletId,
            walletLocator: wallet.walletLocator,
            address: wallet.address,
            chain: mapping.chain,
          },
        });
        logger.info(`[Deposit] Created ${alias} wallet for user ${userId}: ${wallet.address}`);
      } catch (error) {
        logger.error(`[Deposit] Failed to create wallet for user ${userId}:`, error);
        throw new Error("Failed to create deposit wallet");
      }
    }

    const depositRequest = await prisma.depositRequest.create({
      data: {
        userId,
        depositWalletId: depositWallet.id,
        chain: chain.toUpperCase(),
        token,
        status: "WALLET_CREATED",
      },
    });

    const now = Date.now();
    await prisma.depositWallet.update({
      where: { id: depositWallet.id },
      data: { 
        expiresAt: new Date(now + 5 * 60 * 1000),
        status: "CREATED"
      },
    });

    const internalWallet = await prisma.wallet.findFirst({
      where: { userId },
    });

    if (internalWallet) {
      await prisma.walletTransaction.create({
        data: {
          walletId: internalWallet.id,
          type: "DEPOSIT",
          amount: 0,
          network: chain.toUpperCase(),
          txHash: depositRequest.id,
          status: "PENDING",
        },
      });
    }

    logger.info(`[Deposit] Deposit request ${depositRequest.id} using wallet ${depositWallet.address}`);

    return {
      depositId: depositRequest.id,
      network: chain.toUpperCase(),
      address: depositWallet.address,
    };
  }

  async handleDepositDetected(
    crossmintWalletId: string,
    txHash: string,
    amount: number,
    chain: string
  ) {
    const depositWallet = await prisma.depositWallet.findFirst({
      where: { crossmintWalletId },
      include: { depositRequests: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!depositWallet || depositWallet.depositRequests.length === 0) {
      logger.warn(`[Deposit] Unknown deposit wallet: ${crossmintWalletId}`);
      return null;
    }

    const depositRequest = depositWallet.depositRequests[0];

    await prisma.depositRequest.update({
      where: { id: depositRequest.id },
      data: {
        amount,
        txHash,
        status: "DETECTED",
      },
    });

    logger.info(`[Deposit] Deposit detected for request ${depositRequest.id}: ${amount} ${chain} tx=${txHash}`);

    const internalWallet = await prisma.wallet.findFirst({
      where: { userId: depositWallet.userId },
    });

    if (internalWallet) {
      await prisma.walletTransaction.updateMany({
        where: {
          walletId: internalWallet.id,
          type: "DEPOSIT",
          status: "PENDING",
          txHash: depositRequest.id,
        },
        data: { txHash, status: "DETECTED" },
      });
    }

    return depositRequest.id;
  }

  async approveDeposit(depositRequestId: string) {
    const depositRequest = await prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
    });

    if (!depositRequest) {
      throw new Error("Deposit request not found");
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
    const mapping = CHAIN_MAP[depositRequest.chain.toUpperCase()];
    if (!mapping) throw new Error(`Unsupported chain: ${depositRequest.chain}`);

    if (!depositWallet.walletLocator) {
      throw new Error("Deposit wallet locator not found");
    }

    try {
      const result = await crossmintService.sendTransfer(
        depositWallet.walletLocator,
        hotWallet.address,
        depositRequest.token.toLowerCase(),
        depositRequest.amount?.toString() || "0",
        mapping.chain
      );

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

    await prisma.walletTransaction.updateMany({
      where: {
        walletId: wallet.id,
        type: "DEPOSIT",
        status: { in: ["PENDING", "DETECTED"] },
        txHash: depositRequest.txHash ?? depositRequest.id,
      },
      data: {
        amount: depositRequest.netAmount,
        network: depositRequest.chain,
        txHash: depositRequest.txHash || undefined,
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
        data: { status: "ACTIVE" },
      });
    }

    logger.info(`[Deposit] Credited user ${depositRequest.userId} with ${depositRequest.netAmount} for deposit ${depositRequestId}`);
  }

  async getDepositStatus(depositRequestId: string) {
    const depositRequest = await prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
      include: { depositWallet: true },
    });

    if (!depositRequest) return null;

    return {
      depositId: depositRequest.id,
      network: depositRequest.chain,
      amount: depositRequest.amount?.toString(),
      fee: depositRequest.fee?.toString(),
      netAmount: depositRequest.netAmount?.toString(),
      txHash: depositRequest.txHash,
      confirmations: depositRequest.confirmations,
      status: depositRequest.status,
      address: depositRequest.depositWallet?.address || null,
      addressStatus: depositRequest.depositWallet?.status || null,
      expiresAt: depositRequest.depositWallet?.expiresAt?.toISOString() || null,
      createdAt: depositRequest.createdAt.toISOString(),
    };
  }

  async confirmDeposit(depositRequestId: string) {
    const depositRequest = await prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
    });

    if (!depositRequest) throw new Error("Deposit request not found");

    const next = depositRequest.confirmations + 1;

    await prisma.depositRequest.update({
      where: { id: depositRequestId },
      data: { confirmations: next },
    });

    logger.info(`[Deposit] Confirmations for ${depositRequestId}: ${next}`);

    if (next >= REQUIRED_CONFIRMATIONS) {
      await this.approveDeposit(depositRequestId);
    }

    return { confirmations: next };
  }
}

export const depositService = new DepositService();
