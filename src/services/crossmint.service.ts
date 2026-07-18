import { createCrossmint, CrossmintWallets } from "@crossmint/wallets-sdk";
import type { Chain } from "@crossmint/wallets-sdk";
import { ENV } from "../config/env";
import { logger } from "../utils/logger";
import axios from "axios";

export interface OfframpOrderParams {
  payerAddress: string;
  chain: string;
  paymentMethodId: string;
  amount: string;
  currency?: string;
}

export interface CardOnrampParams {
  walletAddress: string;
  chain: string;
  amount: string;
  receiptEmail?: string;
}

export interface CardOnrampResult {
  orderId: string;
  clientSecret: string;
}

const USDC_TOKEN_LOCATORS: Record<string, string> = {
  "base-sepolia": "base-sepolia:0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "ethereum-sepolia": "ethereum-sepolia:0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "polygon-amoy": "polygon-amoy:0x41E94Eb019C0762f529Fbf206aB3c8d9B5a8fEf5",
  solana: "solana:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  base: "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  ethereum: "ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  polygon: "polygon:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
};

export interface OrderStatusResponse {
  orderId: string;
  phase: string;
  payment: {
    status: string;
    method: string;
    currency: string;
    received?: {
      chain: string;
      txId: string;
      amount: string;
      currency: string;
    };
  };
  lineItems: Array<{
    delivery: {
      status: string;
    };
    callData?: {
      mode: string;
      amount: string;
      outFiatCurrency: string;
      effectiveAmount: string;
    };
  }>;
}

export type ChainType = Chain;
export type WalletType = "HOT" | "WARM" | "COLD" | "DEPOSIT" | "AGENT";

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
    type: "HOT" | "WARM" | "COLD",
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
        owner: `userId:${userId}`,
        alias,
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
    (wallet as any).useSigner?.({ type: "server", secret: ENV.WALLET_SIGNER_SECRET });
    const tx = await wallet.send(toAddress, token, amount);
    return {
      txHash: tx.hash,
      explorerLink: tx.explorerLink,
      transactionId: tx.transactionId,
    };
  }

  async internalTransfer(
    fromWalletLocator: string,
    toWalletLocator: string,
    token: string,
    amount: string,
    chain: ChainType
  ) {
    await this.ensureInitialized();
    const [wallet, toWallet] = await Promise.all([
      this.getWallet(fromWalletLocator, chain),
      this.getWallet(toWalletLocator, chain),
    ]);
    (wallet as any).useSigner?.({ type: "server", secret: ENV.WALLET_SIGNER_SECRET });
    const tx = await wallet.send(toWallet.address, token, amount);
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

  private get baseUrl() {
    return ENV.CROSSMINT_BASE_URL || "https://www.crossmint.com";
  }

  async createTreasuryOfframpOrder(params: OfframpOrderParams): Promise<{ orderId: string; serializedTransaction?: string; memo?: string }> {
    await this.ensureInitialized();

    const url = `${this.baseUrl}/api/2022-06-09/orders`;
    const body = {
      payment: {
        method: params.chain,
        currency: (params.currency || "usdc").toLowerCase(),
        payerAddress: params.payerAddress,
      },
      recipient: {
        paymentMethodId: params.paymentMethodId,
      },
      lineItems: [
        {
          currencyLocator: "fiat:usd",
          executionParameters: {
            mode: "exact-in",
            amount: params.amount,
          },
        },
      ],
    };

    try {
      const response = await axios.post(url, body, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ENV.CROSSMINT_API_KEY,
        },
      });

      const order = response.data?.order || response.data;
      const preparation = order?.payment?.preparation;

      logger.info(`[Crossmint] Offramp order created: ${order.orderId}`);

      return {
        orderId: order.orderId,
        serializedTransaction: preparation?.serializedTransaction,
        memo: preparation?.transactionParameters?.memo,
      };
    } catch (error: any) {
      const detail = error.response?.data || error.message;
      logger.error("[Crossmint] Failed to create offramp order:", detail);
      throw new Error(`Offramp order failed: ${JSON.stringify(detail)}`);
    }
  }

  async getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
    await this.ensureInitialized();

    const url = `${this.baseUrl}/api/2022-06-09/orders/${orderId}`;

    try {
      const response = await axios.get(url, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ENV.CROSSMINT_API_KEY,
        },
      });

      return response.data;
    } catch (error: any) {
      const detail = error.response?.data || error.message;
      logger.error(`[Crossmint] Failed to get order ${orderId}:`, detail);
      throw new Error(`Failed to get order status: ${JSON.stringify(detail)}`);
    }
  }

  async createCardOnrampOrder(params: CardOnrampParams): Promise<CardOnrampResult> {
    await this.ensureInitialized();

    const tokenLocator = USDC_TOKEN_LOCATORS[params.chain];
    if (!tokenLocator) {
      throw new Error(`Unsupported chain for card onramp: ${params.chain}`);
    }

    const url = `${this.baseUrl}/api/2022-06-09/orders`;

    try {
      const response = await axios.post(url, {
        lineItems: [
          {
            tokenLocator,
            executionParameters: {
              mode: "exact-in",
              amount: params.amount,
            },
          },
        ],
        payment: {
          method: "card",
          ...(params.receiptEmail ? { receiptEmail: params.receiptEmail } : {}),
        },
        recipient: {
          walletAddress: params.walletAddress,
        },
      }, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ENV.CROSSMINT_API_KEY,
        },
      });

      const data = response.data;
      const order = data?.order || data;
      logger.info(`[Crossmint] Card onramp order created: ${order.orderId}`);

      return {
        orderId: order.orderId,
        clientSecret: data?.clientSecret || "",
      };
    } catch (error: any) {
      const detail = error.response?.data || error.message;
      logger.error("[Crossmint] Failed to create card onramp order:", detail);
      throw new Error(`Card onramp order failed: ${JSON.stringify(detail)}`);
    }
  }

  private async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

export const crossmintService = new CrossmintService();
