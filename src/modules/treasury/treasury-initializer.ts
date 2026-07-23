import { crossmintService } from "../../services/crossmint.service";
import { treasuryBootstrapService } from "./treasury-bootstrap.service";
import { treasuryRefillService } from "./treasury-refill.service";
import { liquidityEnforcer } from "../liquidity/liquidity-enforcer.service";
import { logger } from "../../utils/logger";

export async function initializeTreasuryInfrastructure() {
  try {
    logger.info("[TreasuryInit] Initializing Crossmint SDK...");
    await crossmintService.initialize();

    logger.info("[TreasuryInit] Bootstrapping treasury wallets...");
    await treasuryBootstrapService.bootstrapTreasuryWallets();

    logger.info("[TreasuryInit] Recalibrating system obligation...");
    await liquidityEnforcer.recalibrate();

    logger.info("[TreasuryInit] Starting treasury refill engine...");
    treasuryRefillService.start();

    logger.info("[TreasuryInit] Treasury infrastructure initialized successfully");
  } catch (error) {
    logger.error("[TreasuryInit] Failed to initialize treasury infrastructure:", error);
  }
}
