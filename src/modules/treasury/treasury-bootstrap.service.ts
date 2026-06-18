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

export class TreasuryBootstrapService {
  async bootstrapTreasuryWallets() {
    logger.info("[TreasuryBootstrap] Starting treasury wallet bootstrap...");

    const networks = ENV.SUPPORTED_NETWORKS;
    const chains = ENV.NETWORK_CHAIN;

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
          const created = await crossmintService.createWallet(config.chain, config.walletType);

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

          logger.info(`[TreasuryBootstrap] Created ${config.walletType} wallet on ${networkLabel} (${chain}): ${created.address}`);
        } catch (error) {
          logger.error(`[TreasuryBootstrap] Failed to create ${config.walletType} wallet on ${networkLabel}:`, error);
        }
      }
    }

    logger.info("[TreasuryBootstrap] Treasury wallet bootstrap complete");
  }
}

export const treasuryBootstrapService = new TreasuryBootstrapService();
