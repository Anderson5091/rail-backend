import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { crossmintService, type ChainType, type WalletType } from "../../services/crossmint.service";
import { logger } from "../../utils/logger";

interface TreasuryWalletConfig {
  walletType: WalletType;
  chain: ChainType;
  network: string;
  thresholdMin?: number;
}

const REVENUE_CHAIN: ChainType = ENV.TREASURY_CHAIN as ChainType;

export class TreasuryBootstrapService {
  async bootstrapTreasuryWallets() {
    logger.info("[TreasuryBootstrap] Starting treasury wallet bootstrap...");

    const networks = ENV.SUPPORTED_NETWORKS;
    const chains = ENV.NETWORK_CHAIN;
    const errors: string[] = [];
    let createdCount = 0;

    for (let i = 0; i < networks.length; i++) {
      const networkLabel = networks[i];
      const chain = chains[i] as ChainType;

      const tierConfigs: TreasuryWalletConfig[] = [
        { walletType: "HOT", chain, network: networkLabel, thresholdMin: ENV.HOT_THRESHOLD_MIN },
        { walletType: "WARM", chain, network: networkLabel, thresholdMin: ENV.WARM_THRESHOLD_MIN },
        { walletType: "COLD", chain, network: networkLabel, thresholdMin: undefined },
      ];

      for (const config of tierConfigs) {
        const existing = await prisma.treasuryWallet.findFirst({
          where: { walletType: config.walletType, chain: config.chain },
        });

        if (existing) {
          logger.info(`[TreasuryBootstrap] ${config.walletType} wallet exists for ${networkLabel}: ${existing.address}`);
          continue;
        }

        try {
          const alias = `treasury_${config.walletType.toLowerCase()}_${config.chain.toLowerCase()}`;
          const created = await crossmintService.createTreasuryWallet(config.chain, config.walletType as any, alias);

          await prisma.treasuryWallet.create({
            data: {
              walletType: config.walletType,
              chain: config.chain,
              network: config.network,
              address: created.address,
              crossmintWalletId: created.crossmintWalletId,
              walletLocator: created.walletLocator,
              thresholdMin: config.thresholdMin,
              status: "ACTIVE",
            },
          });

          createdCount++;
          logger.info(`[TreasuryBootstrap] Created ${config.walletType} wallet on ${networkLabel} (${chain}): ${created.address}`);
        } catch (error: any) {
          const msg = `Failed to create ${config.walletType} wallet on ${networkLabel}: ${error.message || error}`;
          errors.push(msg);
          logger.error(`[TreasuryBootstrap] ${msg}`);
        }
      }
    }

    await this.bootstrapRevenueWallet();

    if (createdCount === 0 && errors.length > 0) {
      throw new Error(`Treasury bootstrap failed: ${errors.join("; ")}`);
    }

    logger.info(`[TreasuryBootstrap] Treasury wallet bootstrap complete. Created: ${createdCount}, Errors: ${errors.length}`);
  }

  private async bootstrapRevenueWallet() {
    const existing = await prisma.treasuryWallet.findFirst({
      where: { walletType: "REVENUE" },
    });

    if (existing) {
      logger.info(`[TreasuryBootstrap] REVENUE wallet exists: ${existing.address}`);
      return;
    }

    const alias = `treasury_revenue_${REVENUE_CHAIN.toLowerCase()}`;
    const created = await crossmintService.createTreasuryWallet(REVENUE_CHAIN, "REVENUE", alias);

    await prisma.treasuryWallet.create({
      data: {
        walletType: "REVENUE",
        chain: REVENUE_CHAIN,
        network: REVENUE_CHAIN.toUpperCase(),
        address: created.address,
        crossmintWalletId: created.crossmintWalletId,
        walletLocator: created.walletLocator,
        status: "ACTIVE",
      },
    });

    logger.info(`[TreasuryBootstrap] Created REVENUE wallet: ${created.address}`);
  }
}

export const treasuryBootstrapService = new TreasuryBootstrapService();
