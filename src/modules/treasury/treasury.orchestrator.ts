import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { crossmintService } from "../../services/crossmint.service";
import { logger } from "../../utils/logger";

export class TreasuryOrchestrator {
  async rebalance(network: string) {
    const networkIndex = ENV.SUPPORTED_NETWORKS.indexOf(network);
    const chain = networkIndex >= 0 ? ENV.NETWORK_CHAIN[networkIndex] : network;

    const hot = await prisma.treasuryWallet.findFirst({
      where: { walletType: "HOT", chain },
    });
    const warm = await prisma.treasuryWallet.findFirst({
      where: { walletType: "WARM", chain },
    });

    if (!hot || !warm) throw new Error("Treasury wallets not found for network");

    if (!hot.walletLocator || !warm.walletLocator) {
      throw new Error("Wallets missing Crossmint locators");
    }

    const hotBalances = await crossmintService.getWalletBalance(
      hot.walletLocator,
      ["usdt"]
    );

    const hotBalance = extractNumericBalance(hotBalances);
    const thresholdMin = Number(hot.thresholdMin || ENV.HOT_THRESHOLD_MIN);

    if (hotBalance < thresholdMin) {
      const refillAmount = Math.min(
        ENV.HOT_REFILL_AMOUNT,
        thresholdMin * 2 - hotBalance
      );

      const chainType = chain as "base" | "base-sepolia" | "ethereum" | "ethereum-sepolia" | "polygon" | "polygon-amoy" | "solana";
      const result = await crossmintService.sendTransfer(
        warm.walletLocator,
        hot.address,
        "usdt",
        refillAmount.toString(),
        chainType
      );

      await prisma.treasuryMovement.create({
        data: {
          fromWallet: "WARM",
          toWallet: "HOT",
          fromWalletId: warm.id,
          toWalletId: hot.id,
          amount: refillAmount,
          network: hot.network,
          reason: "Manual rebalance - low hot balance",
          status: "COMPLETED",
          txHash: result.txHash,
        },
      });

      logger.info(`[TreasuryOrchestrator] Rebalanced ${network}: ${refillAmount} WARM→HOT, tx=${result.txHash}`);
    }

    return { success: true, message: `Rebalancing complete for ${network}` };
  }
}

function extractNumericBalance(balances: unknown): number {
  if (typeof balances === "object" && balances !== null) {
    if (Array.isArray(balances)) {
      const entry = balances.find(
        (b: Record<string, unknown>) =>
          String(b.token || "").toLowerCase() === "usdt" ||
          String(b.symbol || "").toLowerCase() === "usdt"
      );
      return entry ? Number(entry.amount || entry.balance || 0) : 0;
    }
    return Number((balances as Record<string, unknown>)["usdt"] || 0);
  }
  return 0;
}
