import { createCrossmint, CrossmintWallets, WalletsApiClient } from "@crossmint/wallets-sdk";
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

  async createWallet(
    chain: ChainType,
    type: WalletType = "DEPOSIT",
    userId?: string,
    alias?: string
  ): Promise<CrossmintWalletResult> {
    await this.ensureInitialized();

    const recoverySecret =
      type === "DEPOSIT"
        ? ENV.WALLET_RECOVERY_SECRET || ENV.DEPOSIT_SIGNER_SECRET
        : ENV.TREASURY_RECOVERY_SECRET;

    const signerSecret =
      type === "DEPOSIT"
        ? ENV.WALLET_SIGNER_SECRET || ENV.DEPOSIT_SIGNER_SECRET
        : ENV.TREASURY_SIGNER_SECRET;

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
      };

      if (userId) {
        params.owner = `user:${userId}`;
      }
      if (alias) {
        params.alias = alias;
      }

      const wallet = await this.walletsSdk.createWallet(params);

      // The wallet.address is the blockchain address, which doubles as a valid wallet locator
      // for the Crossmint SDK (WalletLocator accepts Address format).
      // After creation, retrieve the wallet by address to get the full wallet object including locator.
      const walletLocator = wallet.address;
      const crossmintWalletId = wallet.address;

      return {
        crossmintWalletId,
        walletLocator,
        address: wallet.address,
        chain: String(chain),
        owner: wallet.owner,
        alias: wallet.alias,
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
    const resolvedChain = chain || ("base" as ChainType);
    try {
      const wallet = await this.walletsSdk.getWallet(locator, {
        chain: resolvedChain,
      });
      return await wallet.balances(tokens);
    } catch {
      return await this.fetchBalanceDirect(locator, tokens, resolvedChain);
    }
  }

  private async fetchBalanceDirect(locator: string, tokens: string[], chain: ChainType) {
    const apiClient = new WalletsApiClient(this.client);
    const nativeSymbol = chain.includes("sol") ? "sol" : "eth";
    const allTokens = [nativeSymbol, "usdc", ...tokens.filter(t => t !== nativeSymbol && t !== "usdc")];

    const rawBalances = await apiClient.getBalance(locator, {
      chains: [chain],
      tokens: allTokens,
    }) as any;

    if (!Array.isArray(rawBalances)) {
      throw new Error("Failed to fetch balance");
    }

    return this.transformBalanceResponse(rawBalances, nativeSymbol);
  }

  private transformBalanceResponse(raw: any[], nativeSymbol: string) {
    const native = raw.find((t: any) => t.symbol === nativeSymbol);
    const usdc = raw.find((t: any) => t.symbol === "usdc");
    const otherTokens = raw.filter((t: any) => t.symbol !== nativeSymbol && t.symbol !== "usdc");

    return {
      nativeToken: native ?? { symbol: nativeSymbol, amount: "0" },
      usdc: usdc ?? { symbol: "usdc", amount: "0" },
      tokens: otherTokens,
    };
  }

  private async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

export const crossmintService = new CrossmintService();
