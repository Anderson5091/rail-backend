import { createCrossmint, CrossmintWallets } from "@crossmint/wallets-sdk";
import type { Chain } from "@crossmint/wallets-sdk";
import { ENV } from "../config/env";
import { logger } from "../utils/logger";

export type ChainType = Chain;
export type WalletType = "COLLECTION" | "HOT" | "WARM" | "COLD" | "DEPOSIT";

export interface CrossmintWalletResult {
  crossmintWalletId: string;
  walletLocator: string;
  address: string;
  chain: string;
}

class CrossmintService {
  private client!: ReturnType<typeof createCrossmint>;
  private walletsSdk!: CrossmintWallets;
  private initialized = false;

  async initialize() {
    if (this.initialized) return;

    try {
      this.client = createCrossmint({
        apiKey: ENV.CROSSMINT_API_KEY,
      });

      this.walletsSdk = CrossmintWallets.from(this.client);
      this.initialized = true;
      logger.info("[Crossmint] SDK initialized successfully");
    } catch (error) {
      logger.error("[Crossmint] Failed to initialize SDK:", error);
      throw error;
    }
  }

  async createWallet(
    chain: ChainType,
    type: WalletType = "DEPOSIT",
  ): Promise<CrossmintWalletResult> {
    await this.ensureInitialized();

    const recoverySecret =
      type === "DEPOSIT"
        ? ENV.WALLET_RECOVERY_SECRET
        : ENV.TREASURY_RECOVERY_SECRET;

    const signerSecret =
      type === "DEPOSIT"
        ? ENV.WALLET_SIGNER_SECRET
        : ENV.TREASURY_SIGNER_SECRET;

    try {
      const wallet = await this.walletsSdk.createWallet({
        chain,
        recovery: {
          type: "server",
          secret: recoverySecret,
        },
        signers: [
          { type: "server", secret: signerSecret },
        ],
      });

      return {
        crossmintWalletId: wallet.address,
        walletLocator: wallet.address,
        address: wallet.address,
        chain: String(chain),
      };
    } catch (error) {
      logger.error(`[Crossmint] Failed to create ${type} wallet:`, error);
      throw error;
    }
  }

  async getWallet(locator: string, chain: ChainType) {
    await this.ensureInitialized();
    return this.walletsSdk.getWallet(locator, { chain });
  }

  async sendTransfer(
    fromWalletLocator: string,
    toAddress: string,
    token: string,
    amount: string,
    chain: ChainType
  ) {
    await this.ensureInitialized();
    const wallet = await this.getWallet(fromWalletLocator, chain);
    const tx = await wallet.send(toAddress, token, amount);
    return {
      txHash: tx.hash,
      explorerLink: tx.explorerLink,
      transactionId: tx.transactionId,
    };
  }

  async getWalletBalance(
    locator: string,
    tokens: string[],
    chain?: ChainType
  ) {
    await this.ensureInitialized();
    const wallet = await this.walletsSdk.getWallet(locator, {
      chain: chain || ("base" as ChainType),
    });
    const balances = await wallet.balances(tokens);
    return balances;
  }

  private async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

export const crossmintService = new CrossmintService();
