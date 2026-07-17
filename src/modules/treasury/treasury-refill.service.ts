import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { crossmintService, ChainType } from "../../services/crossmint.service";
import { extractBalance } from "../../utils/balance";
import { logger } from "../../utils/logger";

export class TreasuryRefillService {
  private refillTimer: NodeJS.Timeout | null = null;

  start() {
    logger.info("[TreasuryRefill] Starting refill engine...");
    this.startRefillEngine();
  }

  stop() {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
  }

  private startRefillEngine() {
    const run = async () => {
      try {
        await this.checkAndRefillAllNetworks();
      } catch (error) {
        logger.error("[TreasuryRefill] Refill engine error:", error);
      }
    };

    run();
    this.refillTimer = setInterval(run, ENV.REFILL_INTERVAL);
    logger.info(`[TreasuryRefill] Refill engine running every ${ENV.REFILL_INTERVAL}ms`);
  }

  async checkAndRefillAllNetworks() {
    const chains = ENV.NETWORK_CHAIN;

    for (const chain of chains) {
      await this.checkAndRefillNetwork(chain);
    }
  }

  private async checkAndRefillNetwork(chain: string) {
    const hotWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType: "HOT", chain },
    });

    const warmWallet = await prisma.treasuryWallet.findFirst({
      where: { walletType: "WARM", chain },
    });

    if (!hotWallet?.walletLocator) {
      return;
    }

    try {
      const hotBalances = await crossmintService.getWalletBalance(
        hotWallet.address,
        [ENV.APP_CURRENCY_TOKEN.toLowerCase()],
        chain
      );

      const hotUsdtBalance = extractBalance(hotBalances, ENV.APP_CURRENCY_TOKEN.toLowerCase());
      const thresholdMin = Number(hotWallet.thresholdMin || ENV.HOT_THRESHOLD_MIN);

      if (hotUsdtBalance < thresholdMin) {
        if (!warmWallet?.walletLocator) {
          logger.warn(`[TreasuryRefill] Hot balance low on ${chain} but no warm wallet available`);
          return;
        }

        const refillAmount = Math.min(
          ENV.HOT_REFILL_AMOUNT,
          thresholdMin * 2 - hotUsdtBalance
        );

        logger.info(
          `[TreasuryRefill] Hot balance on ${chain} is ${hotUsdtBalance} (min ${thresholdMin}). Refilling ${refillAmount} from Warm`
        );

        const chainType = chain as "base" | "base-sepolia" | "ethereum" | "ethereum-sepolia" | "polygon" | "polygon-amoy" | "solana";
        const result = await crossmintService.internalTransfer(
          warmWallet.walletLocator,
          hotWallet.walletLocator!,
          ENV.APP_CURRENCY_TOKEN.toLowerCase(),
          refillAmount.toString(),
          chainType
        );

        await prisma.treasuryMovement.create({
          data: {
            fromWallet: "WARM",
            toWallet: "HOT",
            fromWalletId: warmWallet.id,
            toWalletId: hotWallet.id,
            amount: refillAmount,
            network: hotWallet.network,
            reason: "Auto refill - low hot balance",
            status: "COMPLETED",
            txHash: result.txHash,
          },
        });

        await prisma.treasuryWallet.update({
          where: { id: hotWallet.id },
          data: { lastSync: new Date() },
        });

        logger.info(`[TreasuryRefill] Hot treasury on ${chain} refilled: tx=${result.txHash}`);
      }

      const warmUsdtBalance = warmWallet?.walletLocator
        ? extractBalance(await crossmintService.getWalletBalance(warmWallet.address, [ENV.APP_CURRENCY_TOKEN.toLowerCase()], chain), ENV.APP_CURRENCY_TOKEN.toLowerCase())
        : 0;

      const warmThresholdMin = Number(warmWallet?.thresholdMin || ENV.WARM_THRESHOLD_MIN);
      if (warmWallet?.walletLocator && warmUsdtBalance < warmThresholdMin) {
        logger.warn(`[TreasuryRefill] Warm balance on ${chain} is ${warmUsdtBalance} (min ${warmThresholdMin}). Manual cold wallet withdrawal required.`);
      }
    } catch (error) {
      logger.error(`[TreasuryRefill] Failed to check network ${chain}:`, error);
    }
  }

  async recordLiquiditySnapshot() {
    const wallets = await prisma.treasuryWallet.findMany();
    const networkValues = wallets.map((w: { network: string }) => w.network);
    const networks: string[] = [...new Set<string>(networkValues)];

    for (const network of networks) {
      const networkWallets = wallets.filter((w: { network: string }) => w.network === network);
      const hotWallet = networkWallets.find((w: { walletType: string }) => w.walletType === "HOT");
      const warmWallet = networkWallets.find((w: { walletType: string }) => w.walletType === "WARM");
      const coldWallet = networkWallets.find((w: { walletType: string }) => w.walletType === "COLD");
      const hotBalance = hotWallet?.balance || 0;
      const warmBalance = warmWallet?.balance || 0;
      const coldBalance = coldWallet?.balance || 0;
      const totalBalance = Number(hotBalance) + Number(warmBalance) + Number(coldBalance);

      await prisma.liquiditySnapshot.create({
        data: {
          network,
          chain: network.toLowerCase(),
          hotBalance,
          warmBalance,
          coldBalance,
          totalBalance,
        },
      });
    }

    logger.info("[TreasuryRefill] Liquidity snapshot recorded");
  }

}

export const treasuryRefillService = new TreasuryRefillService();
