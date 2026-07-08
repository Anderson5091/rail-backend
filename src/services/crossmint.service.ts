import { createCrossmint, CrossmintWallets } from "@crossmint/wallets-sdk";
import type { Chain } from "@crossmint/wallets-sdk";
import { ENV } from "../config/env";
import { logger } from "../utils/logger";

export type ChainType = Chain;
export type WalletType = "HOT" | "WARM" | "COLD" | "DEPOSIT" | "REVENUE" | "AGENT";

export interface CrossmintWalletResult {
  crossmintWalletId: string;
  walletLocator: string;
  address: string;
  chain: string;
  owner?: string;
  alias?: string;
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

  async createTreasuryWallet(
    chain: ChainType,
    type: "HOT" | "WARM" | "COLD" | "REVENUE",
    alias?: string
  ): Promise<CrossmintWalletResult> {
    const owner = "COMPANY";
    await this.ensureInitialized();

    const recoverySecret = ENV.TREASURY_RECOVERY_SECRET;
    const signerSecret = ENV.TREASURY_SIGNER_SECRET;

    try {
      const params: any = {
        chain,
        recovery: {
          type: "server",
          secret: recoverySecret,
        },
        signers: [
          { type: "server", secret: signerSecret },
        ],
        owner,
      };

      if (alias) {
        params.alias = alias;
      }

      const wallet = await this.walletsSdk.createWallet(params);

      // Standard Crossmint locator format for COMPANY wallets:
      // <chainType>:smart:alias:<alias> (if alias is provided)
      const chainStr = String(chain).toLowerCase();
      const chainType = chainStr.includes("solana") ? "solana" : "evm";
      const walletLocator = alias 
        ? `${chainType}:smart:alias:${alias}`
        : wallet.address;

      return {
        crossmintWalletId: wallet.address,
        walletLocator,
        address: wallet.address,
        chain: String(chain),
        owner: wallet.owner,
        alias: wallet.alias,
      };
    } catch (error) {
      logger.error(`[Crossmint] Failed to create treasury ${type} wallet:`, error);
      throw error;
    }
  }

  async createUserWallet(
    chain: ChainType,
    type: "DEPOSIT" | "AGENT",
    userId: string,
    alias: string
  ): Promise<CrossmintWalletResult> {
    const owner = "USER";
    await this.ensureInitialized();

    const recoverySecret = ENV.WALLET_RECOVERY_SECRET || ENV.DEPOSIT_SIGNER_SECRET;
    const signerSecret = ENV.WALLET_SIGNER_SECRET || ENV.DEPOSIT_SIGNER_SECRET;

    try {
      const params: any = {
        chain,
        recovery: {
          type: "server",
          secret: recoverySecret,
        },
        signers: [
          { type: "server", secret: signerSecret },
        ],
        alias,
        owner,
      };

      const wallet = await this.walletsSdk.createWallet(params);

      // Map chain to Crossmint chainType format (evm, solana, etc.)
      const chainStr = String(chain).toLowerCase();
      const chainType = chainStr.includes("solana") ? "solana" : "evm";

      // Build the standard Crossmint server-side wallet locator:
      // userId:<userId>:<chainType>:smart:alias:<alias>
      const walletLocator = `userId:${userId}:${chainType}:smart:alias:${alias}`;

      return {
        crossmintWalletId: wallet.address,
        walletLocator,
        address: wallet.address,
        chain: String(chain),
        alias: wallet.alias,
      };
    } catch (error) {
      logger.error(`[Crossmint] Failed to create user ${type} wallet:`, error);
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
