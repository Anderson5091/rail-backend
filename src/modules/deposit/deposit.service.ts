import { prisma } from "../../config/database";
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

    const userWallet = await prisma.userCryptoWallet.findFirst({
      where: { userId, chain: chainType },
    });

    if (!userWallet) {
      throw new Error(`No wallet found for ${chain}. Create a crypto wallet first.`);
    }

    const depositRequest = await prisma.depositRequest.create({
      data: {
        userId,
        chain: chain.toUpperCase(),
        token,
        status: "WALLET_CREATED",
      },
    });

    await prisma.depositAddress.create({
      data: {
        depositRequestId: depositRequest.id,
        crossmintWalletId: userWallet.crossmintWalletId,
        address: userWallet.address,
        chain: chainType,
        status: "CREATED",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
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
          status: "PENDING",
        },
      });
    }

    logger.info(`[Deposit] Deposit request ${depositRequest.id} using address ${userWallet.address}`);

    return {
      depositId: depositRequest.id,
      network: chain.toUpperCase(),
      address: userWallet.address,
    };
  }

  async handleDepositDetected(
    crossmintWalletId: string,
    txHash: string,
    amount: number,
    chain: string
  ) {
    const depositAddress = await prisma.depositAddress.findFirst({
      where: { crossmintWalletId, status: { not: "ARCHIVED" } },
      include: { depositRequest: true },
      orderBy: { createdAt: "desc" },
    });

    if (!depositAddress) {
      logger.warn(`[Deposit] Unknown deposit wallet: ${crossmintWalletId}`);
      return;
    }

    await prisma.depositAddress.update({
      where: { id: depositAddress.id },
      data: { status: "FUNDED" },
    });

    await prisma.depositRequest.update({
      where: { id: depositAddress.depositRequestId },
      data: {
        amount,
        txHash,
        status: "DETECTED",
      },
    });

    logger.info(`[Deposit] Deposit detected for request ${depositAddress.depositRequestId}: ${amount} ${chain} tx=${txHash}`);

    await prisma.walletTransaction.updateMany({
      where: {
        walletId: (await prisma.wallet.findFirst({ where: { userId: depositAddress.depositRequest.userId } }))?.id,
        type: "DEPOSIT",
        status: "PENDING",
      },
      data: { txHash, status: "DETECTED" },
    });
  }

  async approveDeposit(depositRequestId: string) {
    const depositRequest = await prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
      include: { depositAddress: true },
    });

    if (!depositRequest || !depositRequest.depositAddress) {
      throw new Error("Deposit request or address not found");
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
      include: { depositAddress: true },
    });

    if (!depositRequest?.depositAddress) {
      throw new Error("Deposit request or address not found");
    }

    const hotWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType: "HOT", chain: depositRequest.chain.toLowerCase() },
    });

    if (!hotWallet?.walletLocator) {
      throw new Error("Hot treasury wallet not configured for this chain");
    }

    const depositAddress = depositRequest.depositAddress;
    const chainType = CHAIN_MAP[depositRequest.chain.toUpperCase()];
    if (!chainType) throw new Error(`Unsupported chain: ${depositRequest.chain}`);

    const userWallet = await prisma.userCryptoWallet.findFirst({
      where: { crossmintWalletId: depositAddress.crossmintWalletId },
    });

    if (!userWallet?.walletLocator) {
      throw new Error("User crypto wallet locator not found");
    }

    try {
      const result = await crossmintService.sendTransfer(
        userWallet.walletLocator,
        hotWallet.address,
        depositRequest.token.toLowerCase(),
        depositRequest.amount?.toString() || "0",
        chainType
      );

      await prisma.depositAddress.update({
        where: { id: depositAddress.id },
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
      include: { depositAddress: true },
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

    if (depositRequest.depositAddress) {
      await prisma.depositAddress.update({
        where: { id: depositRequest.depositAddress.id },
        data: { status: "ARCHIVED" },
      });
    }

    logger.info(`[Deposit] Credited user ${depositRequest.userId} with ${depositRequest.netAmount} for deposit ${depositRequestId}`);
  }

  async getDepositAddress(depositRequestId: string) {
    const depositAddress = await prisma.depositAddress.findUnique({
      where: { depositRequestId },
      include: { depositRequest: true },
    });

    if (!depositAddress) return null;

    return {
      depositId: depositAddress.depositRequestId,
      network: depositAddress.chain.toUpperCase(),
      address: depositAddress.address,
      status: depositAddress.status,
    };
  }

  async getDepositStatus(depositRequestId: string) {
    const depositRequest = await prisma.depositRequest.findUnique({
      where: { id: depositRequestId },
      include: { depositAddress: true },
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
      address: depositRequest.depositAddress?.address || null,
      addressStatus: depositRequest.depositAddress?.status || null,
      expiresAt: depositRequest.depositAddress?.expiresAt?.toISOString() || null,
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

    return { confirmations: next };
  }
}

export const depositService = new DepositService();
