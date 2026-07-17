import crypto from "crypto";
import { prisma } from "../../config/database";
import { crossmintService, type ChainType } from "../../services/crossmint.service";
import { relayService } from "../../services/relay.service";
import { ENV } from "../../config/env";
import { ledgerService } from "../ledger/ledger.service";
import { feeService } from "../fees/fee.service";
import { logger } from "../../utils/logger";

const chainMapping: Record<string, ChainType> = {
  BASE: (ENV.NETWORK_CHAIN[ENV.SUPPORTED_NETWORKS.indexOf("BASE")] || "base-sepolia") as ChainType,
  SOLANA: (ENV.NETWORK_CHAIN[ENV.SUPPORTED_NETWORKS.indexOf("SOLANA")] || "solana-devnet") as ChainType,
  POLYGON: (ENV.NETWORK_CHAIN[ENV.SUPPORTED_NETWORKS.indexOf("POLYGON")] || "polygon-amoy") as ChainType,
  ETHEREUM: (ENV.NETWORK_CHAIN[ENV.SUPPORTED_NETWORKS.indexOf("ETHEREUM")] || "ethereum-sepolia") as ChainType,
};

const TRON_CHAIN_ID = 728126428;
const BASE_CHAIN_ID = 8453;

function randomHex(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

const REQUIRED_CONFIRMATIONS = 5;

export class DepositService {
  async createDepositRequest(userId: string, chain: string, token: string = ENV.APP_CURRENCY_TOKEN) {
    const network = chain.toUpperCase();

    if (network === "TRON") {
      if (ENV.APP_CURRENCY_TOKEN !== "USDT") {
        throw new Error("TRON deposits are only available for USDT");
      }
      return this.createTronDepositRequest(userId, token);
    }

    const c = chainMapping[network];
    if (!c) {
      throw new Error(`Unsupported chain: ${chain}`);
    }

    const existingWallet = await prisma.depositWallet.findFirst({
      where: { userId, chain: c, status: "AVAILABLE" },
      include: { depositRequests: { where: { status: { notIn: ["FAILED", "COMPLETED"] } }, take: 1 } },
    });

    const canReuse = existingWallet && existingWallet.depositRequests.length === 0;

    if (canReuse) {
      logger.info(`[Deposit] Reusing existing ${network} wallet ${existingWallet.address} for user ${userId}`);

      const depositRequest = await prisma.depositRequest.create({
        data: {
          userId,
          depositWalletId: existingWallet.id,
          chain: network,
          token,
          status: "WALLET_CREATED",
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
            network,
            txHash: depositRequest.id,
            status: "PENDING",
          },
        });
      }

      return {
        depositId: depositRequest.id,
        network,
        address: existingWallet.address,
      };
    }

    const alias = `${network}_${randomHex(20)}`;

    try {
      const wallet = await crossmintService.createUserWallet(c, "DEPOSIT", userId, alias);

      const depositWallet = await prisma.depositWallet.create({
        data: {
          userId,
          alias,
          crossmintWalletId: wallet.crossmintWalletId,
          walletLocator: wallet.walletLocator,
          address: wallet.address,
          chain: c,
          status: "AVAILABLE",
        },
      });

      logger.info(`[Deposit] Created ${alias} wallet for user ${userId}: ${wallet.address}`);

      const depositRequest = await prisma.depositRequest.create({
        data: {
          userId,
          depositWalletId: depositWallet.id,
          chain: network,
          token,
          status: "WALLET_CREATED",
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
            network,
            txHash: depositRequest.id,
            status: "PENDING",
          },
        });
      }

      logger.info(`[Deposit] Deposit request ${depositRequest.id} using wallet ${depositWallet.address}`);

      return {
        depositId: depositRequest.id,
        network,
        address: depositWallet.address,
      };
    } catch (error) {
      logger.error(`[Deposit] Failed to create wallet for user ${userId}:`, error);
      throw new Error("Failed to create deposit wallet");
    }
  }

  private async createTronDepositRequest(userId: string, token: string) {
    const hotWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType: "HOT", chain: ENV.TREASURY_CHAIN },
    });
    if (!hotWallet?.address) throw new Error("Hot treasury not configured for Base");

    const quote = await relayService.getQuote({
      user: "0x0000000000000000000000000000000000000000",
      recipient: hotWallet.address,
      originChainId: TRON_CHAIN_ID,
      originCurrency: ENV.TRON_USDT_CONTRACT,
      destinationChainId: BASE_CHAIN_ID,
      destinationCurrency: ENV.BASE_TOKEN_CONTRACT,
      amount: "1000000",
      tradeType: "EXACT_INPUT",
      useDepositAddress: true,
    });

    const step = quote.steps?.find((s) => s.depositAddress);
    if (!step?.depositAddress || !step.requestId) {
      throw new Error("Relay did not return a deposit address");
    }

    const depositAddress = step.depositAddress;
    const requestId = step.requestId;

    const depositRequest = await prisma.depositRequest.create({
      data: {
        userId,
        chain: "TRON",
        token,
        status: "AWAITING_DEPOSIT",
        relayRequestId: requestId,
        depositAddress,
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
          network: "TRON",
          txHash: depositRequest.id,
          status: "PENDING",
        },
      });
    }

    logger.info(`[Deposit] TRON deposit request ${depositRequest.id} via Relay: address=${depositAddress}, requestId=${requestId}`);

    return {
      depositId: depositRequest.id,
      network: "TRON",
      address: depositAddress,
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

    await prisma.depositWallet.update({
      where: { id: depositWallet.id },
      data: { status: "USED" },
    });

    logger.info(`[Deposit] Deposit detected for request ${depositRequest.id}: ${amount} ${chain} tx=${txHash}; wallet ${depositWallet.id} marked USED`);

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

    const { totalFee } = await feeService.calculateDepositFee(Number(depositRequest.amount));
    const fee = totalFee;
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

    if (!hotWallet?.address) {
      throw new Error("Hot treasury wallet not configured for this chain");
    }

    const depositWallet = depositRequest.depositWallet;
    const c = chainMapping[depositRequest.chain.toUpperCase()];
    if (!c) throw new Error(`Unsupported chain: ${depositRequest.chain}`);

    if (!depositWallet.walletLocator) {
      throw new Error("Deposit wallet locator not found");
    }

    try {
      const result = await crossmintService.sendTransfer(
        depositWallet.walletLocator,
        hotWallet.address,
        depositRequest.token.toLowerCase(),
        depositRequest.amount?.toString() || "0",
        c
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
      address: depositRequest.depositWallet?.address || depositRequest.depositAddress || null,
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

      if (depositRequest.chain === "TRON") {
        await this.creditUserBalance(depositRequestId);
      } else {
        await this.sweepToHotTreasury(depositRequestId);
        await this.creditUserBalance(depositRequestId);
      }
    }

    return { confirmations: next };
  }
}

export const depositService = new DepositService();
